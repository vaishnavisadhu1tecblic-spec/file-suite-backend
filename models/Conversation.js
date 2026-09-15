const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["private", "group"],
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    avatar: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    members: {
      type: [memberSchema],
      validate: {
        validator: (members) => members.length > 0,
        message: "A conversation must have at least one member",
      },
    },
    privateKey: {
      type: String,
      default: undefined,
    },
    legacyChatId: {
      type: String,
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ "members.userId": 1 });
conversationSchema.index({ type: 1, legacyChatId: 1 });
conversationSchema.index(
  { privateKey: 1 },
  {
    name: "privateKey_1",
    unique: true,
    partialFilterExpression: {
      type: "private",
      privateKey: { $type: "string" },
    },
  },
);

module.exports = mongoose.model("Conversation", conversationSchema);
