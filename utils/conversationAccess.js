const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const { areFriends } = require("./friendAccess");

const isValidConversationId = (conversationId) =>
  mongoose.Types.ObjectId.isValid(String(conversationId));

const getMember = (conversation, userId) =>
  conversation?.members?.find(
    (member) => String(member.userId) === String(userId),
  );

const getConversationForMember = async (conversationId, userId) => {
  if (!isValidConversationId(conversationId)) {
    return null;
  }

  const conversation = await Conversation.findOne({
    _id: conversationId,
    "members.userId": userId,
  });

  if (!conversation) {
    return null;
  }

  if (conversation.type === "private") {
    const otherMember = conversation.members.find(
      (member) => String(member.userId) !== String(userId),
    );

    if (!otherMember || !(await areFriends(userId, otherMember.userId))) {
      return null;
    }
  }

  return conversation;
};

const getOrCreatePrivateConversation = async (userId, otherUserId) => {
  const privateKey = [String(userId), String(otherUserId)].sort().join(":");

  let conversation = await Conversation.findOne({
    type: "private",
    privateKey,
  });

  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: "private",
        privateKey,
        createdBy: userId,
        members: [
          { userId, role: "admin" },
          { userId: otherUserId, role: "member" },
        ],
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      conversation = await Conversation.findOne({
        type: "private",
        privateKey,
      });
    }
  }

  return conversation;
};

const getOrCreateLegacyConversation = async (legacyChatId, userId, name) => {
  let conversation = await Conversation.findOne({
    type: "group",
    legacyChatId: String(legacyChatId),
  });

  if (!conversation) {
    conversation = await Conversation.create({
      type: "group",
      name: name || `Group ${legacyChatId}`,
      legacyChatId: String(legacyChatId),
      createdBy: userId,
      members: [{ userId, role: "admin" }],
    });
  }

  return conversation;
};

module.exports = {
  isValidConversationId,
  getMember,
  getConversationForMember,
  getOrCreatePrivateConversation,
  getOrCreateLegacyConversation,
};
