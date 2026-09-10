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

const Message = require("./models/Message");

const app = express();

// =====================================================
// DATABASE
// =====================================================

connectDB();

// =====================================================
// MIDDLEWARE
// =====================================================

const allowedOrigins = ["http://localhost:5173", "http://localhost:5174"];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());

// =====================================================
// STATIC
// =====================================================

app.use("/uploads", express.static("uploads"));

// =====================================================
// ROUTES
// =====================================================

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/files", fileRoutes);

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
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

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
// SOCKET CONNECTION
// =====================================================

io.on("connection", (socket) => {
  console.log("=================================");
  console.log("USER CONNECTED");
  console.log("SOCKET ID:", socket.id);
  console.log("MONGO USER ID:", socket.userId);
  console.log("=================================");

  // ===================================================
  // PERSONAL USER ROOM
  // ===================================================

  const userRoom = getUserRoom(socket.userId);

  socket.join(userRoom);

  console.log(`User ${socket.userId} joined personal room ${userRoom}`);

  // ===================================================
  // JOIN PRIVATE CHAT
  // ===================================================

  socket.on("join_private_chat", (receiverId) => {
    try {
      if (!receiverId) {
        console.log("Receiver ID missing while joining private chat");

        return;
      }

      const roomName = getPrivateRoom(socket.userId, receiverId);

      socket.join(roomName);

      console.log("=================================");
      console.log("PRIVATE ROOM JOINED");
      console.log("USER:", socket.userId);
      console.log("OTHER USER:", receiverId);
      console.log("ROOM:", roomName);
      console.log("=================================");
    } catch (error) {
      console.error("Join private chat error:", error);
    }
  });

  // ===================================================
  // JOIN GROUP CHAT
  // ===================================================

  socket.on("join_chat", (chatId) => {
    try {
      if (!chatId) {
        console.log("Group chat ID missing");
        return;
      }

      const roomName = `group_${String(chatId)}`;

      socket.join(roomName);

      console.log(`User ${socket.userId} joined group ${roomName}`);
    } catch (error) {
      console.error("Join group chat error:", error);
    }
  });

  // ===================================================
  // SEND PRIVATE MESSAGE
  // ===================================================

  socket.on("send_private_message", async (message) => {
    try {
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
        console.log("Receiver ID missing");
        return;
      }

      if (!message?.text?.trim()) {
        console.log("Message text missing");
        return;
      }

      const senderId = String(socket.userId);
      const receiverId = String(message.receiverId);

      // -------------------------------------------------
      // CHAT ID
      // -------------------------------------------------

      const chatId = getPrivateRoom(senderId, receiverId);

      // -------------------------------------------------
      // TIME
      // -------------------------------------------------

      const time =
        message.time ||
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

      // -------------------------------------------------
      // SAVE MESSAGE
      // -------------------------------------------------

      const savedMessage = await Message.create({
        chatId,
        senderId,
        receiverId,
        text: message.text.trim(),
        time,
      });

      console.log("=================================");
      console.log("MESSAGE SAVED IN MONGODB");
      console.log("MESSAGE ID:", savedMessage._id);
      console.log("CHAT ID:", savedMessage.chatId);
      console.log("SENDER:", savedMessage.senderId);
      console.log("RECEIVER:", savedMessage.receiverId);
      console.log("=================================");

      // -------------------------------------------------
      // BASE MESSAGE
      // -------------------------------------------------

      const baseMessage = {
        _id: String(savedMessage._id),
        chatId: String(savedMessage.chatId),
        senderId: String(savedMessage.senderId),
        receiverId: String(savedMessage.receiverId),
        text: savedMessage.text,
        time: savedMessage.time,
        createdAt: savedMessage.createdAt,
      };

      // =================================================
      // SEND TO SENDER
      //
      // Explicitly marked as SENT
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
      console.log("=================================");

      // =================================================
      // SEND TO RECEIVER
      //
      // Explicitly marked as RECEIVED
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
      console.log("=================================");
    } catch (error) {
      console.error("PRIVATE MESSAGE SAVE ERROR:", error);
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
        senderId: String(socket.userId),
        receiverId: null,
        text: message.text.trim(),
        time,
      });

      console.log("GROUP MESSAGE SAVED IN MONGODB:", savedMessage._id);

      // =================================================
      // MESSAGE OBJECT
      // =================================================

      const messageToSend = {
        _id: String(savedMessage._id),
        chatId: String(savedMessage.chatId),
        senderId: String(savedMessage.senderId),
        receiverId: null,
        text: savedMessage.text,
        time: savedMessage.time,
        createdAt: savedMessage.createdAt,
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
  // DISCONNECT
  // ===================================================

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId, "Socket:", socket.id);
  });
});

// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 3005;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
