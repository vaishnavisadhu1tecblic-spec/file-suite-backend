const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  getMessages,
  sendMessage,
  getMessageCount,
  getUnreadCounts,
  markConversationRead,
  markMessagesDelivered,
  deleteMessage,
  bulkDeleteMessages,
  clearConversation,
} = require("../controllers/messageController");

// =====================================================
// SEND MESSAGE
// =====================================================

router.post("/", authMiddleware, sendMessage);
router.post("/send", authMiddleware, sendMessage);

// =====================================================
// MESSAGE DELIVERY & READ STATUS
// =====================================================

router.post("/delivered", authMiddleware, markMessagesDelivered);
router.post("/:messageId/delivered", authMiddleware, markMessagesDelivered);

router.get("/count", authMiddleware, getMessageCount);

router.get("/unread-counts", authMiddleware, getUnreadCounts);

router.patch(
  "/conversation/:conversationId/read",
  authMiddleware,
  markConversationRead,
);

router.post(
  "/conversation/:conversationId/read",
  authMiddleware,
  markConversationRead,
);

// =====================================================
// BULK DELETE
// =====================================================

router.delete("/bulk", authMiddleware, bulkDeleteMessages);

// =====================================================
// CLEAR CHAT
// =====================================================

router.delete(
  "/conversation/:conversationId/clear",
  authMiddleware,
  clearConversation,
);

// =====================================================
// SINGLE MESSAGE DELETE
// =====================================================

router.delete("/:messageId", authMiddleware, deleteMessage);

// =====================================================
// GET CHAT MESSAGES
// =====================================================

router.get("/:chatId", authMiddleware, getMessages);

module.exports = router;
