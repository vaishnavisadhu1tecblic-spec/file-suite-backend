const Message = require("../models/Message");

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

    const messages = await Message.find({
      chatId: String(chatId),

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

module.exports = {
  getMessages,
  getPrivateChatId,
};
