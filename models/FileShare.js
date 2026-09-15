const mongoose = require("mongoose");

const fileShareSchema = new mongoose.Schema(
  {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    permission: {
      type: String,
      enum: ["view", "download"],
      default: "download",
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

fileShareSchema.index({ fileId: 1, conversationId: 1 }, { unique: true });

module.exports = mongoose.model("FileShare", fileShareSchema);
