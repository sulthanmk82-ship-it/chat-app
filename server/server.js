/**
 * ============================================
 *  Real-Time Private Chat App — server.js
 * ============================================
 * Stack: Node.js + Express + Socket.io
 * Storage: In-memory (no DB required to run)
 * ============================================
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// ─── Socket.io Setup ───────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ─── In-Memory Storage ─────────────────────────────────────────────────────────
// Map of username → socket ID (for online users)
const onlineUsers = new Map();

// All registered usernames (persists across disconnects)
const registeredUsers = new Set();

// Message history: key = roomId, value = array of message objects
const messageHistory = {};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a unique, deterministic room ID for two users.
 * Sorting ensures "alice_bob" and "bob_alice" produce the same room.
 */
function getRoomId(user1, user2) {
  return [user1, user2].sort().join("_");
}

/**
 * Build a snapshot of all known users with their online status.
 */
function getAllUsersStatus(excludeUsername = null) {
  return [...registeredUsers]
    .filter((u) => u !== excludeUsername)
    .map((username) => ({
      username,
      online: onlineUsers.has(username),
    }));
}

// ─── REST API ──────────────────────────────────────────────────────────────────

// GET /api/messages/:roomId  — fetch message history for a room
app.get("/api/messages/:roomId", (req, res) => {
  const { roomId } = req.params;
  const messages = messageHistory[roomId] || [];
  res.json(messages);
});

// Serve login page at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Serve chat page
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/chat.html"));
});

// ─── Socket.io Events ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // ── Login ────────────────────────────────────────────────────────────────────
  socket.on("user:login", (username) => {
    username = username.trim();

    // Reject duplicate active sessions
    if (onlineUsers.has(username)) {
      socket.emit("login:error", "Username already taken. Please choose another.");
      return;
    }

    // Register & mark online
    registeredUsers.add(username);
    onlineUsers.set(username, socket.id);
    socket.data.username = username;

    console.log(`✅ ${username} logged in (${socket.id})`);

    // Confirm login to this user
    socket.emit("login:success", {
      username,
      users: getAllUsersStatus(username),
    });

    // Notify everyone else that a new user came online
    socket.broadcast.emit("user:status", { username, online: true });
    // Also tell everyone about the new user if they haven't seen them
    socket.broadcast.emit("user:new", { username, online: true });
  });

  // ── Open Chat (load history) ─────────────────────────────────────────────────
  socket.on("chat:open", ({ withUser }) => {
    const myUsername = socket.data.username;
    if (!myUsername) return;

    const roomId = getRoomId(myUsername, withUser);
    const messages = messageHistory[roomId] || [];
    socket.emit("chat:history", { withUser, messages });
  });

  // ── Send Message ─────────────────────────────────────────────────────────────
  socket.on("message:send", ({ toUser, text }) => {
    const fromUser = socket.data.username;
    if (!fromUser || !text.trim()) return;

    const roomId = getRoomId(fromUser, toUser);
    const message = {
      id: uuidv4(),
      from: fromUser,
      to: toUser,
      text: text.trim(),
      timestamp: new Date().toISOString(),
      roomId,
    };

    // Store in history
    if (!messageHistory[roomId]) messageHistory[roomId] = [];
    messageHistory[roomId].push(message);

    // Send to recipient (if online)
    const recipientSocketId = onlineUsers.get(toUser);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("message:receive", message);
    }

    // Echo back to sender for confirmation
    socket.emit("message:sent", message);

    console.log(`💬 [${roomId}] ${fromUser} → ${toUser}: "${message.text}"`);
  });

  // ── Typing Indicator ─────────────────────────────────────────────────────────
  socket.on("typing:start", ({ toUser }) => {
    const fromUser = socket.data.username;
    const recipientSocketId = onlineUsers.get(toUser);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing:update", { fromUser, typing: true });
    }
  });

  socket.on("typing:stop", ({ toUser }) => {
    const fromUser = socket.data.username;
    const recipientSocketId = onlineUsers.get(toUser);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing:update", { fromUser, typing: false });
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const username = socket.data.username;
    if (username) {
      onlineUsers.delete(username);
      console.log(`🔴 ${username} disconnected`);
      // Broadcast offline status to all other users
      socket.broadcast.emit("user:status", { username, online: false });
    }
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat server running at http://localhost:${PORT}`);
  console.log(`   Open your browser and go to: http://localhost:${PORT}\n`);
});
      
