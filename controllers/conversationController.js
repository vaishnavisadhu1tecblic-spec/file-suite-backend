const fs = require("fs");
const path = require("path");

const Conversation = require("../models/Conversation");
const File = require("../models/File");
const FileShare = require("../models/FileShare");
const Message = require("../models/Message");
const User = require("../models/User");
const {
  getConversationForMember,
  getMember,
  getOrCreateLegacyConversation,
  getOrCreatePrivateConversation,
} = require("../utils/conversationAccess");
const { areFriends } = require("../utils/friendAccess");

const getFileType = (name) => {
  const extension = path.extname(name || "").toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) {
    return "image";
  }

  if ([".mp4", ".mov", ".avi", ".webm"].includes(extension)) {
    return "video";
  }

  if ([".pdf"].includes(extension)) {
    return "pdf";
  }

  if ([".doc", ".docx"].includes(extension)) {
    return "document";
  }

  if ([".xls", ".xlsx"].includes(extension)) {
    return "spreadsheet";
  }

  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(extension)) {
    return "archive";
  }

  return "file";
};

const serializeConversation = (conversation) => ({
  ...conversation.toObject(),
  members: conversation.members.map((member) => ({
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt,
  })),
});

const serializeFileMessage = (message) => ({
  _id: String(message._id),
  chatId: message.chatId,
  conversationId: message.conversationId
    ? String(message.conversationId)
    : null,
  senderId: String(message.senderId),
  receiverId: message.receiverId ? String(message.receiverId) : null,
  text: message.text,
  time: message.time,
  createdAt: message.createdAt,
  messageType: message.messageType,
  fileId: message.fileId ? String(message.fileId) : null,
  attachment: message.attachment,
  type: "file",
});

const serializeSharedFile = (share) => ({
  fileId: String(share.fileId._id),
  conversationId: String(share.conversationId),
  messageId: share.messageId ? String(share.messageId) : null,
  name: share.fileId.originalName,
  mimeType: share.fileId.mimeType,
  size: share.fileId.size,
  type: getFileType(share.fileId.originalName),
  permission: share.permission,
  sharedBy: String(share.sharedBy),
  createdAt: share.createdAt,
});

const ensureAdmin = (conversation, userId) => {
  const member = getMember(conversation, userId);

  if (!member || member.role !== "admin") {
    return false;
  }

  return true;
};

const listConversations = async (req, res) => {
  try {
    const query = {
      "members.userId": req.user.id,
    };

    if (req.query.type === "private") {
      query.type = "private";
    }

    let conversations = await Conversation.find(query)
      .populate("members.userId", "name username email")
      .sort({ updatedAt: -1 })
      .lean();

    if (req.query.type === "private") {
      conversations = (
        await Promise.all(
          conversations.map(async (conversation) => {
            const otherMember = conversation.members.find(
              (member) =>
                String(member.userId?._id || member.userId) !==
                String(req.user.id),
            );

            if (!otherMember) {
              return null;
            }

            return (await areFriends(
              req.user.id,
              otherMember.userId?._id || otherMember.userId,
            ))
              ? conversation
              : null;
          }),
        )
      ).filter(Boolean);
    }

    return res.status(200).json({ success: true, conversations });
  } catch (error) {
    console.error("List conversations error:", error);
    return res.status(500).json({ message: "Unable to load conversations" });
  }
};

const createPrivateConversation = async (req, res) => {
  try {
    const otherUser = await User.findById(req.params.userId).select("_id");

    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (String(otherUser._id) === String(req.user.id)) {
      return res
        .status(400)
        .json({ message: "Cannot create a chat with yourself" });
    }

    if (!(await areFriends(req.user.id, otherUser._id))) {
      return res.status(403).json({
        message: "You must be friends before starting a private conversation",
      });
    }

    const conversation = await getOrCreatePrivateConversation(
      req.user.id,
      otherUser._id,
    );

    return res.status(200).json({
      success: true,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error("Create private conversation error:", error);
    return res.status(500).json({ message: "Unable to create conversation" });
  }
};

const joinLegacyConversation = async (req, res) => {
  try {
    const conversation = await getOrCreateLegacyConversation(
      req.params.legacyChatId,
      req.user.id,
      req.body.name,
    );

    return res.status(200).json({
      success: true,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error("Join legacy conversation error:", error);
    return res.status(500).json({ message: "Unable to join conversation" });
  }
};

const createGroupConversation = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const requestedMembers = Array.isArray(req.body.memberIds)
      ? req.body.memberIds.map(String)
      : [];
    const memberIds = [...new Set([String(req.user.id), ...requestedMembers])];

    if (!name) {
      return res.status(400).json({ message: "Group name is required" });
    }

    const users = await User.find({ _id: { $in: memberIds } }).select("_id");

    if (users.length !== memberIds.length) {
      return res
        .status(400)
        .json({ message: "One or more members were not found" });
    }

    const conversation = await Conversation.create({
      type: "group",
      name,
      avatar: String(req.body.avatar || "").trim(),
      createdBy: req.user.id,
      members: memberIds.map((userId) => ({
        userId,
        role: userId === String(req.user.id) ? "admin" : "member",
      })),
    });

    return res.status(201).json({
      success: true,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error("Create group conversation error:", error);
    return res.status(500).json({ message: "Unable to create group" });
  }
};

const getConversation = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );

    if (!conversation) {
      return res
        .status(403)
        .json({ message: "You are not a conversation member" });
    }

    return res.status(200).json({
      success: true,
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ message: "Unable to load conversation" });
  }
};

const addMember = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || !ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can add members" });
    }

    if (conversation.type !== "group") {
      return res
        .status(400)
        .json({ message: "Private conversations cannot add members" });
    }

    const user = await User.findById(req.body.userId).select("_id");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!getMember(conversation, user._id)) {
      conversation.members.push({ userId: user._id, role: "member" });
      await conversation.save();
    }

    return res.status(200).json({ success: true, conversation });
  } catch (error) {
    console.error("Add conversation member error:", error);
    return res.status(500).json({ message: "Unable to add member" });
  }
};

