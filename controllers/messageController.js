const mongoose = require("mongoose");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/User");

const {
  getConversationForMember,
  getOrCreatePrivateConversation,
  isValidConversationId,
} = require("../utils/conversationAccess");

const { areFriends } = require("../utils/friendAccess");

// =====================================================
// MESSAGE PAGINATION
// =====================================================

const DEFAULT_MESSAGE_LIMIT = 10;
const MAX_MESSAGE_LIMIT = 50;

// =====================================================
// CREATE PRIVATE CHAT ID
// =====================================================

const getPrivateChatId = (user1, user2) => {
  return [String(user1), String(user2)].sort().join("_");
};

// =====================================================
// BUILD PAGINATED MESSAGE QUERY
// =====================================================

const getPaginatedMessages = async ({ filter, limit, before, beforeId }) => {
  const queryFilter = {
    ...filter,
  };

  const cursorFilter = [];

  if (before) {
    const beforeDate = new Date(before);

    if (!Number.isNaN(beforeDate.getTime())) {
      if (beforeId && mongoose.Types.ObjectId.isValid(beforeId)) {
        const beforeObjectId = new mongoose.Types.ObjectId(beforeId);

        // Keyset cursor: same-millisecond messages are ordered by _id.
        // Use $and so this does not overwrite conversation $or filters.
        cursorFilter.push({
          $or: [
            {
              createdAt: {
                $lt: beforeDate,
              },
            },
            {
              createdAt: beforeDate,
              _id: {
                $lt: beforeObjectId,
              },
            },
          ],
        });
      } else {
        cursorFilter.push({
          createdAt: {
            $lt: beforeDate,
          },
        });
      }
    }
  }

  const finalFilter = cursorFilter.length
    ? { $and: [queryFilter, ...cursorFilter] }
    : queryFilter;

  const messages = await Message.find(finalFilter)
    .sort({
      createdAt: -1,
      _id: -1,
    })
    .limit(limit)
    .lean();

  const orderedMessages = messages.reverse();

  const oldestMessage = orderedMessages[0] || null;

  const hasMore = messages.length === limit;

  return {
    messages: orderedMessages,
    hasMore,
    nextCursor: oldestMessage
      ? {
          createdAt: oldestMessage.createdAt,
          id: String(oldestMessage._id),
        }
      : null,
  };
};

// =====================================================
// GET CHAT MESSAGES
// =====================================================

