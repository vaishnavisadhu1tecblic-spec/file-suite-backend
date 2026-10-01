const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["text", "photo", "video", "photo_music", "video_music"],
      required: true,
    },

    text: {
      type: String,
      default: "",
    },

    mediaPath: {
      type: String,
      default: "",
    },

    mediaOriginalName: {
      type: String,
      default: "",
    },

    mediaMimeType: {
      type: String,
      default: "",
    },

    audioPath: {
      type: String,
      default: "",
    },

    audioName: {
      type: String,
      default: "",
    },

    bgColor: {
      type: String,
      default: "#315eff",
    },

    textColor: {
      type: String,
      default: "#ffffff",
    },

    fontStyle: {
      type: String,
      default: "normal",
    },

    privacy: {
      type: {
        type: String,
        enum: ["all", "include", "exclude"],
        default: "all",
      },
      userIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
    },

    viewers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

statusSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Status", statusSchema);