const removeMember = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || !ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can remove members" });
    }

    const memberToRemove = getMember(conversation, req.params.userId);

    if (!memberToRemove) {
      return res.status(404).json({ message: "Member not found" });
    }

    if (memberToRemove.role === "admin") {
      return res
        .status(400)
        .json({ message: "Transfer admin role before removing an admin" });
    }

    conversation.members = conversation.members.filter(
      (member) => String(member.userId) !== String(req.params.userId),
    );
    await conversation.save();

    return res.status(200).json({ success: true, conversation });
  } catch (error) {
    console.error("Remove conversation member error:", error);
    return res.status(500).json({ message: "Unable to remove member" });
  }
};

const renameConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || !ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can rename groups" });
    }

    const name = String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Group name is required" });
    }

    conversation.name = name;
    await conversation.save();

    return res.status(200).json({ success: true, conversation });
  } catch (error) {
    console.error("Rename conversation error:", error);
    return res.status(500).json({ message: "Unable to rename group" });
  }
};

const leaveConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || !getMember(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "You are not a conversation member" });
    }

    const member = getMember(conversation, req.user.id);

    if (member.role === "admin" && conversation.members.length > 1) {
      return res
        .status(400)
        .json({ message: "Transfer admin role before leaving" });
    }

    conversation.members = conversation.members.filter(
      (item) => String(item.userId) !== String(req.user.id),
    );

    if (conversation.members.length === 0) {
      await Conversation.deleteOne({ _id: conversation._id });
    } else {
      await conversation.save();
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Leave conversation error:", error);
    return res.status(500).json({ message: "Unable to leave conversation" });
  }
};

const createFileMessage = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );

    if (!conversation) {
      return res
        .status(403)
        .json({ message: "You are not a conversation member" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const originalName = req.file.originalname;
    const extension = path.extname(originalName).toLowerCase();
    const file = await File.create({
      originalName,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      extension,
      size: req.file.size,
      path: req.file.path,
      userId: req.user.id,
    });

    await FileShare.create({
      fileId: file._id,
      conversationId: conversation._id,
      sharedBy: req.user.id,
      permission: "download",
    });

    const receiverId =
      conversation.type === "private"
        ? conversation.members.find(
            (member) => String(member.userId) !== String(req.user.id),
          )?.userId || null
        : null;
    const chatId =
      conversation.type === "private"
        ? [String(req.user.id), String(receiverId)].sort().join("_")
        : conversation.legacyChatId || String(conversation._id);
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const message = await Message.create({
      chatId,
      conversationId: conversation._id,
      senderId: req.user.id,
      receiverId,
      text: originalName,
      time,
      messageType: "file",
      fileId: file._id,
      attachment: {
        name: originalName,
        type: getFileType(originalName),
        mimeType: req.file.mimetype,
        size: req.file.size,
        permission: "download",
      },
    });

    const serializedMessage = serializeFileMessage(message);
    const io = req.app.get("io");

    if (io) {
      io.to(`conversation_${conversation._id}`).emit(
        "receive_file_message",
        serializedMessage,
      );
    }

    return res.status(201).json({
      success: true,
      file: {
        id: String(file._id),
        name: originalName,
        type: getFileType(originalName),
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
      message: serializedMessage,
    });
  } catch (error) {
    if (req.file?.path) {
      fs.rmSync(req.file.path, { force: true });
    }

    console.error("Create file message error:", error);
    return res.status(500).json({ message: "Unable to share file" });
  }
};

const listConversationFiles = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );

    if (!conversation) {
      return res
        .status(403)
        .json({ message: "You are not a conversation member" });
    }

    const shares = await FileShare.find({
      conversationId: conversation._id,
      revokedAt: null,
    })
      .populate("fileId")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      files: shares.filter((share) => share.fileId).map(serializeSharedFile),
    });
  } catch (error) {
    console.error("List conversation files error:", error);
    return res
      .status(500)
      .json({ message: "Unable to load conversation files" });
  }
};

