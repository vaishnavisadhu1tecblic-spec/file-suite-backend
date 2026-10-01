const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

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
  if (!member) {
    return false;
  }
  return (
    member.role === "admin" ||
    member.role === "owner" ||
    String(conversation.createdBy) === String(userId)
  );
};

const ensureOwner = (conversation, userId) => {
  const member = getMember(conversation, userId);
  if (!member) {
    return false;
  }
  return (
    member.role === "owner" || String(conversation.createdBy) === String(userId)
  );
};

const listConversations = async (req, res) => {
  try {
    const userId = String(req.user?.id || "");

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const query = {
      "members.userId": userId,
      hiddenFor: { $ne: userId },
    };

    if (req.query.type === "private") {
      query.type = "private";
    } else if (req.query.type === "group") {
      query.type = "group";
    }

    let conversations = await Conversation.find(query)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
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

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .lean();

    return res.status(200).json({
      success: true,
      conversation: populated,
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

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .lean();

    return res.status(200).json({
      success: true,
      conversation: populated,
    });
  } catch (error) {
    console.error("Join legacy conversation error:", error);
    return res.status(500).json({ message: "Unable to join conversation" });
  }
};

const createGroupConversation = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
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

    let avatar = String(req.body.avatar || "").trim();
    if (req.file) {
      avatar = req.file.filename;
    }

    const inviteCode = crypto.randomBytes(6).toString("hex");

    const permissions = {
      editGroupInfo: req.body.editGroupInfo || "all",
      sendMessages: req.body.sendMessages || "all",
      addMembers: req.body.addMembers || "admins",
      approveMembers:
        req.body.approveMembers === true || req.body.approveMembers === "true",
    };

    const conversation = await Conversation.create({
      type: "group",
      name,
      description,
      avatar,
      createdBy: req.user.id,
      permissions,
      inviteCode,
      members: memberIds.map((userId) => ({
        userId,
        role: userId === String(req.user.id) ? "owner" : "member",
      })),
    });

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      memberIds.forEach((uid) => {
        io.to(`user_${uid}`).emit("group:created", populated);
      });
    }

    return res.status(201).json({
      success: true,
      conversation: populated,
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

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    return res.status(200).json({
      success: true,
      conversation: populated,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ message: "Unable to load conversation" });
  }
};

const updateGroupInfo = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group conversation not found" });
    }

    const member = getMember(conversation, req.user.id);
    if (!member) {
      return res.status(403).json({ message: "You are not a group member" });
    }

    if (
      conversation.permissions?.editGroupInfo === "admins" &&
      !ensureAdmin(conversation, req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "Only group admins can edit group info" });
    }

    if (req.body.name && req.body.name.trim()) {
      conversation.name = req.body.name.trim();
    }
    if (req.body.description !== undefined) {
      conversation.description = String(req.body.description).trim();
    }
    if (req.file) {
      conversation.avatar = req.file.filename;
    } else if (req.body.avatar !== undefined) {
      conversation.avatar = String(req.body.avatar).trim();
    }

    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit(
        "group:updated",
        populated,
      );
      io.to(`group_${conversation._id}`).emit("group:updated", populated);
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Update group info error:", error);
    return res.status(500).json({ message: "Unable to update group info" });
  }
};

const updateGroupPermissions = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group conversation not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can manage permissions" });
    }

    const {
      editGroupInfo,
      sendMessages,
      addMembers: addMembersPerm,
      approveMembers,
    } = req.body;

    if (!conversation.permissions) {
      conversation.permissions = {};
    }

    if (editGroupInfo) conversation.permissions.editGroupInfo = editGroupInfo;
    if (sendMessages) conversation.permissions.sendMessages = sendMessages;
    if (addMembersPerm) conversation.permissions.addMembers = addMembersPerm;
    if (approveMembers !== undefined) {
      conversation.permissions.approveMembers = Boolean(approveMembers);
    }

    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit(
        "group:updated",
        populated,
      );
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Update group permissions error:", error);
    return res.status(500).json({ message: "Unable to update permissions" });
  }
};

