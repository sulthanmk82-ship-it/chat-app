const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for voice messages
});

// ─── In-Memory Database ───────────────────────────────────────────────────────
const users = {};       // { username: { password } }
const messages = {};    // { roomId: [{ from, type, content, timestamp }] }
const onlineUsers = {}; // { socketId: username }

// ─── Serve Static Files ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRoomId(user1, user2) {
  return [user1, user2].sort().join("_");
}

function getOnlineList() {
  return Object.values(onlineUsers);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // ── Auth: Register ──────────────────────────────────────────────────────────
  socket.on("register", ({ username, password }) => {
    username = username.trim();
    if (!username || !password) {
      return socket.emit("auth_error", "Username and password are required.");
    }
    if (users[username]) {
      return socket.emit("auth_error", "User already exists. Please log in.");
    }
    users[username] = { password };
    socket.emit("auth_success", { username });
    console.log(`Registered: ${username}`);
  });

  // ── Auth: Login ─────────────────────────────────────────────────────────────
  socket.on("login", ({ username, password }) => {
    username = username.trim();
    if (!users[username]) {
      return socket.emit("auth_error", "User not found. Please create an account.");
    }
    if (users[username].password !== password) {
      return socket.emit("auth_error", "Wrong password. Please try again.");
    }

    // Mark online
    onlineUsers[socket.id] = username;
    socket.username = username;

    socket.emit("auth_success", { username });
    io.emit("online_users", getOnlineList());
    io.emit("user_status", { username, status: "online" });
    console.log(`Logged in: ${username}`);
  });

  // ── Join after login (re-broadcast presence) ────────────────────────────────
  socket.on("join", ({ username }) => {
    if (!users[username]) return;
    onlineUsers[socket.id] = username;
    socket.username = username;
    io.emit("online_users", getOnlineList());
    io.emit("user_status", { username, status: "online" });
  });

  // ── Get online users ─────────────────────────────────────────────────────────
  socket.on("get_online_users", () => {
    socket.emit("online_users", getOnlineList());
  });

  // ── Get all registered users ─────────────────────────────────────────────────
  socket.on("get_all_users", () => {
    socket.emit("all_users", Object.keys(users));
  });

  // ── Load message history ─────────────────────────────────────────────────────
  socket.on("get_messages", ({ user1, user2 }) => {
    const roomId = getRoomId(user1, user2);
    socket.emit("message_history", {
      roomId,
      messages: messages[roomId] || [],
    });
  });

  // ── Send text message ────────────────────────────────────────────────────────
  socket.on("send_message", ({ from, to, content }) => {
    const roomId = getRoomId(from, to);
    const msg = {
      from,
      to,
      type: "text",
      content,
      timestamp: new Date().toISOString(),
    };

    if (!messages[roomId]) messages[roomId] = [];
    messages[roomId].push(msg);

    // Emit to both participants
    io.emit(`message_${roomId}`, msg);
  });

  // ── Send voice message ────────────────────────────────────────────────────────
  socket.on("send_voice", ({ from, to, audioData }) => {
    const roomId = getRoomId(from, to);
    const msg = {
      from,
      to,
      type: "voice",
      content: audioData, // base64 encoded audio
      timestamp: new Date().toISOString(),
    };

    if (!messages[roomId]) messages[roomId] = [];
    messages[roomId].push(msg);

    io.emit(`message_${roomId}`, msg);
  });

  // ── Typing indicator ──────────────────────────────────────────────────────────
  socket.on("typing", ({ from, to, isTyping }) => {
    const roomId = getRoomId(from, to);
    socket.broadcast.emit(`typing_${roomId}`, { from, isTyping });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const username = onlineUsers[socket.id];
    if (username) {
      delete onlineUsers[socket.id];
      io.emit("online_users", getOnlineList());
      io.emit("user_status", { username, status: "offline" });
      console.log(`Disconnected: ${username}`);
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat server running at http://localhost:${PORT}\n`);
});
