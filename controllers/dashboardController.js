const File = require("../models/File");
const Message = require("../models/Message");
const FileShare = require("../models/FileShare");
const Conversation = require("../models/Conversation");

const getFileType = (name = "") => {
  const extension = name.split(".").pop()?.toLowerCase();

  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image";
  }

  if (["mp4", "mov", "avi", "webm"].includes(extension)) {
    return "video";
  }

  if (["mp3", "wav", "ogg", "m4a"].includes(extension)) {
    return "audio";
  }

  return "document";
};

const formatStorage = (bytes = 0) => {
  if (!bytes || bytes <= 0) {
    return "0 KB";
  }

  const kb = bytes / 1024;

  if (kb < 1024) {
    return `${Math.round(kb * 10) / 10} KB`;
  }

  const mb = kb / 1024;

  if (mb < 1024) {
    return `${Math.round(mb * 10) / 10} MB`;
  }

  const gb = mb / 1024;

  return `${Math.round(gb * 10) / 10} GB`;
};

const formatDate = (date) => {
  if (!date) {
    return "";
  }

  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getDashboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // =====================================================
    // USER FILES
    // =====================================================

    const files = await File.find({
      userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    const filesUploaded = files.length;

    const totalBytes = files.reduce(
      (total, file) => total + Number(file.size || 0),
      0,
    );

    const recentUploads = files.slice(0, 5).map((file) => ({
      _id: String(file._id),
      originalName: file.originalName,
      name: file.originalName,
      type: getFileType(file.originalName),
      size: Number(file.size || 0),
      sizeLabel: formatStorage(file.size || 0),
      createdAt: file.createdAt,
      createdDate: formatDate(file.createdAt),
    }));

    // =====================================================
    // USER MESSAGES
    // =====================================================

    const messages = await Message.countDocuments({
      $or: [{ senderId: userId }, { receiverId: userId }],
      hiddenFor: {
        $ne: userId,
      },
    });

    // =====================================================
    // SHARED FILES
    // =====================================================

    const conversations = await Conversation.find({
      "members.userId": userId,
    })
      .select("_id type name avatar members")
      .lean();

    const conversationIds = conversations.map(
      (conversation) => conversation._id,
    );

    const sharedFileShares = await FileShare.find({
      conversationId: {
        $in: conversationIds,
      },
      revokedAt: null,
    })
      .select("fileId conversationId sharedBy createdAt")
      .lean();

    const sharedFiles = sharedFileShares.length;

    // =====================================================
    // RECENT CHATS
    // =====================================================

    const recentChats = await Promise.all(
      conversations.map(async (conversation) => {
        const latestMessage = await Message.findOne({
          conversationId: conversation._id,
          hiddenFor: {
            $ne: userId,
          },
        })
          .sort({ createdAt: -1 })
          .select("text senderId messageType createdAt time")
          .lean();

        let chatName = conversation.name || "Group";
        let chatAvatar = conversation.avatar || "";

        if (conversation.type === "private") {
          const otherMember = conversation.members.find(
            (member) => String(member.userId) !== String(userId),
          );

          if (otherMember) {
            const otherUser = await require("../models/User")
              .findById(otherMember.userId)
              .select("name username email")
              .lean();

            if (otherUser) {
              chatName =
                otherUser.name ||
                otherUser.username ||
                otherUser.email ||
                "User";

              chatAvatar = chatName
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
            }
          }
        }

        let lastMessage = "No messages yet";

        if (latestMessage) {
          if (latestMessage.messageType === "file") {
            lastMessage = `File: ${latestMessage.text}`;
          } else {
            lastMessage = latestMessage.text || "Message";
          }
        }

        return {
          conversationId: String(conversation._id),
          type: conversation.type,
          name: chatName,
          avatar: chatAvatar,
          lastMessage,
          lastMessageTime: latestMessage?.createdAt || conversation.updatedAt,
          senderId: latestMessage?.senderId
            ? String(latestMessage.senderId)
            : null,
        };
      }),
    );

    recentChats.sort(
      (a, b) =>
        new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0),
    );

    return res.status(200).json({
      success: true,
      dashboard: {
        filesUploaded,
        messages,
        storageUsed: formatStorage(totalBytes),
        totalBytes,
        sharedFiles,
        recentUploads,
        recentChats: recentChats.slice(0, 5),
      },
    });
  } catch (error) {
    console.error("Dashboard data error:", error);

    return res.status(500).json({
      message: "Unable to load dashboard data",
    });
  }
};

module.exports = {
  getDashboard,
};