const shareExistingFile = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );
    const file = await File.findOne({
      _id: req.params.fileId,
      userId: req.user.id,
    });

    if (!conversation) {
      return res
        .status(403)
        .json({ message: "You are not a conversation member" });
    }

    if (!file) {
      return res
        .status(404)
        .json({ message: "File not found or not owned by you" });
    }

    const share = await FileShare.findOneAndUpdate(
      {
        fileId: file._id,
        conversationId: conversation._id,
      },
      {
        fileId: file._id,
        conversationId: conversation._id,
        sharedBy: req.user.id,
        permission: req.body.permission === "view" ? "view" : "download",
        revokedAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const receiverId =
      conversation.type === "private"
        ? conversation.members.find(
            (member) => String(member.userId) !== String(req.user.id),
          )?.userId || null
        : null;
    const chatId =
      conversation.type === "private"
        ? [String(req.user.id), String(receiverId)].sort().join("_")
        : conversation.legacyChatId || String(conversation._id);
    const existingMessage = await Message.findOne({
      conversationId: conversation._id,
      fileId: file._id,
      messageType: "file",
    });

    if (!existingMessage) {
      const message = await Message.create({
        chatId,
        conversationId: conversation._id,
        senderId: req.user.id,
        receiverId,
        text: file.originalName,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        messageType: "file",
        fileId: file._id,
        attachment: {
          name: file.originalName,
          type: getFileType(file.originalName),
          mimeType: file.mimeType,
          size: file.size,
          permission: share.permission,
        },
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`conversation_${conversation._id}`).emit(
          "receive_file_message",
          serializeFileMessage(message),
        );
      }
    }

    return res.status(200).json({ success: true, share });
  } catch (error) {
    console.error("Share existing file error:", error);
    return res.status(500).json({ message: "Unable to share file" });
  }
};

const downloadSharedFile = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );
    const share = await FileShare.findOne({
      conversationId: req.params.id,
      fileId: req.params.fileId,
      revokedAt: null,
    });

    if (!conversation || !share || share.permission !== "download") {
      return res
        .status(403)
        .json({ message: "You do not have access to this file" });
    }

    const file = await File.findById(req.params.fileId);

    if (!file || !fs.existsSync(file.path)) {
      return res.status(404).json({ message: "File not found" });
    }

    return res.download(file.path, file.originalName);
  } catch (error) {
    console.error("Download shared file error:", error);
    return res.status(500).json({ message: "Unable to download shared file" });
  }
};

const previewSharedFile = async (req, res) => {
  try {
    const conversation = await getConversationForMember(
      req.params.id,
      req.user.id,
    );
    const share = await FileShare.findOne({
      conversationId: req.params.id,
      fileId: req.params.fileId,
      revokedAt: null,
    });
    const file = await File.findById(req.params.fileId);

    if (!conversation || !share || !file) {
      return res
        .status(403)
        .json({ message: "You do not have access to this file" });
    }

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ message: "File not found" });
    }

    res.type(file.mimeType);
    return res.sendFile(path.resolve(file.path));
  } catch (error) {
    console.error("Preview shared file error:", error);
    return res.status(500).json({ message: "Unable to preview shared file" });
  }
};

const listSharedFiles = async (req, res) => {
  try {
    const sharedByMe = req.path.includes("shared-by-me");
    const filter = sharedByMe
      ? { sharedBy: req.user.id, revokedAt: null }
      : { revokedAt: null };

    const shares = await FileShare.find(filter)
      .populate("fileId")
      .populate("conversationId", "name type members")
      .sort({ createdAt: -1 });

    const filteredShares = sharedByMe
      ? shares
      : shares.filter((share) =>
          share.conversationId?.members?.some?.(
            (member) => String(member.userId) === String(req.user.id),
          ),
        );

    return res.status(200).json({ success: true, shares: filteredShares });
  } catch (error) {
    console.error("List shared files error:", error);
    return res.status(500).json({ message: "Unable to load shared files" });
  }
};

const revokeSharedFile = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    const share = await FileShare.findOne({
      conversationId: req.params.id,
      fileId: req.params.fileId,
      revokedAt: null,
    });

    if (!conversation || !share) {
      return res.status(404).json({ message: "Shared file not found" });
    }

    if (
      String(share.sharedBy) !== String(req.user.id) &&
      !ensureAdmin(conversation, req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "You cannot revoke this file share" });
    }

    share.revokedAt = new Date();
    await share.save();

    return res
      .status(200)
      .json({ success: true, message: "File access removed" });
  } catch (error) {
    console.error("Revoke shared file error:", error);
    return res.status(500).json({ message: "Unable to remove file access" });
  }
};

module.exports = {
  listConversations,
  createPrivateConversation,
  joinLegacyConversation,
  createGroupConversation,
  getConversation,
  addMember,
  removeMember,
  renameConversation,
  leaveConversation,
  createFileMessage,
  listConversationFiles,
  shareExistingFile,
  downloadSharedFile,
  previewSharedFile,
  listSharedFiles,
  revokeSharedFile,
};
