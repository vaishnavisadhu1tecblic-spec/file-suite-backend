const User = require("../models/User");

const areFriends = async (userId, otherUserId) => {
  if (String(userId) === String(otherUserId)) {
    return false;
  }

  const user = await User.findOne({
    _id: userId,
    friends: otherUserId,
  }).select("_id");

  return Boolean(user);
};

module.exports = { areFriends };
