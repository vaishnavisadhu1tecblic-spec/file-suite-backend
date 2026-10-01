const Call = require("../models/Call");
const Conversation = require("../models/Conversation");
const User = require("../models/User");

const getCallHistory = async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const calls = await Call.find({
      $or: [{ callerId: currentUserId }, { receiverId: currentUserId }],
    })
      .populate("callerId", "name username email image")
      .populate("receiverId", "name username email image")
      .populate("conversationId", "name avatar type")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const formattedCalls = calls.map((call) => {
      const isCaller = String(call.callerId?._id || call.callerId) === String(currentUserId);
      const otherParty = isCaller ? call.receiverId : call.callerId;

      let direction = "outgoing";
      if (!isCaller) {
        direction = call.status === "missed" ? "missed" : "incoming";
      }

      return {
        _id: String(call._id),
        type: call.type, // 'voice' | 'video'
        direction,
        status: call.status,
        duration: call.duration || 0,
        startedAt: call.startedAt || call.createdAt,
        endedAt: call.endedAt,
        isGroup: Boolean(call.isGroup),
        otherParty: otherParty || { name: "Unknown User" },
        conversation: call.conversationId || null,
      };
    });

    return res.status(200).json({
      success: true,
      calls: formattedCalls,
    });
  } catch (error) {
    console.error("Get call history error:", error);
    return res.status(500).json({ message: "Unable to load call history" });
  }
};

const deleteCall = async (req, res) => {
  try {
    const callId = req.params.id;
    const currentUserId = req.user.id;

    const call = await Call.findOne({
      _id: callId,
      $or: [{ callerId: currentUserId }, { receiverId: currentUserId }],
    });

    if (!call) {
      return res.status(404).json({ message: "Call record not found" });
    }

    await Call.deleteOne({ _id: callId });

    return res.status(200).json({
      success: true,
      message: "Call record deleted",
    });
  } catch (error) {
    console.error("Delete call error:", error);
    return res.status(500).json({ message: "Unable to delete call record" });
  }
};

const clearCallHistory = async (req, res) => {
  try {
    const currentUserId = req.user.id;

    await Call.deleteMany({
      $or: [{ callerId: currentUserId }, { receiverId: currentUserId }],
    });

    return res.status(200).json({
      success: true,
      message: "Call history cleared",
    });
  } catch (error) {
    console.error("Clear call history error:", error);
    return res.status(500).json({ message: "Unable to clear call history" });
  }
};

module.exports = {
  getCallHistory,
  deleteCall,
  clearCallHistory,
};
