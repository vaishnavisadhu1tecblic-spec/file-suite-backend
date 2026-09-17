const Message = require("../models/Message");
const Conversation = require("../models/Conversation");

const {
  getConversationForMember,
  isValidConversationId,
} = require("../utils/conversationAccess");

const { areFriends } = require("../utils/friendAccess");

// =====================================================
// DELETE SETTINGS
// =====================================================

// Phase 1 default limit.
// Settings UI later can make this configurable.
const DELETE_FOR_EVERYONE_LIMIT_HOURS = 24;

// =====================================================
// CREATE PRIVATE CHAT ID
// =====================================================

const getPrivateChatId = (user1, user2) => {
  return [String(user1), String(user2)].sort().join("_");
};

// =====================================================
// GET CHAT MESSAGES
// =====================================================

const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const currentUserId = String(req.user.id);

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

      const conversationMessages = await Message.find({
        conversationId: chatId,
        hiddenFor: {
          $ne: currentUserId,
        },
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        messages: conversationMessages,
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

      const legacyMessages = await Message.find({
        hiddenFor: {
          $ne: currentUserId,
        },
        $or: [
          { conversationId: legacyConversation._id },
          {
            chatId: String(chatId),
            receiverId: null,
          },
        ],
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        messages: legacyMessages,
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

    const messages = await Message.find({
      conversationId: privateConversation._id,
      hiddenFor: {
        $ne: currentUserId,
      },
    })
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error);

    res.status(500).json({
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
        { senderId: currentUserId },
        { receiverId: currentUserId },
        { receiverId: null },
      ],
      hiddenFor: {
        $ne: currentUserId,
      },
    });

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Get message count error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =====================================================
// DELETE MESSAGE
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

    // Only sender can delete for everyone.
    if (senderId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: "Only the sender can delete this message for everyone",
      });
    }

    const createdAt = message.createdAt ? new Date(message.createdAt) : null;

    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Message creation time is unavailable",
      });
    }

    const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

    if (ageInHours > DELETE_FOR_EVERYONE_LIMIT_HOURS) {
      return res.status(400).json({
        success: false,
        message: `Delete for everyone is available only within ${DELETE_FOR_EVERYONE_LIMIT_HOURS} hours`,
      });
    }

    const deletedMessageId = String(message._id);
    const conversationId = message.conversationId
      ? String(message.conversationId)
      : null;
    const chatId = String(message.chatId);

    await Message.deleteOne({
      _id: message._id,
    });

    // =================================================
    // REAL-TIME SOCKET UPDATE
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

module.exports = {
  getMessages,
  getPrivateChatId,
  getMessageCount,
  deleteMessage,
};