const addMember = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    const member = getMember(conversation, req.user.id);
    if (!member) {
      return res.status(403).json({ message: "You are not a group member" });
    }

    if (
      conversation.permissions?.addMembers === "admins" &&
      !ensureAdmin(conversation, req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "Only group admins can add members" });
    }

    const userIds = Array.isArray(req.body.userIds)
      ? req.body.userIds.map(String)
      : [String(req.body.userId || "")].filter(Boolean);

    if (!userIds.length) {
      return res.status(400).json({ message: "User ID(s) required" });
    }

    const usersToAdd = await User.find({ _id: { $in: userIds } }).select("_id");
    let addedCount = 0;

    usersToAdd.forEach((u) => {
      if (!getMember(conversation, u._id)) {
        conversation.members.push({
          userId: u._id,
          role: "member",
          joinedAt: new Date(),
        });
        addedCount++;
      }
    });

    if (addedCount > 0) {
      await conversation.save();
    }

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit("group:member_added", {
        conversationId: String(conversation._id),
        conversation: populated,
      });
      userIds.forEach((uid) => {
        io.to(`user_${uid}`).emit("group:created", populated);
      });
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Add conversation member error:", error);
    return res.status(500).json({ message: "Unable to add member" });
  }
};

const removeMember = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can remove members" });
    }

    const targetUserId = req.params.userId;
    const memberToRemove = getMember(conversation, targetUserId);

    if (!memberToRemove) {
      return res.status(404).json({ message: "Member not found" });
    }

    if (
      memberToRemove.role === "owner" ||
      String(conversation.createdBy) === String(targetUserId)
    ) {
      return res.status(403).json({ message: "Group owner cannot be removed" });
    }

    if (
      memberToRemove.role === "admin" &&
      !ensureOwner(conversation, req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "Only the group owner can remove other admins" });
    }

    conversation.members = conversation.members.filter(
      (m) => String(m.userId) !== String(targetUserId),
    );
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit("group:member_removed", {
        conversationId: String(conversation._id),
        userId: targetUserId,
        conversation: populated,
      });
      io.to(`user_${targetUserId}`).emit("group:member_removed", {
        conversationId: String(conversation._id),
        userId: targetUserId,
      });
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Remove conversation member error:", error);
    return res.status(500).json({ message: "Unable to remove member" });
  }
};

const updateMemberRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!["admin", "member"].includes(role)) {
      return res
        .status(400)
        .json({ message: "Role must be 'admin' or 'member'" });
    }

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only admins can change member roles" });
    }

    const targetUserId = req.params.userId;
    const member = getMember(conversation, targetUserId);

    if (!member) {
      return res.status(404).json({ message: "Member not found in group" });
    }

    if (member.role === "owner") {
      return res
        .status(403)
        .json({ message: "Cannot change role of group owner" });
    }

    if (
      role === "member" &&
      member.role === "admin" &&
      !ensureOwner(conversation, req.user.id)
    ) {
      return res
        .status(403)
        .json({ message: "Only owner can demote an admin" });
    }

    member.role = role;
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      const eventName =
        role === "admin" ? "group:member_promoted" : "group:member_demoted";
      io.to(`conversation_${conversation._id}`).emit(eventName, {
        conversationId: String(conversation._id),
        userId: targetUserId,
        role,
        conversation: populated,
      });
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Update member role error:", error);
    return res.status(500).json({ message: "Unable to update member role" });
  }
};

const transferOwnership = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureOwner(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group owner can transfer ownership" });
    }

    const newOwnerId = req.body.newOwnerId;
    const targetMember = getMember(conversation, newOwnerId);
    if (!targetMember) {
      return res
        .status(404)
        .json({ message: "Target user is not a group member" });
    }

    const currentOwnerMember = getMember(conversation, req.user.id);
    if (currentOwnerMember) {
      currentOwnerMember.role = "admin";
    }

    targetMember.role = "owner";
    conversation.createdBy = newOwnerId;
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit(
        "group:updated",
        populated,
      );
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Transfer ownership error:", error);
    return res.status(500).json({ message: "Unable to transfer ownership" });
  }
};