const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;

    const currentUserId = String(req.user.id);

    const requestedLimit = Number(req.query.limit);

    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_MESSAGE_LIMIT)
        : DEFAULT_MESSAGE_LIMIT;

    let before = req.query.before || null;

    let beforeId = req.query.beforeId || null;

    if (before && typeof before === "object") {
      beforeId = beforeId || before.id || before._id || null;
      before = before.createdAt || before.before || null;
    }

    // =================================================
    // CURRENT CONVERSATION
    // =================================================

    if (isValidConversationId(chatId)) {
      const conversation = await getConversationForMember(
        chatId,
        currentUserId,
      );

      if (!conversation) {
        return res.status(403).json({
          success: false,
          message: "You are not a conversation member",
        });
      }

      const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
        ? new mongoose.Types.ObjectId(currentUserId)
        : currentUserId;

      const result = await getPaginatedMessages({
        filter: {
          $or: [
            { conversationId: conversation._id },
            { conversationId: String(conversation._id) },
            ...(conversation.legacyChatId
              ? [{ chatId: String(conversation.legacyChatId) }]
              : []),
          ],
          hiddenFor: {
            $nin: [currentUserId, currentUserObjectId],
          },
        },

        limit,

        before,

        beforeId,
      });

      return res.status(200).json({
        success: true,

        messages: result.messages,

        pagination: {
          limit,

          hasMore: result.hasMore,

          nextCursor: result.nextCursor,
        },
      });
    }

    // =================================================
    // LEGACY GROUP CHAT
    // =================================================

    const legacyConversation = await Conversation.findOne({
      type: "group",

      legacyChatId: String(chatId),
    });

    if (legacyConversation) {
      const isMember = legacyConversation.members.some(
        (member) => String(member.userId) === currentUserId,
      );

      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "You are not a conversation member",
        });
      }

      const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
        ? new mongoose.Types.ObjectId(currentUserId)
        : currentUserId;

      const result = await getPaginatedMessages({
        filter: {
          hiddenFor: {
            $nin: [currentUserId, currentUserObjectId],
          },

          $or: [
            {
              conversationId: legacyConversation._id,
            },

            {
              chatId: String(chatId),

              receiverId: null,
            },
          ],
        },

        limit,

        before,

        beforeId,
      });

      return res.status(200).json({
        success: true,

        messages: result.messages,

        pagination: {
          limit,

          hasMore: result.hasMore,

          nextCursor: result.nextCursor,
        },
      });
    }

    // =================================================
    // PRIVATE CHAT (BY CHAT KEY user1_user2)
    // =================================================

    const parts = String(chatId).split("_");
    const otherUserId =
      parts.find((id) => id !== currentUserId) || parts[0];
    const privateKey = parts.slice(0, 2).sort().join(":");

    let privateConversation = await Conversation.findOne({
      type: "private",
      privateKey,
      "members.userId": currentUserId,
    });

    if (!privateConversation && otherUserId) {
      if (await areFriends(currentUserId, otherUserId)) {
        privateConversation = await getOrCreatePrivateConversation(
          currentUserId,
          otherUserId,
        );
      }
    }

    const otherMember = privateConversation?.members?.find(
      (member) => String(member.userId) !== currentUserId,
    );

    const hasFriendship = otherMember
      ? await areFriends(currentUserId, otherMember.userId)
      : false;

    if (!privateConversation || !hasFriendship) {
      return res.status(403).json({
        success: false,
        message: "You are not a conversation member",
      });
    }

    const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : currentUserId;

    const result = await getPaginatedMessages({
      filter: {
        $or: [
          { conversationId: privateConversation._id },
          { chatId: String(chatId) },
          { chatId: [currentUserId, otherUserId].sort().join("_") },
        ],
        hiddenFor: {
          $nin: [currentUserId, currentUserObjectId],
        },
      },

      limit,

      before,

      beforeId,
    });

    return res.status(200).json({
      success: true,

      messages: result.messages,

      pagination: {
        limit,

        hasMore: result.hasMore,

        nextCursor: result.nextCursor,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// GET TOTAL MESSAGE COUNT
// =====================================================

const getMessageCount = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);

    const count = await Message.countDocuments({
      $or: [
        {
          senderId: currentUserId,
        },

        {
          receiverId: currentUserId,
        },

        {
          receiverId: null,
        },
      ],

      hiddenFor: {
        $ne: currentUserId,
      },
    });

    return res.status(200).json({
      success: true,

      count,
    });
  } catch (error) {
    console.error("Get message count error:", error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};

// =====================================================
// GET UNREAD COUNTS
// =====================================================

const getUnreadCounts = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);

    if (!mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);

    const userConversations = await Conversation.find({
      "members.userId": currentUserId,
      hiddenFor: {
        $nin: [currentUserObjectId, currentUserId],
      },
    })
      .select("_id")
      .lean();

    const conversationObjectIds = userConversations.map(
      (conversation) => conversation._id,
    );

    const unreadMessages = await Message.aggregate([
      {
        $match: {
          conversationId: {
            $in: conversationObjectIds,
          },

          $or: [
            {
              receiverId: currentUserObjectId,
            },
            {
              receiverId: currentUserId,
            },
          ],

          status: {
            $ne: "read",
          },

          hiddenFor: {
            $nin: [currentUserObjectId, currentUserId],
          },
        },
      },

      {
        $group: {
          _id: "$conversationId",

          count: {
            $sum: 1,
          },
        },
      },
    ]);

    const counts = {};

    unreadMessages.forEach((item) => {
      if (item._id) {
        counts[String(item._id)] = item.count;
      }
    });

    const total = unreadMessages.reduce((sum, item) => sum + item.count, 0);

    return res.status(200).json({
      success: true,

      counts,

      total,
    });
  } catch (error) {
    console.error("Get unread counts error:", error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};

// =====================================================
// MARK CONVERSATION AS READ
// =====================================================

const markConversationRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const currentUserId = String(req.user.id);

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "conversationId is required",
      });
    }

    const conversation = await getConversationForMember(
      conversationId,
      currentUserId,
    );

    if (!conversation) {
      return res.status(403).json({
        success: false,
        message: "You are not a conversation member",
      });
    }

    const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : currentUserId;

    const conversationObjectId = mongoose.Types.ObjectId.isValid(conversationId)
      ? new mongoose.Types.ObjectId(conversationId)
      : conversationId;

    const readAt = new Date();

    const unreadMessages = await Message.find({
      $and: [
        {
          $or: [
            { conversationId: conversationObjectId },
            { conversationId: String(conversationId) },
            ...(conversation.legacyChatId
              ? [{ chatId: String(conversation.legacyChatId) }]
              : []),
          ],
        },
        {
          $or: [
            { receiverId: currentUserObjectId },
            { receiverId: currentUserId },
          ],
        },
      ],
      status: {
        $ne: "read",
      },
    }).select("_id senderId chatId conversationId localId");

    const result = await Message.updateMany(
      {
        _id: {
          $in: unreadMessages.map((message) => message._id),
        },
        status: {
          $ne: "read",
        },
      },
      {
        $set: {
          status: "read",
          readAt,
        },
      },
    );

    const io = req.app.get("io");
    if (io) {
      for (const msg of unreadMessages) {
        const updatePayload = {
          messageId: String(msg._id),
          localId: msg.localId || null,
          status: "read",
          readAt,
          chatId: msg.chatId ? String(msg.chatId) : null,
          conversationId: msg.conversationId
            ? String(msg.conversationId)
            : null,
        };
        io.to(`user_${msg.senderId}`).emit("message_status_updated", updatePayload);
        if (msg.conversationId) {
          io.to(`conversation_${msg.conversationId}`).emit("message_status_updated", updatePayload);
        }
      }

      const otherMembers =
        conversation.members?.filter(
          (m) => String(m.userId?._id || m.userId) !== currentUserId,
        ) || [];

      for (const member of otherMembers) {
        const memberId = String(member.userId?._id || member.userId);
        io.to(`user_${memberId}`).emit("messages_read", {
          conversationId: String(conversationId),
          readBy: currentUserId,
          readAt,
        });
      }
      io.to(`conversation_${conversation._id}`).emit("messages_read", {
        conversationId: String(conversationId),
        readBy: currentUserId,
        readAt,
      });
    }

    return res.status(200).json({
      success: true,
      updatedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error("Mark conversation read error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// MARK MESSAGES DELIVERED (REST API)
// =====================================================

const markMessagesDelivered = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);
    const { messageIds, messageId } = req.body || {};
    const ids = Array.isArray(messageIds)
      ? messageIds
      : messageId
        ? [messageId]
        : req.params?.messageId
          ? [req.params.messageId]
          : [];

    if (!ids.length) {
      return res.status(200).json({ success: true, updatedCount: 0 });
    }

    const validObjectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!validObjectIds.length) {
      return res.status(200).json({ success: true, updatedCount: 0 });
    }

    const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : currentUserId;

    const unconfirmedMessages = await Message.find({
      _id: { $in: validObjectIds },
      $or: [
        { receiverId: currentUserObjectId },
        { receiverId: currentUserId },
      ],
      status: "sent",
    }).select("_id senderId chatId conversationId localId");

    if (!unconfirmedMessages.length) {
      return res.status(200).json({ success: true, updatedCount: 0 });
    }

    const deliveredAt = new Date();
    await Message.updateMany(
      {
        _id: { $in: unconfirmedMessages.map((m) => m._id) },
        status: "sent",
      },
      {
        $set: {
          status: "delivered",
          deliveredAt,
        },
      },
    );

    const io = req.app.get("io");
    if (io) {
      for (const msg of unconfirmedMessages) {
        const updatePayload = {
          messageId: String(msg._id),
          localId: msg.localId || null,
          status: "delivered",
          deliveredAt,
          chatId: msg.chatId ? String(msg.chatId) : null,
          conversationId: msg.conversationId
            ? String(msg.conversationId)
            : null,
        };
        io.to(`user_${msg.senderId}`).emit("message_status_updated", updatePayload);
        if (msg.conversationId) {
          io.to(`conversation_${msg.conversationId}`).emit("message_status_updated", updatePayload);
        }
      }
    }

    return res.status(200).json({
      success: true,
      updatedCount: unconfirmedMessages.length,
    });
  } catch (error) {
    console.error("Mark messages delivered error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// DELETE SINGLE MESSAGE
// =====================================================

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    const { mode = "me" } = req.query;

    const currentUserId = String(req.user.id);

    if (!["me", "everyone"].includes(mode)) {
      return res.status(400).json({
        success: false,

        message: "Invalid delete mode",
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,

        message: "Message not found",
      });
    }

    const senderId = String(message.senderId);

    const receiverId = message.receiverId ? String(message.receiverId) : null;

    // =================================================
    // AUTHORIZATION
    // =================================================

    let isConversationMember = false;

    if (message.conversationId) {
      const conversation = await getConversationForMember(
        message.conversationId,
        currentUserId,
      );

      isConversationMember = Boolean(conversation);
    } else {
      isConversationMember =
        senderId === currentUserId || receiverId === currentUserId;
    }

    if (!isConversationMember) {
      return res.status(403).json({
        success: false,

        message: "You are not allowed to delete this message",
      });
    }

    // =================================================
    // DELETE FOR ME
    // =================================================

    if (mode === "me") {
      const alreadyHidden = message.hiddenFor.some(
        (userId) => String(userId) === currentUserId,
      );

      if (!alreadyHidden) {
        message.hiddenFor.push(currentUserId);

        await message.save();
      }

      return res.status(200).json({
        success: true,

        mode: "me",

        messageId: String(message._id),
      });
    }

    // =================================================
    // DELETE FOR EVERYONE
    // =================================================

    if (senderId !== currentUserId) {
      return res.status(403).json({
        success: false,

        message: "Only the sender can delete this message for everyone",
      });
    }

    // =================================================
    // NO 24 HOUR LIMIT
    // =================================================

    const deletedMessageId = String(message._id);

    const conversationId = message.conversationId
      ? String(message.conversationId)
      : null;

    const chatId = String(message.chatId);

    await Message.deleteOne({
      _id: message._id,
    });

    // =================================================
    // SOCKET UPDATE
    // =================================================

    const io = req.app.get("io");

    if (io) {
      if (conversationId) {
        io.to(`conversation_${conversationId}`).emit("message_deleted", {
          messageId: deletedMessageId,

          conversationId,

          chatId,

          mode: "everyone",
        });
      } else {
        io.to(`group_${chatId}`).emit("message_deleted", {
          messageId: deletedMessageId,

          conversationId: null,

          chatId,

          mode: "everyone",
        });
      }
    }

    return res.status(200).json({
      success: true,

      mode: "everyone",

      messageId: deletedMessageId,
    });
  } catch (error) {
    console.error("Delete message error:", error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};

// =====================================================
// BULK DELETE SELECTED MESSAGES
// =====================================================

const bulkDeleteMessages = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);

    const messageIds = Array.isArray(req.body?.messageIds)
      ? req.body.messageIds
          .map(String)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];

    const mode = req.body?.mode || "me";

    if (!messageIds.length) {
      return res.status(400).json({
        success: false,

        message: "No messages selected",
      });
    }

    if (!["me", "everyone"].includes(mode)) {
      return res.status(400).json({
        success: false,

        message: "Invalid delete mode",
      });
    }

    const uniqueMessageIds = [...new Set(messageIds)];

    const messages = await Message.find({
      _id: {
        $in: uniqueMessageIds,
      },
    });

    if (!messages.length) {
      return res.status(404).json({
        success: false,

        message: "Selected messages were not found",
      });
    }

    // =================================================
    // AUTHORIZATION
    // =================================================

    const conversationIds = [
      ...new Set(
        messages
          .filter((message) => message.conversationId)
          .map((message) => String(message.conversationId)),
      ),
    ];

    const conversations = new Map();

    for (const conversationId of conversationIds) {
      const conversation = await getConversationForMember(
        conversationId,
        currentUserId,
      );

      if (conversation) {
        conversations.set(conversationId, conversation);
      }
    }

    const authorizedMessages = messages.filter((message) => {
      if (message.conversationId) {
        return conversations.has(String(message.conversationId));
      }

      const senderId = String(message.senderId);

      const receiverId = message.receiverId ? String(message.receiverId) : null;

      return senderId === currentUserId || receiverId === currentUserId;
    });

    if (!authorizedMessages.length) {
      return res.status(403).json({
        success: false,

        message: "You are not allowed to delete these messages",
      });
    }

    // =================================================
    // BULK DELETE FOR ME
    // =================================================

    if (mode === "me") {
      const authorizedIds = authorizedMessages.map((message) => message._id);

      await Message.updateMany(
        {
          _id: {
            $in: authorizedIds,
          },
        },

        {
          $addToSet: {
            hiddenFor: currentUserId,
          },
        },
      );

      return res.status(200).json({
        success: true,

        mode: "me",

        deletedMessageIds: authorizedIds.map(String),
      });
    }

    // =================================================
    // BULK DELETE FOR EVERYONE
    // =================================================

    const nonSenderMessages = authorizedMessages.filter(
      (message) => String(message.senderId) !== currentUserId,
    );

    if (nonSenderMessages.length > 0) {
      return res.status(403).json({
        success: false,

        message:
          "Delete for everyone is available only for your own sent messages",
      });
    }

    const deletedMessages = authorizedMessages.map((message) => ({
      messageId: String(message._id),

      conversationId: message.conversationId
        ? String(message.conversationId)
        : null,

      chatId: String(message.chatId),
    }));

    await Message.deleteMany({
      _id: {
        $in: authorizedMessages.map((message) => message._id),
      },
    });

    // =================================================
    // REALTIME UPDATE
    // =================================================

    const io = req.app.get("io");

    if (io) {
      deletedMessages.forEach(({ messageId, conversationId, chatId }) => {
        if (conversationId) {
          io.to(`conversation_${conversationId}`).emit("message_deleted", {
            messageId,

            conversationId,

            chatId,

            mode: "everyone",
          });
        } else {
          io.to(`group_${chatId}`).emit("message_deleted", {
            messageId,

            conversationId: null,

            chatId,

            mode: "everyone",
          });
        }
      });
    }

    return res.status(200).json({
      success: true,

      mode: "everyone",

      deletedMessageIds: deletedMessages.map((item) => item.messageId),
    });
  } catch (error) {
    console.error("Bulk delete messages error:", error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};

// =====================================================
// CLEAR ENTIRE CHAT FOR CURRENT USER
// =====================================================

const clearConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const currentUserId = String(req.user.id);

    const conversation = await getConversationForMember(
      conversationId,
      currentUserId,
    );

    if (!conversation) {
      return res.status(403).json({
        success: false,

        message: "You are not a conversation member",
      });
    }

    await Message.updateMany(
      {
        conversationId,

        hiddenFor: {
          $ne: currentUserId,
        },
      },

      {
        $addToSet: {
          hiddenFor: currentUserId,
        },
      },
    );

    return res.status(200).json({
      success: true,

      mode: "me",

      conversationId: String(conversationId),
    });
  } catch (error) {
    console.error("Clear conversation error:", error);

    return res.status(500).json({
      success: false,

      message: error.message,
    });
  }
};

