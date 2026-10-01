const fs = require("fs");
const path = require("path");
const Status = require("../models/Status");
const User = require("../models/User");
const { areFriends } = require("../utils/friendAccess");

const getStatuses = async (req, res) => {
  try {
    const currentUserId = String(req.user.id);
    const now = new Date();

    // Get user and friends
    const currentUser = await User.findById(currentUserId).select("friends");
    const friendIds = (currentUser?.friends || []).map(String);

    // Fetch active statuses (less than 24h old)
    const allStatuses = await Status.find({
      expiresAt: { $gt: now },
    })
      .populate("userId", "name username email image")
      .populate("viewers.userId", "name username email image")
      .sort({ createdAt: 1 })
      .lean();

    // Filter statuses based on privacy rules and relationship
    const myStatuses = [];
    const friendsStatusesMap = new Map();

    allStatuses.forEach((status) => {
      const statusOwnerId = String(status.userId?._id || status.userId);

      // Check if it's my status
      if (statusOwnerId === currentUserId) {
        myStatuses.push({
          ...status,
          isMine: true,
          hasViewed: true,
        });
        return;
      }

      // Must be friends to see each other's status
      if (!friendIds.includes(statusOwnerId)) {
        return;
      }

      // Check privacy settings
      const privacy = status.privacy || { type: "all", userIds: [] };
      if (privacy.type === "include") {
        const allowed = (privacy.userIds || []).map(String);
        if (!allowed.includes(currentUserId)) return;
      } else if (privacy.type === "exclude") {
        const blocked = (privacy.userIds || []).map(String);
        if (blocked.includes(currentUserId)) return;
      }

      // Determine if current user viewed this status
      const hasViewed = (status.viewers || []).some(
        (v) => String(v.userId?._id || v.userId) === currentUserId,
      );

      if (!friendsStatusesMap.has(statusOwnerId)) {
        friendsStatusesMap.set(statusOwnerId, {
          user: status.userId,
          hasUnseen: false,
          statuses: [],
        });
      }

      const userGroup = friendsStatusesMap.get(statusOwnerId);
      userGroup.statuses.push({
        ...status,
        isMine: false,
        hasViewed,
      });

      if (!hasViewed) {
        userGroup.hasUnseen = true;
      }
    });

    const recentUpdates = [];
    const viewedUpdates = [];

    friendsStatusesMap.forEach((group) => {
      if (group.hasUnseen) {
        recentUpdates.push(group);
      } else {
        viewedUpdates.push(group);
      }
    });

    return res.status(200).json({
      success: true,
      myStatuses,
      recentUpdates,
      viewedUpdates,
      statuses: allStatuses.map((s) => ({
        ...s,
        user: s.userId,
      })),
    });
  } catch (error) {
    console.error("Get statuses error:", error);
    return res.status(500).json({ message: "Unable to load statuses" });
  }
};

