const mongoose = require("mongoose");

const backupSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    backupPath: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      default: 0,
    },

    messageCount: {
      type: Number,
      default: 0,
    },

    conversationCount: {
      type: Number,
      default: 0,
    },

    includesPhotos: {
      type: Boolean,
      default: true,
    },

    includesVideos: {
      type: Boolean,
      default: false,
    },

    includesDocuments: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ["completed", "failed", "in_progress"],
      default: "completed",
    },
  },
  {
    timestamps: true,
  },
);

backupSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Backup", backupSchema);
