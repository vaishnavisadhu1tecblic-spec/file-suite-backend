const fs = require("fs");
const path = require("path");
const Backup = require("../models/Backup");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const FileShare = require("../models/FileShare");
const User = require("../models/User");

const backupDir = path.join(__dirname, "..", "uploads", "backups");

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const formatFileSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;

  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;

  return `${mb.toFixed(1)} MB`;
};

// =====================================================
// CREATE BACKUP
// =====================================================

const createBackup = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      includePhotos = true,
      includeVideos = false,
      includeDocs,
      includeDocuments,
    } = req.body;

    const includeDocsSetting =
      includeDocs !== undefined
        ? includeDocs
        : includeDocuments !== undefined
          ? includeDocuments
          : true;

    // -------------------------------------------------
    // Find all conversations of the current user
    // -------------------------------------------------

    const conversations = await Conversation.find({
      "members.userId": userId,
    }).lean();

    const conversationIds = conversations.map(
      (conversation) => conversation._id,
    );

    // -------------------------------------------------
    // Find all messages
    // -------------------------------------------------

    const messages = await Message.find({
      conversationId: { $in: conversationIds },
      hiddenFor: { $ne: userId },
    }).lean();

    // -------------------------------------------------
    // Filter messages based on backup preferences
    // -------------------------------------------------

    const filteredMessages = messages.filter((msg) => {
      if (msg.messageType === "file") {
        const mime = msg.attachment?.mimeType || "";

        if (mime.startsWith("image/") && !includePhotos) {
          return false;
        }

        if (mime.startsWith("video/") && !includeVideos) {
          return false;
        }

        if (
          !mime.startsWith("image/") &&
          !mime.startsWith("video/") &&
          !includeDocsSetting
        ) {
          return false;
        }
      }

      return true;
    });

    // -------------------------------------------------
    // Find file shares
    // -------------------------------------------------

    const fileShares = await FileShare.find({
      conversationId: { $in: conversationIds },
    }).lean();

    // -------------------------------------------------
    // Create backup data
    // -------------------------------------------------

    const backupData = {
      version: 1,
      createdAt: new Date(),
      userId,
      conversations,
      messages: filteredMessages,
      fileShares,
    };

    const fileName = `syncspace_backup_${userId}_${Date.now()}.json`;

    const filePath = path.join(backupDir, fileName);

    const jsonString = JSON.stringify(backupData, null, 2);

    fs.writeFileSync(filePath, jsonString, "utf8");

    const stats = fs.statSync(filePath);

    // -------------------------------------------------
    // Remove previous backups
    // -------------------------------------------------

    const oldBackups = await Backup.find({ userId });

    for (const old of oldBackups) {
      if (fs.existsSync(old.backupPath)) {
        try {
          fs.unlinkSync(old.backupPath);
        } catch (error) {
          console.error("Error unlinking old backup:", error);
        }
      }
    }

    await Backup.deleteMany({ userId });

    // -------------------------------------------------
    // Save backup record
    // -------------------------------------------------

    const newBackup = await Backup.create({
      userId,
      fileName,
      backupPath: filePath,
      size: stats.size,
      messageCount: filteredMessages.length,
      conversationCount: conversations.length,
      includesPhotos: includePhotos,
      includesVideos: includeVideos,
      includesDocs: includeDocsSetting,
      status: "completed",
    });

    return res.status(201).json({
      success: true,
      message: "Chat backup created successfully",
      backup: {
        _id: newBackup._id,
        size: stats.size,
        totalSize: stats.size,
        sizeLabel: formatFileSize(stats.size),
        messageCount: newBackup.messageCount,
        messagesCount: newBackup.messageCount,
        conversationCount: newBackup.conversationCount,
        createdAt: newBackup.createdAt,
        includePhotos,
        includeVideos,
        includesDocs: includeDocsSetting,
        includeDocuments: includeDocsSetting,
      },
    });
  } catch (error) {
    console.error("Create backup error:", error);

    return res.status(500).json({
      message: "Unable to create backup",
    });
  }
};