const createStatus = async (req, res) => {
  try {
    const {
      type = "text",
      text = "",
      bgColor = "#315eff",
      textColor = "#ffffff",
      fontStyle = "normal",
      privacyType = "all",
      privacyUsers = "[]",
    } = req.body;

    let mediaPath = "";
    let mediaOriginalName = "";
    let mediaMimeType = "";
    let audioPath = "";
    let audioName = "";

    // Uploaded files: req.files can have 'media' and/or 'audio'
    if (req.files) {
      if (req.files.media && req.files.media[0]) {
        mediaPath = req.files.media[0].filename;
        mediaOriginalName = req.files.media[0].originalname;
        mediaMimeType = req.files.media[0].mimetype;
      }
      if (req.files.audio && req.files.audio[0]) {
        audioPath = req.files.audio[0].filename;
        audioName = req.files.audio[0].originalname;
      }
    } else if (req.file) {
      mediaPath = req.file.filename;
      mediaOriginalName = req.file.originalname;
      mediaMimeType = req.file.mimetype;
    }

    let parsedPrivacyUsers = [];
    try {
      parsedPrivacyUsers = JSON.parse(privacyUsers);
    } catch {
      parsedPrivacyUsers = [];
    }

    const status = await Status.create({
      userId: req.user.id,
      type,
      text: String(text || "").trim(),
      mediaPath,
      mediaOriginalName,
      mediaMimeType,
      audioPath,
      audioName,
      bgColor,
      textColor,
      fontStyle,
      privacy: {
        type: privacyType,
        userIds: parsedPrivacyUsers,
      },
      viewers: [],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const populated = await Status.findById(status._id)
      .populate("userId", "name username email image")
      .lean();

    const io = req.app.get("io");
    if (io) {
      const user = await User.findById(req.user.id).select("friends");
      (user?.friends || []).forEach((friendId) => {
        io.to(`user_${friendId}`).emit("status:created", populated);
      });
      io.to(`user_${req.user.id}`).emit("status:created", populated);
    }

    return res.status(201).json({
      success: true,
      status: populated,
    });
  } catch (error) {
    console.error("Create status error:", error);
    return res.status(500).json({ message: "Unable to create status" });
  }
};

const viewStatus = async (req, res) => {
  try {
    const statusId = req.params.id;
    const currentUserId = req.user.id;

    const status = await Status.findById(statusId);
    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    // Don't mark own status as viewed in list
    if (String(status.userId) !== String(currentUserId)) {
      const alreadyViewed = status.viewers.some(
        (v) => String(v.userId) === String(currentUserId),
      );

      if (!alreadyViewed) {
        status.viewers.push({
          userId: currentUserId,
          viewedAt: new Date(),
        });
        await status.save();

        const io = req.app.get("io");
        if (io) {
          io.to(`user_${status.userId}`).emit("status:viewed", {
            statusId: String(status._id),
            viewerId: String(currentUserId),
            viewedAt: new Date(),
          });
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("View status error:", error);
    return res.status(500).json({ message: "Unable to mark status viewed" });
  }
};

const getStatusViewers = async (req, res) => {
  try {
    const statusId = req.params.id;
    const status = await Status.findById(statusId)
      .populate("viewers.userId", "name username email image")
      .lean();

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    if (String(status.userId) !== String(req.user.id)) {
      return res
        .status(403)
        .json({ message: "You can only view viewers of your own status" });
    }

    return res.status(200).json({
      success: true,
      viewers: status.viewers || [],
    });
  } catch (error) {
    console.error("Get status viewers error:", error);
    return res.status(500).json({ message: "Unable to fetch status viewers" });
  }
};

const deleteStatus = async (req, res) => {
  try {
    const statusId = req.params.id;
    const status = await Status.findById(statusId);

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    if (String(status.userId) !== String(req.user.id)) {
      return res
        .status(403)
        .json({ message: "You can only delete your own status" });
    }

    // Delete media files from disk if present
    if (status.mediaPath) {
      const p = path.join(__dirname, "..", "uploads", status.mediaPath);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          console.error("Error deleting status media:", e);
        }
      }
    }
    if (status.audioPath) {
      const p = path.join(__dirname, "..", "uploads", status.audioPath);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          console.error("Error deleting status audio:", e);
        }
      }
    }

    await Status.deleteOne({ _id: statusId });

    const io = req.app.get("io");
    if (io) {
      const user = await User.findById(req.user.id).select("friends");
      (user?.friends || []).forEach((friendId) => {
        io.to(`user_${friendId}`).emit("status:deleted", {
          statusId: String(statusId),
        });
      });
      io.to(`user_${req.user.id}`).emit("status:deleted", {
        statusId: String(statusId),
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Status deleted successfully" });
  } catch (error) {
    console.error("Delete status error:", error);
    return res.status(500).json({ message: "Unable to delete status" });
  }
};

const streamStatusMedia = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status || !status.mediaPath) {
      return res.status(404).json({ message: "Status media not found" });
    }

    const filePath = path.join(__dirname, "..", "uploads", status.mediaPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Media file missing on server" });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error("Stream status media error:", error);
    return res.status(500).json({ message: error.message });
  }
};

const streamStatusAudio = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status || !status.audioPath) {
      return res.status(404).json({ message: "Status audio not found" });
    }

    const filePath = path.join(__dirname, "..", "uploads", status.audioPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Audio file missing on server" });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error("Stream status audio error:", error);
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getStatuses,
  createStatus,
  viewStatus,
  getStatusViewers,
  deleteStatus,
  streamStatusMedia,
  streamStatusAudio,
};
