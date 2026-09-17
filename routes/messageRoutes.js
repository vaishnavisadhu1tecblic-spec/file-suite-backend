const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  getMessages,
  getMessageCount,
  deleteMessage,
} = require("../controllers/messageController");

router.get("/count", authMiddleware, getMessageCount);

router.delete("/:messageId", authMiddleware, deleteMessage);

router.get("/:chatId", authMiddleware, getMessages);

module.exports = router;