// =====================================================
// GET LATEST BACKUP
// =====================================================

const getLatestBackup = async (req, res) => {
  try {
    const userId = req.user.id;

    const [backup, user] = await Promise.all([
      Backup.findOne({ userId }).sort({ createdAt: -1 }).lean(),
      User.findById(userId).select("backupSettings").lean(),
    ]);

    const backupSettings = user?.backupSettings || {
      autoBackup: "never",
      includePhotos: true,
      includeVideos: false,
      includeDocs: true,
      includeDocuments: true,
    };

    return res.status(200).json({
      success: true,

      backup: backup
        ? {
            _id: backup._id,
            size: backup.size,
            totalSize: backup.size,
            sizeLabel: formatFileSize(backup.size),
            messageCount: backup.messageCount,
            messagesCount: backup.messageCount,
            conversationCount: backup.conversationCount,
            createdAt: backup.createdAt,
            includesPhotos: backup.includesPhotos,
            includesVideos: backup.includesVideos,
            includesDocs: backup.includesDocs,
            includeDocuments: backup.includesDocs,
          }
        : null,

      settings: backupSettings,
      backupSettings,
    });
  } catch (error) {
    console.error("Get latest backup error:", error);

    return res.status(500).json({
      message: "Unable to load backup status",
    });
  }
};

// =====================================================
// RESTORE BACKUP
// =====================================================

const restoreBackup = async (req, res) => {
  try {
    const userId = req.user.id;

    // -------------------------------------------------
    // Find latest backup
    // -------------------------------------------------

    const backup = await Backup.findOne({ userId }).sort({
      createdAt: -1,
    });

    if (!backup || !fs.existsSync(backup.backupPath)) {
      return res.status(404).json({
        message: "No valid backup found to restore",
      });
    }

    // -------------------------------------------------
    // Read backup file
    // -------------------------------------------------

    const content = fs.readFileSync(backup.backupPath, "utf8");

    const data = JSON.parse(content);

    // -------------------------------------------------
    // Verify backup ownership
    // -------------------------------------------------

    if (String(data.userId) !== String(userId)) {
      return res.status(403).json({
        message: "Backup belongs to another account",
      });
    }

    // =================================================
    // 1. RESTORE CONVERSATIONS
    // =================================================

    let restoredConversations = 0;

    const backupConversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];

    for (const conversation of backupConversations) {
      if (!conversation?._id) {
        continue;
      }

      // Make sure the current user belongs to this conversation.
      const isMember = Array.isArray(conversation.members)
        ? conversation.members.some(
            (member) => String(member.userId) === String(userId),
          )
        : false;

      if (!isMember) {
        continue;
      }

      // Check whether conversation already exists.
      const existingConversation = await Conversation.findById(
        conversation._id,
      );

      if (existingConversation) {
        continue;
      }

      try {
        await Conversation.create(conversation);

        restoredConversations++;
      } catch (error) {
        // Ignore duplicate-key errors.
        if (error.code === 11000) {
          console.log(`Conversation ${conversation._id} already exists.`);
        } else {
          throw error;
        }
      }
    }

    // =================================================
    // 2. RESTORE MESSAGES
    // =================================================

    let restoredMessages = 0;

    const backupMessages = Array.isArray(data.messages) ? data.messages : [];

    for (const msg of backupMessages) {
      if (!msg?._id || !msg?.conversationId) {
        continue;
      }

      // ------------------------------------------------
      // Make sure the conversation exists and the user
      // is a member of that conversation.
      // ------------------------------------------------

      const conversationExists = await Conversation.exists({
        _id: msg.conversationId,
        "members.userId": userId,
      });

      if (!conversationExists) {
        continue;
      }

      // ------------------------------------------------
      // Check if message already exists
      // ------------------------------------------------

      const existingMessage = await Message.findById(msg._id);

      if (existingMessage) {
        continue;
      }

      // ------------------------------------------------
      // Restore message
      // ------------------------------------------------

      await Message.create({
        _id: msg._id,
        chatId: msg.chatId,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        text: msg.text,
        messageType: msg.messageType || "text",
        fileId: msg.fileId || null,
        attachment: msg.attachment || {},
        time: msg.time,
        status: msg.status || "delivered",
        hiddenFor: msg.hiddenFor || [],
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      });

      restoredMessages++;
    }

    // =================================================
    // 3. RESTORE FILE SHARES
    // =================================================

    let restoredFileShares = 0;

    const backupFileShares = Array.isArray(data.fileShares)
      ? data.fileShares
      : [];

    for (const fileShare of backupFileShares) {
      if (!fileShare?._id || !fileShare?.conversationId) {
        continue;
      }

      // ------------------------------------------------
      // Make sure the conversation exists and the user
      // is a member.
      // ------------------------------------------------

      const conversationExists = await Conversation.exists({
        _id: fileShare.conversationId,
        "members.userId": userId,
      });

      if (!conversationExists) {
        continue;
      }

      // ------------------------------------------------
      // Check existing file share
      // ------------------------------------------------

      const existingFileShare = await FileShare.findById(fileShare._id);

      if (existingFileShare) {
        continue;
      }

      try {
        await FileShare.create(fileShare);

        restoredFileShares++;
      } catch (error) {
        // Ignore duplicate-key errors.
        if (error.code === 11000) {
          console.log(`FileShare ${fileShare._id} already exists.`);
        } else {
          throw error;
        }
      }
    }

    // =================================================
    // RESTORE RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Backup restored successfully",

      restoredConversations,
      restoredMessages,
      restoredFileShares,

      // Kept for frontend compatibility.
      restoredCount: restoredMessages,
    });
  } catch (error) {
    console.error("Restore backup error:", error);

    return res.status(500).json({
      message: "Unable to restore backup",
      error: error.message,
    });
  }
};

