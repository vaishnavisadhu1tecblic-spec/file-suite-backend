const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: String,
      required: true,
      index: true,
    },

    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      required: false,
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    messageType: {
      type: String,
      enum: ["text", "file"],
      default: "text",
    },

    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      default: null,
    },

    attachment: {
      name: { type: String, default: "" },
      type: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
      permission: {
        type: String,
        enum: ["view", "download"],
        default: "download",
      },
    },

    time: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Message", messageSchema);