// =====================================================
// SEND MESSAGE (REST API FALLBACK / PERSISTENCE)
// =====================================================

const sendMessage = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);
    const {
      receiverId,
      conversationId,
      chatId,
      text,
      time,
      localId,
      clientTempId,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message text is required",
      });
    }

    const messageTime =
      time ||
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

    let targetConversation = null;
    let finalChatId = chatId;
    let finalReceiverId = receiverId ? String(receiverId) : null;

    if (conversationId && isValidConversationId(conversationId)) {
      targetConversation = await getConversationForMember(
        conversationId,
        currentUserId,
      );

      if (!targetConversation) {
        return res.status(403).json({
          success: false,
          message: "You are not a conversation member",
        });
      }

      if (targetConversation.type === "group") {
        const senderMember = targetConversation.members?.find(
          (m) => String(m.userId) === currentUserId,
        );
        const isSenderAdmin =
          senderMember?.role === "admin" ||
          senderMember?.role === "owner" ||
          String(targetConversation.createdBy) === currentUserId;

        if (
          targetConversation.permissions?.sendMessages === "admins" &&
          !isSenderAdmin
        ) {
          return res.status(403).json({
            success: false,
            message: "Only group admins can send messages in this group",
          });
        }
        finalChatId = String(conversationId);
        finalReceiverId = null;
      } else {
        const otherMember = targetConversation.members?.find(
          (m) => String(m.userId) !== currentUserId,
        );
        finalReceiverId = otherMember
          ? String(otherMember.userId)
          : receiverId;
        finalChatId = [currentUserId, finalReceiverId].sort().join("_");
      }
    } else if (finalReceiverId) {
      const receiver = await User.findById(finalReceiverId).select("_id");
      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: "Receiver not found",
        });
      }

      if (!(await areFriends(currentUserId, finalReceiverId))) {
        return res.status(403).json({
          success: false,
          message: "Users are not accepted friends",
        });
      }

      targetConversation = await getOrCreatePrivateConversation(
        currentUserId,
        finalReceiverId,
      );
      finalChatId = [currentUserId, finalReceiverId].sort().join("_");
    } else {
      return res.status(400).json({
        success: false,
        message: "receiverId or conversationId required",
      });
    }

    // Unhide conversation
    await Conversation.updateOne(
      { _id: targetConversation._id },
      {
        $pull: {
          hiddenFor: {
            $in: [
              currentUserId,
              new mongoose.Types.ObjectId(currentUserId),
              ...(finalReceiverId
                ? [
                    finalReceiverId,
                    new mongoose.Types.ObjectId(finalReceiverId),
                  ]
                : []),
            ],
          },
        },
      },
    );

    const savedMessage = await Message.create({
      chatId: finalChatId,
      conversationId: targetConversation._id,
      senderId: currentUserId,
      receiverId: finalReceiverId,
      text: text.trim(),
      time: messageTime,
      status: "sent",
      deliveredAt: null,
      localId: localId || clientTempId || null,
    });

    const responsePayload = {
      _id: String(savedMessage._id),
      chatId: String(savedMessage.chatId),
      conversationId: String(savedMessage.conversationId),
      senderId: String(savedMessage.senderId),
      receiverId: savedMessage.receiverId
        ? String(savedMessage.receiverId)
        : null,
      text: savedMessage.text,
      time: savedMessage.time,
      createdAt: savedMessage.createdAt,
      status: savedMessage.status,
      localId: localId || clientTempId || null,
    };

    const io = req.app.get("io");
    if (io) {
      if (targetConversation.type === "group") {
        io.to(`group_${finalChatId}`).emit("receive_message", {
          ...responsePayload,
          type: "group",
        });
      } else if (finalReceiverId) {
        io.to(`user_${finalReceiverId}`).emit("receive_private_message", {
          ...responsePayload,
          type: "received",
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: responsePayload,
      localId: localId || clientTempId || null,
    });
  } catch (error) {
    console.error("REST sendMessage error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  getMessages,

  sendMessage,

  getPrivateChatId,

  getMessageCount,

  getUnreadCounts,

  markConversationRead,

  markMessagesDelivered,

  deleteMessage,

  bulkDeleteMessages,

  clearConversation,
};