// =====================================================
// DELETE BACKUP
// =====================================================

const deleteBackup = async (req, res) => {
  try {
    const userId = req.user.id;

    const backupId = req.params.id;

    const filter =
      backupId && backupId !== "delete"
        ? {
            _id: backupId,
            userId,
          }
        : {
            userId,
          };

    const backup = await Backup.findOne(filter);

    if (backup) {
      if (fs.existsSync(backup.backupPath)) {
        try {
          fs.unlinkSync(backup.backupPath);
        } catch (error) {
          console.error("Error deleting backup file:", error);
        }
      }

      await Backup.deleteOne({
        _id: backup._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Backup deleted successfully",
    });
  } catch (error) {
    console.error("Delete backup error:", error);

    return res.status(500).json({
      message: "Unable to delete backup",
    });
  }
};

// =====================================================
// UPDATE BACKUP SETTINGS
// =====================================================

const updateBackupSettings = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      autoBackup = "never",
      includePhotos = true,
      includeVideos = false,
      includeDocs,
      includeDocuments,
    } = req.body;

    const includeDocsSetting =
      includeDocs !== undefined
        ? includeDocs
        : includeDocuments !== undefined
          ? includeDocuments
          : true;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        backupSettings: {
          autoBackup,
          includePhotos,
          includeVideos,
          includeDocs: includeDocsSetting,
          includeDocuments: includeDocsSetting,
        },
      },
      {
        new: true,
      },
    );

    return res.status(200).json({
      success: true,
      message: "Backup preferences updated",
      settings: user.backupSettings,
    });
  } catch (error) {
    console.error("Update backup settings error:", error);

    return res.status(500).json({
      message: "Unable to update backup settings",
    });
  }
};

// =====================================================
// EXPORT
// =====================================================

module.exports = {
  createBackup,
  getLatestBackup,
  restoreBackup,
  deleteBackup,
  updateBackupSettings,
};
