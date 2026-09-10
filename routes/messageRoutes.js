const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  getMessages,
  getMessageCount,
} = require("../controllers/messageController");

// =====================================================
// GET TOTAL MESSAGE COUNT
// =====================================================

router.get("/count", authMiddleware, getMessageCount);

// =====================================================
// GET MESSAGES OF A CHAT
// =====================================================

router.get("/:chatId", authMiddleware, getMessages);

module.exports = router;
