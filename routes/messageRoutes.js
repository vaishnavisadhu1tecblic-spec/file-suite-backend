const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const { getMessages } = require("../controllers/messageController");

// Get messages of a chat
router.get("/:chatId", authMiddleware, getMessages);

module.exports = router;
