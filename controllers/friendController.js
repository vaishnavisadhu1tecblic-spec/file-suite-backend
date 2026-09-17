const mongoose = require("mongoose");

const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");

const userFields = "name username email image";

const isValidUserId = (userId) =>
  mongoose.Types.ObjectId.isValid(String(userId));

const serializeUser = (user) => ({
  _id: String(user._id),
  name: user.name,
  username: user.username,
  email: user.email,
  image: user.image || "",
});

const getRelationship = async (currentUserId, otherUserId) => {
  const currentUser = await User.findById(currentUserId).select("friends");
  const friends = currentUser?.friends || [];

  if (friends.some((friendId) => String(friendId) === String(otherUserId))) {
    return { status: "Already Friends" };
  }

  const request = await FriendRequest.findOne({
    $or: [
      { requester: currentUserId, recipient: otherUserId },
      { requester: otherUserId, recipient: currentUserId },
    ],
    status: "pending",
  });

  if (!request) {
    return { status: "Add Friend" };
  }

  return {
    status: "Pending",
    requestId: String(request._id),
    direction:
      String(request.requester) === String(currentUserId)
        ? "outgoing"
        : "incoming",
  };
};

const searchUsers = async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    if (!query) {
      return res.status(200).json({ success: true, users: [] });
    }

    const users = await User.find({
      _id: { $ne: req.user.id },
      $or: [
        { name: { $regex: query, $options: "i" } },
        { username: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
    })
      .select(userFields)
      .limit(20)
      .lean();

    const results = await Promise.all(
      users.map(async (user) => ({
        ...serializeUser(user),
        ...(await getRelationship(req.user.id, user._id)),
      })),
    );

    return res.status(200).json({ success: true, users: results });
  } catch (error) {
    console.error("Search users error:", error);
    return res.status(500).json({ message: "Unable to search users" });
  }
};

const listFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("friends", userFields)
      .select("friends")
      .lean();

    const friends = (user?.friends || [])
      .filter((friend) => String(friend._id) !== String(req.user.id))
      .map(serializeUser);

    return res.status(200).json({ success: true, friends });
  } catch (error) {
    console.error("List friends error:", error);
    return res.status(500).json({ message: "Unable to load friends" });
  }
};

const listFriendRequests = async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.user.id,
      status: "pending",
    })
      .populate("requester", userFields)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      requests: requests
        .filter((request) => request.requester)
        .map((request) => ({
          _id: String(request._id),
          createdAt: request.createdAt,
          requester: serializeUser(request.requester),
        })),
    });
  } catch (error) {
    console.error("List friend requests error:", error);
    return res.status(500).json({ message: "Unable to load friend requests" });
  }
};

const sendFriendRequest = async (req, res) => {
  const recipientId = String(req.params.userId);

  if (!isValidUserId(recipientId)) {
    return res.status(400).json({ message: "Invalid user" });
  }

  if (recipientId === String(req.user.id)) {
    return res.status(400).json({ message: "You cannot add yourself" });
  }

  try {
    const recipient = await User.findById(recipientId).select("_id");

    if (!recipient) {
      return res.status(404).json({ message: "User not found" });
    }

    const relationship = await getRelationship(req.user.id, recipientId);

    if (relationship.status === "Already Friends") {
      return res.status(409).json(relationship);
    }

    if (relationship.status === "Pending") {
      return res.status(409).json(relationship);
    }

    const request = await FriendRequest.create({
      requester: req.user.id,
      recipient: recipientId,
    });

    return res.status(201).json({
      success: true,
      status: "Pending",
      requestId: String(request._id),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: "Pending" });
    }

    console.error("Send friend request error:", error);
    return res.status(500).json({ message: "Unable to send friend request" });
  }
};

const acceptFriendRequest = async (req, res) => {
  if (!isValidUserId(req.params.requestId)) {
    return res.status(400).json({ message: "Invalid friend request" });
  }

  try {
    const request = await FriendRequest.findOne({
      _id: req.params.requestId,
      recipient: req.user.id,
      status: "pending",
    });

    if (!request) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    await User.updateOne(
      { _id: req.user.id },
      { $addToSet: { friends: request.requester } },
    );
    await User.updateOne(
      { _id: request.requester },
      { $addToSet: { friends: req.user.id } },
    );
    await FriendRequest.deleteOne({ _id: request._id });

    return res.status(200).json({ success: true, status: "Accepted" });
  } catch (error) {
    console.error("Accept friend request error:", error);
    return res.status(500).json({ message: "Unable to accept friend request" });
  }
};

const rejectFriendRequest = async (req, res) => {
  if (!isValidUserId(req.params.requestId)) {
    return res.status(400).json({ message: "Invalid friend request" });
  }

  try {
    const result = await FriendRequest.deleteOne({
      _id: req.params.requestId,
      recipient: req.user.id,
      status: "pending",
    });

    if (!result.deletedCount) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    return res.status(200).json({ success: true, status: "Rejected" });
  } catch (error) {
    console.error("Reject friend request error:", error);
    return res.status(500).json({ message: "Unable to reject friend request" });
  }
};

module.exports = {
  searchUsers,
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
};
