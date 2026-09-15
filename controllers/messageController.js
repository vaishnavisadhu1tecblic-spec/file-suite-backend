const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const {
  getConversationForMember,
  isValidConversationId,
} = require("../utils/conversationAccess");

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
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        messages: conversationMessages,
      });
    }

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
        $or: [
          { conversationId: legacyConversation._id },
          { chatId: String(chatId), receiverId: null },
        ],
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        messages: legacyMessages,
      });
    }

    const privateConversation = await Conversation.findOne({
      type: "private",
      privateKey: String(chatId).split("_").sort().join(":"),
      "members.userId": currentUserId,
    });

    if (!privateConversation) {
      return res.status(403).json({
        success: false,
        message: "You are not a conversation member",
      });
    }

    const messages = await Message.find({
      conversationId: privateConversation._id,
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
// EXPORTS
// =====================================================

module.exports = {
  getMessages,
  getPrivateChatId,
  getMessageCount,
};