const deleteGroup = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureOwner(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only the group owner can delete the group" });
    }

    const conversationId = conversation._id;
    await Message.deleteMany({ conversationId });
    await FileShare.deleteMany({ conversationId });
    await Conversation.deleteOne({ _id: conversationId });

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversationId}`).emit("group:deleted", {
        conversationId: String(conversationId),
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Group deleted successfully" });
  } catch (error) {
    console.error("Delete group error:", error);
    return res.status(500).json({ message: "Unable to delete group" });
  }
};

const getGroupInviteLink = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!getMember(conversation, req.user.id)) {
      return res.status(403).json({ message: "You are not a group member" });
    }

    if (!conversation.inviteCode) {
      conversation.inviteCode = crypto.randomBytes(6).toString("hex");
      await conversation.save();
    }

    return res.status(200).json({
      success: true,
      inviteCode: conversation.inviteCode,
    });
  } catch (error) {
    console.error("Get invite link error:", error);
    return res.status(500).json({ message: "Unable to get invite link" });
  }
};

const resetGroupInviteLink = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only group admins can reset the invite link" });
    }

    conversation.inviteCode = crypto.randomBytes(6).toString("hex");
    await conversation.save();

    return res.status(200).json({
      success: true,
      inviteCode: conversation.inviteCode,
      message: "Invite link reset successfully",
    });
  } catch (error) {
    console.error("Reset invite link error:", error);
    return res.status(500).json({ message: "Unable to reset invite link" });
  }
};

const getGroupJoinInfo = async (req, res) => {
  try {
    const inviteCode = req.params.inviteCode;
    const conversation = await Conversation.findOne({
      type: "group",
      inviteCode,
    })
      .populate("createdBy", "name username image")
      .populate("members.userId", "name username image")
      .lean();

    if (!conversation) {
      return res
        .status(404)
        .json({ message: "Invalid or expired invite link" });
    }

    const isMember = conversation.members.some(
      (m) => String(m.userId?._id || m.userId) === String(req.user.id),
    );

    const hasPendingRequest = (conversation.joinRequests || []).some(
      (r) => String(r.userId?._id || r.userId) === String(req.user.id),
    );

    return res.status(200).json({
      success: true,
      group: {
        _id: conversation._id,
        name: conversation.name,
        description: conversation.description,
        avatar: conversation.avatar,
        memberCount: conversation.members.length,
        createdBy: conversation.createdBy,
        isMember,
        hasPendingRequest,
        requiresApproval: Boolean(conversation.permissions?.approveMembers),
      },
    });
  } catch (error) {
    console.error("Get join info error:", error);
    return res.status(500).json({ message: "Unable to fetch group info" });
  }
};

const joinGroupByInvite = async (req, res) => {
  try {
    const inviteCode = req.params.inviteCode;
    const conversation = await Conversation.findOne({
      type: "group",
      inviteCode,
    });

    if (!conversation) {
      return res
        .status(404)
        .json({ message: "Invalid or expired invite link" });
    }

    if (getMember(conversation, req.user.id)) {
      return res
        .status(400)
        .json({ message: "You are already a member of this group" });
    }

    if (conversation.permissions?.approveMembers) {
      const alreadyRequested = (conversation.joinRequests || []).some(
        (r) => String(r.userId) === String(req.user.id),
      );

      if (!alreadyRequested) {
        if (!conversation.joinRequests) {
          conversation.joinRequests = [];
        }
        conversation.joinRequests.push({
          userId: req.user.id,
          requestedAt: new Date(),
        });
        await conversation.save();
      }

      const populated = await Conversation.findById(conversation._id)
        .populate("members.userId", "name username email image about")
        .populate("createdBy", "name username email image")
        .populate("joinRequests.userId", "name username email image")
        .lean();

      const io = req.app.get("io");
      if (io) {
        conversation.members.forEach((m) => {
          if (m.role === "admin" || m.role === "owner") {
            io.to(`user_${m.userId}`).emit("group:join_request", {
              conversationId: String(conversation._id),
              conversation: populated,
            });
          }
        });
      }

      return res.status(200).json({
        success: true,
        status: "pending_approval",
        message:
          "Join request submitted. A group admin must approve your request.",
      });
    }

    // Direct join
    conversation.members.push({
      userId: req.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit("group:member_added", {
        conversationId: String(conversation._id),
        conversation: populated,
      });
      io.to(`user_${req.user.id}`).emit("group:created", populated);
    }

    return res.status(200).json({
      success: true,
      status: "joined",
      conversation: populated,
      message: "You have joined the group",
    });
  } catch (error) {
    console.error("Join group by invite error:", error);
    return res.status(500).json({ message: "Unable to join group" });
  }
};

const approveJoinRequest = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only admins can approve join requests" });
    }

    const targetUserId = req.params.userId;
    conversation.joinRequests = (conversation.joinRequests || []).filter(
      (r) => String(r.userId) !== String(targetUserId),
    );

    if (!getMember(conversation, targetUserId)) {
      conversation.members.push({
        userId: targetUserId,
        role: "member",
        joinedAt: new Date(),
      });
    }
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit("group:member_added", {
        conversationId: String(conversation._id),
        conversation: populated,
      });
      io.to(`user_${targetUserId}`).emit("group:created", populated);
    }

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Approve join request error:", error);
    return res.status(500).json({ message: "Unable to approve request" });
  }
};

const rejectJoinRequest = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation || conversation.type !== "group") {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!ensureAdmin(conversation, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only admins can reject join requests" });
    }

    const targetUserId = req.params.userId;
    conversation.joinRequests = (conversation.joinRequests || []).filter(
      (r) => String(r.userId) !== String(targetUserId),
    );
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate("members.userId", "name username email image about")
      .populate("createdBy", "name username email image")
      .populate("joinRequests.userId", "name username email image")
      .lean();

    return res.status(200).json({ success: true, conversation: populated });
  } catch (error) {
    console.error("Reject join request error:", error);
    return res.status(500).json({ message: "Unable to reject request" });
  }
};

const renameConversation = async (req, res) => {
  return updateGroupInfo(req, res);
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

    if (member.role === "owner" && conversation.members.length > 1) {
      return res
        .status(400)
        .json({ message: "Transfer ownership before leaving the group" });
    }

    conversation.members = conversation.members.filter(
      (item) => String(item.userId) !== String(req.user.id),
    );

    if (conversation.members.length === 0) {
      await Conversation.deleteOne({ _id: conversation._id });
    } else {
      await conversation.save();
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation_${conversation._id}`).emit("group:member_removed", {
        conversationId: String(conversation._id),
        userId: req.user.id,
      });
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

