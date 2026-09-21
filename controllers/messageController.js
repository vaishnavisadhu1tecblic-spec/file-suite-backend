const mongoose = require("mongoose");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");

const {
  getConversationForMember,
  isValidConversationId,
} = require("../utils/conversationAccess");

const { areFriends } = require("../utils/friendAccess");

// =====================================================
// MESSAGE PAGINATION
// =====================================================

const DEFAULT_MESSAGE_LIMIT = 20;
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

  if (before) {
    const beforeDate = new Date(before);

    if (!Number.isNaN(beforeDate.getTime())) {
      if (beforeId && mongoose.Types.ObjectId.isValid(beforeId)) {
        queryFilter.$or = [
          {
            createdAt: {
              $lt: beforeDate,
            },
          },
          {
            createdAt: beforeDate,
            _id: {
              $lt: beforeId,
            },
          },
        ];
      } else {
        queryFilter.createdAt = {
          $lt: beforeDate,
        };
      }
    }
  }

  const messages = await Message.find(queryFilter)
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

    const before = req.query.before || null;

    const beforeId = req.query.beforeId || null;

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

      const result = await getPaginatedMessages({
        filter: {
          conversationId: chatId,
          hiddenFor: {
            $ne: currentUserId,
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

      const result = await getPaginatedMessages({
        filter: {
          hiddenFor: {
            $ne: currentUserId,
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
    // LEGACY PRIVATE CHAT
    // =================================================

    const privateConversation = await Conversation.findOne({
      type: "private",

      privateKey: String(chatId).split("_").sort().join(":"),

      "members.userId": currentUserId,
    });

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

    const result = await getPaginatedMessages({
      filter: {
        conversationId: privateConversation._id,

        hiddenFor: {
          $ne: currentUserId,
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

    const unreadMessages = await Message.aggregate([
      {
        $match: {
          receiverId: currentUserObjectId,

          status: {
            $ne: "read",
          },

          hiddenFor: {
            $ne: currentUserObjectId,
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
// EXPORTS
// =====================================================

module.exports = {
  getMessages,

  getPrivateChatId,

  getMessageCount,

  getUnreadCounts,

  deleteMessage,

  bulkDeleteMessages,

  clearConversation,
};
