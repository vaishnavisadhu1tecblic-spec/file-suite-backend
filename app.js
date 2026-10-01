const express = require("express");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

require("dotenv").config();

const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const fileRoutes = require("./routes/fileRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const friendRoutes = require("./routes/friendRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const statusRoutes = require("./routes/statusRoutes");
const callRoutes = require("./routes/callRoutes");
const backupRoutes = require("./routes/backupRoutes");

const Message = require("./models/Message");
const Conversation = require("./models/Conversation");
const User = require("./models/User");
const Call = require("./models/Call");
const Status = require("./models/Status");

const {
  getConversationForMember,
  getOrCreateLegacyConversation,
  isValidConversationId,
} = require("./utils/conversationAccess");

const { areFriends } = require("./utils/friendAccess");

const onlineUsers = new Map();
const activeCalls = new Map();

const app = express();

// =====================================================
// DATABASE
// =====================================================

connectDB();

// =====================================================
// MIDDLEWARE
// =====================================================

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://192.168.0.102:5173",
  "http://192.168.0.102:5174",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".trycloudflare.com") ||
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use(express.json());
app.use("/api/dashboard", dashboardRoutes);
// =====================================================
// ROUTES
// =====================================================

app.use("/api/auth", authRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/backup", backupRoutes);

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.send("File Suite Backend Running...");
});

// =====================================================
// HTTP SERVER
// =====================================================

const server = http.createServer(app);

// =====================================================
// SOCKET.IO
// =====================================================

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".trycloudflare.com") ||
        /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

// =====================================================
// SOCKET AUTHENTICATION
// =====================================================

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      console.error("Socket authentication failed: Token missing");
      return next(new Error("Socket authentication failed"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    socket.userId = String(decoded.id);

    console.log("=================================");
    console.log("SOCKET AUTHENTICATED");
    console.log("USER ID:", socket.userId);
    console.log("=================================");

    next();
  } catch (error) {
    console.error("Socket authentication error:", error.message);

    next(new Error("Socket authentication failed"));
  }
});

// =====================================================
// PRIVATE ROOM
// =====================================================

const getPrivateRoom = (user1, user2) => {
  return [String(user1), String(user2)].sort().join("_");
};

// =====================================================
// PERSONAL USER ROOM
// =====================================================

const getUserRoom = (userId) => {
  return `user_${String(userId)}`;
};

// =====================================================
// ONLINE USER HELPERS
// =====================================================

const addOnlineUser = (userId, socketId) => {
  const key = String(userId);

  if (!onlineUsers.has(key)) {
    onlineUsers.set(key, new Set());
  }

  onlineUsers.get(key).add(socketId);
};

const removeOnlineUser = (userId, socketId) => {
  const key = String(userId);

  const sockets = onlineUsers.get(key);

  if (!sockets) {
    return false;
  }

  sockets.delete(socketId);

  if (sockets.size === 0) {
    onlineUsers.delete(key);
    return true;
  }

  return false;
};

const isUserOnline = (userId) => {
  return onlineUsers.has(String(userId));
};

// =====================================================
// BROADCAST USER PRESENCE TO FRIENDS & CHAT MEMBERS
// =====================================================

const broadcastUserPresence = async (userId, isOnline) => {
  try {
    const user = await User.findById(userId).select("friends");
    const targetUserIds = new Set();

    if (user?.friends?.length) {
      user.friends.forEach((friendId) => targetUserIds.add(String(friendId)));
    }

    // Also include conversation participants
    const conversations = await Conversation.find({
      "members.userId": userId,
    }).select("members");

    conversations.forEach((conv) => {
      conv.members?.forEach((m) => {
        const mId = String(m.userId?._id || m.userId);
        if (mId && mId !== String(userId)) {
          targetUserIds.add(mId);
        }
      });
    });

    for (const targetId of targetUserIds) {
      io.to(getUserRoom(targetId)).emit("user_status_changed", {
        userId: String(userId),
        isOnline: Boolean(isOnline),
        online: Boolean(isOnline),
        status: isOnline ? "online" : "offline",
      });
    }
  } catch (error) {
    console.error("Broadcast user presence error:", error);
  }
};