const deleteConversationsForMe = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const conversationIds = Array.isArray(req.body?.conversationIds)
      ? req.body.conversationIds
          .map(String)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [req.params.id || req.body?.conversationId]
          .map(String)
          .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!conversationIds.length) {
      return res.status(400).json({
        success: false,
        message: "No conversations specified",
      });
    }

    const objectIds = conversationIds.map((id) => new mongoose.Types.ObjectId(id));
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // 1. Hide conversation for current user
    await Conversation.updateMany(
      {
        _id: { $in: objectIds },
        "members.userId": userObjectId,
      },
      {
        $addToSet: { hiddenFor: userObjectId },
      },
    );

    // 2. Hide all existing messages in those conversations for current user
    await Message.updateMany(
      {
        conversationId: { $in: objectIds },
        hiddenFor: { $ne: userObjectId },
      },
      {
        $addToSet: { hiddenFor: userObjectId },
      },
    );

    // 3. Mark any unread messages in those conversations as read for current user
    await Message.updateMany(
      {
        conversationId: { $in: objectIds },
        $or: [{ receiverId: userObjectId }, { receiverId: userId }],
        status: { $ne: "read" },
      },
      {
        $set: { status: "read", readAt: new Date() },
      },
    );

    return res.status(200).json({
      success: true,
      deletedConversationIds: conversationIds,
      message: "Conversation(s) deleted for you",
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listConversations,
  createPrivateConversation,
  joinLegacyConversation,
  createGroupConversation,
  getConversation,
  updateGroupInfo,
  updateGroupPermissions,
  addMember,
  removeMember,
  updateMemberRole,
  transferOwnership,
  deleteGroup,
  getGroupInviteLink,
  resetGroupInviteLink,
  getGroupJoinInfo,
  joinGroupByInvite,
  approveJoinRequest,
  rejectJoinRequest,
  renameConversation,
  leaveConversation,
  createFileMessage,
  listConversationFiles,
  shareExistingFile,
  downloadSharedFile,
  previewSharedFile,
  listSharedFiles,
  revokeSharedFile,
  deleteConversationsForMe,
};
