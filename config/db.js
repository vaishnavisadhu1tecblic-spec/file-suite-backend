const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");

const ensureConversationIndexes = async () => {
  const collection = mongoose.connection.db.collection("conversations");
  const indexes = await collection.indexes();
  const privateKeyIndex = indexes.find(
    (index) => index.name === "privateKey_1",
  );
  const hasCorrectPrivateKeyIndex =
    privateKeyIndex?.unique === true &&
    privateKeyIndex.partialFilterExpression?.type === "private" &&
    privateKeyIndex.partialFilterExpression?.privateKey?.$type === "string";

  if (privateKeyIndex && !hasCorrectPrivateKeyIndex) {
    await collection.dropIndex("privateKey_1");
    console.log("Replaced malformed conversations privateKey_1 index");
  }

  await Conversation.createIndexes();
};

const connectDB = async () => {
  try {
    console.log(process.env.MONGO_URI);
    await mongoose.connect(process.env.MONGO_URI);
    await ensureConversationIndexes();
    console.log("MongoDB Connected");
  } catch (error) {
    console.log(error.message);
  }
};

module.exports = connectDB;
