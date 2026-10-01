const mongoose = require("mongoose");

const callParticipantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    leftAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const callSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: ["voice", "video"],
      required: true,
      default: "voice",
    },

    isGroup: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["completed", "missed", "rejected", "busy", "ongoing"],
      default: "completed",
      index: true,
    },

    duration: {
      type: Number, // in seconds
      default: 0,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    endedAt: {
      type: Date,
      default: null,
    },

    participants: [callParticipantSchema],
  },
  {
    timestamps: true,
  },
);

callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, createdAt: -1 });

module.exports = mongoose.model("Call", callSchema);
