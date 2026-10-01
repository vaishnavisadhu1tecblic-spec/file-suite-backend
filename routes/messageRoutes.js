const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  getMessages,
  getMessageCount,
  getUnreadCounts,
  markConversationRead,
  deleteMessage,
  bulkDeleteMessages,
  clearConversation,
} = require("../controllers/messageController");

// =====================================================
// MESSAGE COUNTS & READ STATUS
// =====================================================

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