// =====================================================
// SOCKET CONNECTION
// =====================================================

io.on("connection", async (socket) => {
  console.log("=================================");
  console.log("USER CONNECTED");
  console.log("SOCKET ID:", socket.id);
  console.log("MONGO USER ID:", socket.userId);
  console.log("=================================");

  // ===================================================
  // MARK USER ONLINE
  // ===================================================

  const wasAlreadyOnline = isUserOnline(socket.userId);

  addOnlineUser(socket.userId, socket.id);

  console.log(`User ${socket.userId} is online`);

  // ===================================================
  // PERSONAL USER ROOM
  // ===================================================

  const userRoom = getUserRoom(socket.userId);

  socket.join(userRoom);

  console.log(`User ${socket.userId} joined personal room ${userRoom}`);

  // ===================================================
  // BROADCAST ONLINE STATUS
  // ===================================================

  if (!wasAlreadyOnline) {
    await broadcastUserPresence(socket.userId, true);
  }

  // ===================================================
  // DELIVER PENDING MESSAGES
  // ===================================================

  try {
    const pendingMessages = await Message.find({
      receiverId: socket.userId,
      status: "sent",
    }).select("_id senderId chatId conversationId");

    if (pendingMessages.length > 0) {
      const deliveredAt = new Date();

      await Message.updateMany(
        {
          _id: {
            $in: pendingMessages.map((message) => message._id),
          },
        },
        {
          $set: {
            status: "delivered",
            deliveredAt,
          },
        },
      );

      for (const message of pendingMessages) {
        io.to(getUserRoom(message.senderId)).emit("message_status_updated", {
          messageId: String(message._id),
          status: "delivered",
          deliveredAt,
          chatId: message.chatId ? String(message.chatId) : null,
          conversationId: message.conversationId
            ? String(message.conversationId)
            : null,
        });
      }

      console.log(
        `Delivered ${pendingMessages.length} pending message(s) to user ${socket.userId}`,
      );
    }
  } catch (error) {
    console.error("Pending message delivery error:", error);
  }

  // ===================================================
  // REQUEST PRESENCE
  // ===================================================

  socket.on("request_presence", (data = {}, acknowledge) => {
    try {
      const { userIds = [] } = data || {};

      if (!Array.isArray(userIds)) {
        acknowledge?.({
          success: false,
          message: "userIds must be an array",
        });
        return;
      }

      const statuses = {};

      userIds.forEach((userId) => {
        statuses[String(userId)] = isUserOnline(userId);
      });

      acknowledge?.({
        success: true,
        statuses,
      });

      socket.emit("presence", { statuses });
    } catch (error) {
      console.error("Request presence error:", error);

      acknowledge?.({
        success: false,
        message: "Failed to get presence",
      });
    }
  });

  // ===================================================
  // JOIN PRIVATE CHAT
  // ===================================================

  socket.on("join_private_chat", async (receiverId) => {
    try {
      if (!receiverId) {
        console.log("Receiver ID missing while joining private chat");

        return;
      }

      const receiver = await User.findById(receiverId).select("_id");

      if (!receiver) {
        console.log("Private chat receiver not found");

        return;
      }

      if (!(await areFriends(socket.userId, receiverId))) {
        console.log("Unauthorized private chat: users are not friends");

        return;
      }

      const conversation = await Conversation.findOne({
        type: "private",
        privateKey: [socket.userId, receiverId].sort().join(":"),
        members: {
          $all: [
            {
              $elemMatch: {
                userId: socket.userId,
              },
            },
            {
              $elemMatch: {
                userId: receiverId,
              },
            },
          ],
        },
      });

      if (
        !conversation ||
        !conversation.members.some(
          (member) => String(member.userId) === String(receiverId),
        )
      ) {
        console.log("Unauthorized private chat room join");

        return;
      }

      const roomName = getPrivateRoom(socket.userId, receiverId);

      socket.join(roomName);

      socket.join(`conversation_${conversation._id}`);

      console.log("=================================");
      console.log("PRIVATE ROOM JOINED");
      console.log("USER:", socket.userId);
      console.log("OTHER USER:", receiverId);
      console.log("ROOM:", roomName);
      console.log("CONVERSATION:", String(conversation._id));
      console.log("=================================");
    } catch (error) {
      console.error("Join private chat error:", error);
    }
  });

  // ===================================================
  // JOIN GROUP CHAT
  // ===================================================

  socket.on("join_chat", async (chatId, acknowledge) => {
    try {
      if (!chatId) {
        console.log("Group chat ID missing");

        acknowledge?.({
          success: false,
          status: 400,
        });

        return;
      }

      const roomName = `group_${String(chatId)}`;

      let conversation;

      if (isValidConversationId(chatId)) {
        conversation = await getConversationForMember(chatId, socket.userId);

        if (!conversation) {
          console.log("Unauthorized group room join:", chatId);

          acknowledge?.({
            success: false,
            status: 403,
          });

          return;
        }

        socket.join(`conversation_${conversation._id}`);
      } else {
        conversation = await getOrCreateLegacyConversation(
          chatId,
          socket.userId,
        );

        if (
          !conversation?.members?.some(
            (member) => String(member.userId) === String(socket.userId),
          )
        ) {
          console.log("Unauthorized legacy group room join:", chatId);

          acknowledge?.({
            success: false,
            status: 403,
          });

          return;
        }

        socket.join(`conversation_${conversation._id}`);
      }

      socket.join(roomName);

      acknowledge?.({
        success: true,
        conversationId: String(conversation._id),
      });

      console.log(`User ${socket.userId} joined group ${roomName}`);
    } catch (error) {
      console.error("Join group chat error:", error);

      acknowledge?.({
        success: false,
        status: 500,
      });
    }
  });

  // ===================================================
  // SEND PRIVATE MESSAGE
  // ===================================================

  socket.on("send_private_message", async (message, acknowledge) => {
    try {
      console.log("CHAT DEBUG authenticated socket user ID:", socket.userId);

      console.log("CHAT DEBUG received senderId:", message?.senderId);

      console.log("CHAT DEBUG receiverId:", message?.receiverId);

      console.log("CHAT DEBUG received chatId:", message?.chatId);

      console.log("=================================");
      console.log("PRIVATE MESSAGE RECEIVED");
      console.log("FROM:", socket.userId);
      console.log("TO:", message?.receiverId);
      console.log("TEXT:", message?.text);
      console.log("=================================");

      // -------------------------------------------------
      // VALIDATION
      // -------------------------------------------------

      if (!message?.receiverId) {
        const rejection = {
          success: false,
          reason: "Receiver ID missing",
        };

        console.log("CHAT DEBUG rejection:", rejection);

        acknowledge?.(rejection);

        return;
      }

      if (!message?.text?.trim()) {
        const rejection = {
          success: false,
          reason: "Message text missing",
        };

        console.log("CHAT DEBUG rejection:", rejection);

        acknowledge?.(rejection);

        return;
      }

      const senderId = String(socket.userId);

      const receiverId = String(message.receiverId);

      // -------------------------------------------------
      // CHAT ID
      // -------------------------------------------------

      const chatId = getPrivateRoom(senderId, receiverId);

      const receiver = await User.findById(receiverId).select("_id");

      if (!receiver) {
        const rejection = {
          success: false,
          reason: "Private message receiver not found",
        };

        console.log("CHAT DEBUG rejection:", rejection);

        acknowledge?.(rejection);

        return;
      }

      // -------------------------------------------------
      // FRIENDSHIP CHECK
      // -------------------------------------------------

      const friendshipResult = await areFriends(senderId, receiverId);

      console.log("CHAT DEBUG friendship check result:", friendshipResult);

      if (!friendshipResult) {
        const rejection = {
          success: false,
          reason: "Users are not accepted friends",
        };

        console.log("CHAT DEBUG rejection:", rejection);

        acknowledge?.(rejection);

        return;
      }

      // -------------------------------------------------
      // FIND PRIVATE CONVERSATION
      // -------------------------------------------------

      const conversation = await Conversation.findOne({
        type: "private",
        privateKey: [senderId, receiverId].sort().join(":"),
        members: {
          $all: [
            {
              $elemMatch: {
                userId: senderId,
              },
            },
            {
              $elemMatch: {
                userId: receiverId,
              },
            },
          ],
        },
      });

      console.log("CHAT DEBUG private conversation lookup result:", {
        found: Boolean(conversation),
        conversationId: conversation ? String(conversation._id) : null,
      });

      if (
        !conversation ||
        conversation.type !== "private" ||
        !conversation.members.some(
          (member) => String(member.userId) === receiverId,
        )
      ) {
        const rejection = {
          success: false,
          reason: "Private conversation not found or membership invalid",
          chatId,
        };

        console.log("CHAT DEBUG rejection:", rejection);

        acknowledge?.(rejection);

        return;
      }

      console.log(
        "CHAT DEBUG resolved conversationId:",
        String(conversation._id),
      );

      socket.join(`conversation_${conversation._id}`);

      // -------------------------------------------------
      // MESSAGE TIME
      // -------------------------------------------------

      const time =
        message.time ||
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

      // -------------------------------------------------
      // DELIVERY STATUS
      // -------------------------------------------------

      const receiverOnline = isUserOnline(receiverId);

      const initialStatus = receiverOnline ? "delivered" : "sent";

      const deliveredAt = receiverOnline ? new Date() : null;

      // -------------------------------------------------
      // SAVE MESSAGE & UNHIDE CONVERSATION
      // -------------------------------------------------

      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $pull: {
            hiddenFor: {
              $in: [
                senderId,
                receiverId,
                new mongoose.Types.ObjectId(senderId),
                new mongoose.Types.ObjectId(receiverId),
              ],
            },
          },
        },
      );

      const savedMessage = await Message.create({
        chatId,
        conversationId: conversation._id,
        senderId,
        receiverId,
        text: message.text.trim(),
        time,

        status: initialStatus,

        deliveredAt,
      });

      console.log("CHAT DEBUG message save result:", {
        success: true,
        messageId: String(savedMessage._id),
        conversationId: String(savedMessage.conversationId),
        status: savedMessage.status,
      });

      acknowledge?.({
        success: true,
        messageId: String(savedMessage._id),
        conversationId: String(savedMessage.conversationId),
        status: savedMessage.status,
      });

      console.log("=================================");
      console.log("MESSAGE SAVED IN MONGODB");
      console.log("MESSAGE ID:", savedMessage._id);
      console.log("CHAT ID:", savedMessage.chatId);
      console.log("SENDER:", savedMessage.senderId);
      console.log("RECEIVER:", savedMessage.receiverId);
      console.log("STATUS:", savedMessage.status);
      console.log("=================================");

      // -------------------------------------------------
      // BASE MESSAGE
      // -------------------------------------------------

      const baseMessage = {
        _id: String(savedMessage._id),

        chatId: String(savedMessage.chatId),

        conversationId: savedMessage.conversationId
          ? String(savedMessage.conversationId)
          : null,

        senderId: String(savedMessage.senderId),

        receiverId: String(savedMessage.receiverId),

        text: savedMessage.text,

        time: savedMessage.time,

        createdAt: savedMessage.createdAt,

        status: savedMessage.status,

        deliveredAt: savedMessage.deliveredAt,

        readAt: savedMessage.readAt,
      };

      // =================================================
      // SEND TO SENDER
      // =================================================

      const senderMessage = {
        ...baseMessage,
        type: "sent",
      };

      socket.emit("receive_private_message", senderMessage);

      console.log("=================================");
      console.log("MESSAGE SENT TO SENDER");
      console.log("USER:", senderId);
      console.log("TYPE:", senderMessage.type);
      console.log("STATUS:", senderMessage.status);
      console.log("=================================");

      // =================================================
      // SEND TO RECEIVER
      // =================================================

      const receiverMessage = {
        ...baseMessage,
        type: "received",
      };

      const receiverRoom = getUserRoom(receiverId);

      io.to(receiverRoom).emit("receive_private_message", receiverMessage);

      console.log("=================================");
      console.log("MESSAGE SENT TO RECEIVER");
      console.log("USER:", receiverId);
      console.log("ROOM:", receiverRoom);
      console.log("TYPE:", receiverMessage.type);
      console.log("STATUS:", receiverMessage.status);
      console.log("=================================");
    } catch (error) {
      console.error("CHAT DEBUG private message exception:", error);

      acknowledge?.({
        success: false,
        reason: "Private message processing failed",
      });

      console.error("PRIVATE MESSAGE SAVE ERROR:", error);
    }
  });

  // ===================================================
  // MARK PRIVATE MESSAGES AS READ
  // ===================================================

  socket.on("mark_messages_read", async ({ conversationId }, acknowledge) => {
    try {
      if (!conversationId) {
        acknowledge?.({
          success: false,
          message: "conversationId is required",
        });

        return;
      }

      const conversation = await getConversationForMember(
        conversationId,
        socket.userId,
      );

      if (!conversation) {
        acknowledge?.({
          success: false,
          message: "You are not a conversation member",
        });

        return;
      }

      const currentUserObjectId = mongoose.Types.ObjectId.isValid(socket.userId)
        ? new mongoose.Types.ObjectId(socket.userId)
        : socket.userId;

      const conversationObjectId = mongoose.Types.ObjectId.isValid(conversationId)
        ? new mongoose.Types.ObjectId(conversationId)
        : conversationId;

      const unreadMessages = await Message.find({
        $and: [
          {
            $or: [
              { conversationId: conversationObjectId },
              { conversationId: String(conversationId) },
              ...(conversation.legacyChatId
                ? [{ chatId: String(conversation.legacyChatId) }]
                : []),
            ],
          },
          {
            $or: [
              { receiverId: currentUserObjectId },
              { receiverId: socket.userId },
            ],
          },
        ],
        status: {
          $ne: "read",
        },
      }).select("_id senderId chatId conversationId");

      if (unreadMessages.length === 0) {
        acknowledge?.({
          success: true,
          updatedCount: 0,
        });

        return;
      }

      const readAt = new Date();

      await Message.updateMany(
        {
          _id: {
            $in: unreadMessages.map((message) => message._id),
          },
          status: {
            $ne: "read",
          },
        },
        {
          $set: {
            status: "read",
            readAt,
          },
        },
      );

      for (const message of unreadMessages) {
        io.to(getUserRoom(message.senderId)).emit("message_status_updated", {
          messageId: String(message._id),

          status: "read",

          readAt,

          chatId: message.chatId ? String(message.chatId) : null,

          conversationId: message.conversationId
            ? String(message.conversationId)
            : null,
        });
      }

      acknowledge?.({
        success: true,
        updatedCount: unreadMessages.length,
      });
    } catch (error) {
      console.error("Mark messages read error:", error);

      acknowledge?.({
        success: false,
        message: "Failed to mark messages as read",
      });
    }
  });

  // ===================================================
  // TYPING START
  // ===================================================

  socket.on("typing_start", async ({ receiverId, conversationId }) => {
    try {
      if (!receiverId || !conversationId) {
        return;
      }

      const conversation = await getConversationForMember(
        conversationId,
        socket.userId,
      );

      if (!conversation) {
        return;
      }

      const receiverIsMember = conversation.members.some(
        (member) => String(member.userId) === String(receiverId),
      );

      if (!receiverIsMember) {
        return;
      }

      io.to(getUserRoom(receiverId)).emit("user_typing", {
        conversationId: String(conversationId),

        userId: String(socket.userId),

        isTyping: true,
      });
    } catch (error) {
      console.error("Typing start error:", error);
    }
  });

  // ===================================================
  // TYPING STOP
  // ===================================================

  socket.on("typing_stop", async ({ receiverId, conversationId }) => {
    try {
      if (!receiverId || !conversationId) {
        return;
      }

      const conversation = await getConversationForMember(
        conversationId,
        socket.userId,
      );

      if (!conversation) {
        return;
      }

      const receiverIsMember = conversation.members.some(
        (member) => String(member.userId) === String(receiverId),
      );

      if (!receiverIsMember) {
        return;
      }

      io.to(getUserRoom(receiverId)).emit("user_typing", {
        conversationId: String(conversationId),

        userId: String(socket.userId),

        isTyping: false,
      });
    } catch (error) {
      console.error("Typing stop error:", error);
    }
  });

  // ===================================================
  // SEND GROUP MESSAGE
  // ===================================================

  socket.on("send_message", async (message) => {
    try {
      console.log("=================================");
      console.log("GROUP MESSAGE RECEIVED");
      console.log("FROM:", socket.userId);
      console.log("CHAT:", message?.chatId);
      console.log("TEXT:", message?.text);
      console.log("=================================");

      if (!message?.chatId) {
        console.log("Chat ID missing");
        return;
      }

      if (!message?.text?.trim()) {
        console.log("Message text missing");

        return;
      }

      const chatId = String(message.chatId);

      let conversation = null;

      if (isValidConversationId(chatId)) {
        conversation = await getConversationForMember(chatId, socket.userId);

        if (!conversation) {
          console.log("Unauthorized group message:", chatId);

          return;
        }
      } else {
        conversation = await Conversation.findOne({
          type: "group",
          legacyChatId: chatId,
          "members.userId": socket.userId,
        });

        if (!conversation) {
          console.log("Unauthorized legacy group message:", chatId);

          return;
        }
      }

      // Check group send message permission
      const senderMember = conversation.members?.find(
        (m) => String(m.userId) === String(socket.userId),
      );
      const isSenderAdmin =
        senderMember?.role === "admin" ||
        senderMember?.role === "owner" ||
        String(conversation.createdBy) === String(socket.userId);

      if (
        conversation.permissions?.sendMessages === "admins" &&
        !isSenderAdmin
      ) {
        console.log(
          "Rejected group message: Only admins can send messages in this group",
        );
        socket.emit("error_message", {
          message: "Only group admins can send messages in this group",
        });
        return;
      }

      const time =
        message.time ||
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

      // =================================================
      // SAVE GROUP MESSAGE
      // =================================================

      const savedMessage = await Message.create({
        chatId,

        conversationId: conversation?._id || null,

        senderId: String(socket.userId),

        receiverId: null,

        text: message.text.trim(),

        time,

        status: "sent",
      });

      console.log("GROUP MESSAGE SAVED IN MONGODB:", savedMessage._id);

      // =================================================
      // MESSAGE OBJECT
      // =================================================

      const messageToSend = {
        _id: String(savedMessage._id),

        chatId: String(savedMessage.chatId),

        conversationId: savedMessage.conversationId
          ? String(savedMessage.conversationId)
          : null,

        senderId: String(savedMessage.senderId),

        receiverId: null,

        text: savedMessage.text,

        time: savedMessage.time,

        createdAt: savedMessage.createdAt,

        status: savedMessage.status,

        type: "group",
      };

      // =================================================
      // SEND TO GROUP ROOM
      // =================================================

      const roomName = `group_${chatId}`;

      console.log("Sending group message to room:", roomName);

      io.to(roomName).emit("receive_message", messageToSend);

      console.log("GROUP MESSAGE EMITTED:", messageToSend);
    } catch (error) {
      console.error("GROUP MESSAGE SAVE ERROR:", error);
    }
  });

  // ===================================================
  // WEBRTC CALL SIGNALING
  // ===================================================

  // 1. Initiate Call
  socket.on("call:initiate", async (payload = {}, acknowledge) => {
    try {
      const {
        targetUserId,
        conversationId,
        type = "voice",
        isGroup = false,
        callerInfo,
      } = payload;
      const callerId = String(socket.userId);

      if (!targetUserId && !conversationId) {
        acknowledge?.({
          success: false,
          message: "Target user or group required",
        });
        return;
      }

      const callerUser = await User.findById(callerId).select(
        "name username email image",
      );
      const callerData = callerInfo || {
        _id: callerId,
        name: callerUser?.name || callerUser?.username || "User",
        username: callerUser?.username,
        image: callerUser?.image,
      };

      const callRecord = await Call.create({
        callerId,
        receiverId: targetUserId || null,
        conversationId: conversationId || null,
        type,
        isGroup,
        status: "ongoing",
        startedAt: new Date(),
        participants: [{ userId: callerId, joinedAt: new Date() }],
      });

      const callId = String(callRecord._id);
      activeCalls.set(callId, {
        callId,
        callerId,
        targetUserId: targetUserId ? String(targetUserId) : null,
        conversationId: conversationId ? String(conversationId) : null,
        type,
        isGroup,
        startTime: Date.now(),
      });

      if (isGroup && conversationId) {
        io.to(`conversation_${conversationId}`).emit("call:group-incoming", {
          callId,
          conversationId,
          caller: callerData,
          type,
        });
      } else if (targetUserId) {
        const targetRoom = getUserRoom(targetUserId);
        io.to(targetRoom).emit("call:incoming", {
          callId,
          callerId,
          caller: callerData,
          type,
          conversationId,
        });
      }

      acknowledge?.({ success: true, callId, caller: callerData });
    } catch (error) {
      console.error("Call initiate error:", error);
      acknowledge?.({ success: false, message: "Failed to initiate call" });
    }
  });

  // 2. Accept Call
  socket.on("call:accept", async ({ callId, callerId }, acknowledge) => {
    try {
      const call = activeCalls.get(String(callId));
      if (call) {
        call.accepted = true;
        call.acceptedAt = Date.now();
      }

      if (callId) {
        await Call.updateOne(
          { _id: callId },
          {
            $addToSet: {
              participants: { userId: socket.userId, joinedAt: new Date() },
            },
          },
        );
      }

      if (callerId) {
        io.to(getUserRoom(callerId)).emit("call:accepted", {
          callId,
          responderId: String(socket.userId),
        });
      }

      acknowledge?.({ success: true });
    } catch (error) {
      console.error("Call accept error:", error);
      acknowledge?.({ success: false, message: "Failed to accept call" });
    }
  });

  // 3. Reject Call
  socket.on(
    "call:reject",
    async ({ callId, callerId, reason = "rejected" }, acknowledge) => {
      try {
        if (callId) {
          const status = reason === "busy" ? "busy" : "rejected";
          await Call.updateOne(
            { _id: callId },
            { status, endedAt: new Date(), duration: 0 },
          );
          activeCalls.delete(String(callId));
        }

        if (callerId) {
          io.to(getUserRoom(callerId)).emit("call:rejected", {
            callId,
            responderId: String(socket.userId),
            reason,
          });
        }

        acknowledge?.({ success: true });
      } catch (error) {
        console.error("Call reject error:", error);
      }
    },
  );

  // 4. End Call
  socket.on("call:end", async ({ callId, targetUserId, duration = 0 }) => {
    try {
      if (callId) {
        const call = activeCalls.get(String(callId));
        const finalDuration =
          duration ||
          (call?.acceptedAt
            ? Math.round((Date.now() - call.acceptedAt) / 1000)
            : 0);
        const finalStatus = finalDuration > 0 ? "completed" : "missed";

        await Call.updateOne(
          { _id: callId },
          {
            status: finalStatus,
            duration: finalDuration,
            endedAt: new Date(),
          },
        );
        activeCalls.delete(String(callId));
      }

      if (targetUserId) {
        io.to(getUserRoom(targetUserId)).emit("call:ended", {
          callId,
          fromUserId: String(socket.userId),
          duration,
        });
      }
    } catch (error) {
      console.error("Call end error:", error);
    }
  });

  // 5. WebRTC Offer (SDP)
  socket.on("call:offer", ({ targetUserId, offer, callId }) => {
    if (targetUserId && offer) {
      io.to(getUserRoom(targetUserId)).emit("call:offer", {
        offer,
        callId,
        fromUserId: String(socket.userId),
      });
    }
  });

  // 6. WebRTC Answer (SDP)
  socket.on("call:answer", ({ targetUserId, answer, callId }) => {
    if (targetUserId && answer) {
      io.to(getUserRoom(targetUserId)).emit("call:answer", {
        answer,
        callId,
        fromUserId: String(socket.userId),
      });
    }
  });

  // 7. WebRTC ICE Candidate
  socket.on("call:ice-candidate", ({ targetUserId, candidate, callId }) => {
    if (targetUserId && candidate) {
      io.to(getUserRoom(targetUserId)).emit("call:ice-candidate", {
        candidate,
        callId,
        fromUserId: String(socket.userId),
      });
    }
  });

  // 8. Toggle Audio/Video State Sync
  socket.on(
    "call:toggle-media",
    ({ targetUserId, mediaType, enabled, callId }) => {
      if (targetUserId) {
        io.to(getUserRoom(targetUserId)).emit("call:peer-media-toggled", {
          mediaType,
          enabled,
          callId,
          fromUserId: String(socket.userId),
        });
      }
    },
  );

  // 9. Group Calling Rooms
  socket.on("call:group-join", async ({ groupId, callId, user }) => {
    try {
      const room = `call_group_${groupId}`;
      socket.join(room);
      socket.to(room).emit("call:group-peer-joined", {
        userId: String(socket.userId),
        user,
        callId,
      });
    } catch (err) {
      console.error("Group call join error:", err);
    }
  });

  socket.on("call:group-leave", ({ groupId, callId }) => {
    const room = `call_group_${groupId}`;
    socket.leave(room);
    socket.to(room).emit("call:group-peer-left", {
      userId: String(socket.userId),
      callId,
    });
  });

  socket.on(
    "call:group-signal",
    ({ targetUserId, signal, groupId, callId }) => {
      if (targetUserId) {
        io.to(getUserRoom(targetUserId)).emit("call:group-signal", {
          fromUserId: String(socket.userId),
          signal,
          groupId,
          callId,
        });
      }
    },
  );

  // ===================================================
  // DISCONNECT
  // ===================================================

  socket.on("disconnect", async () => {
    try {
      const userWentOffline = removeOnlineUser(socket.userId, socket.id);

      console.log("User disconnected:", socket.userId, "Socket:", socket.id);

      // Only broadcast offline when
      // the user has no other active sockets.
      if (userWentOffline) {
        console.log(`User ${socket.userId} is offline`);

        await broadcastUserPresence(socket.userId, false);
      }
    } catch (error) {
      console.error("Disconnect presence error:", error);
    }
  });
});

// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 3005;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
