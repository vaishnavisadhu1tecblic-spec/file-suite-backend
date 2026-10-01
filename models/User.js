const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    image: {
      type: String,
    },

    name: {
      type: String,
      required: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: false, // Google login ke liye
    },

    friends: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    about: {
      type: String,
      default: "Hey there! I am using SyncSpace.",
    },

    backupSettings: {
      autoBackup: {
        type: String,
        enum: ["never", "daily", "weekly", "monthly"],
        default: "never",
      },
      includePhotos: {
        type: Boolean,
        default: true,
      },
      includeVideos: {
        type: Boolean,
        default: false,
      },
      includeDocs: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("User", userSchema);
