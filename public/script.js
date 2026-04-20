/**
 * ============================================
 *  Neon Chat — script.js  (Chat Page)
 * ============================================
 * Handles all socket events, UI rendering,
 * and user interactions for the chat dashboard.
 * ============================================
 */

// ── Guard: redirect to login if no session ────────────────────
const myUsername = sessionStorage.getItem("username");
if (!myUsername) {
  window.location.href = "/";
}

// ── Socket Connection ─────────────────────────────────────────
const socket = io();

// ── App State ─────────────────────────────────────────────────
let allUsers = JSON.parse(sessionStorage.getItem("users") || "[]");
let selectedUser = null;   // Currently open chat partner
let unreadCounts = {};     // { username: count }
let typingTimer = null;    // Debounce for typing stop
let isTyping = false;      // Track local typing state

// ── DOM References ────────────────────────────────────────────
const myUsernameEl  = document.getElementById("myUsername");
const myAvatarEl    = document.getElementById("myAvatar");
const userListEl    = document.getElementById("userList");
const onlineCountEl = document.getElementById("onlineCount");
const searchInput   = document.getElementById("searchInput");

const emptyState    = document.getElementById("emptyState");
const chatArea      = document.getElementById("chatArea");
const chatAvatar    = document.getElementById("chatAvatar");
const chatUsername  = document.getElementById("chatUsername");
const chatStatusDot = document.getElementById("chatStatusDot");
const chatStatusText= document.getElementById("chatStatusText");
const messagesContainer = document.getElementById("messagesContainer");
const noMessages    = document.getElementById("noMessages");

const messageInput  = document.getElementById("messageInput");
const sendBtn       = document.getElementById("sendBtn");
const typingIndicator = document.getElementById("typingIndicator");
const typingText    = document.getElementById("typingText");
const backBtn       = document.getElementById("backBtn");
const logoutBtn     = document.getElementById("logoutBtn");

// ── Init ──────────────────────────────────────────────────────
(function init() {
  // Set my profile display
  myUsernameEl.textContent = myUsername;
  myAvatarEl.textContent = getInitials(myUsername);

  // Re-login with server (re-register socket after page load)
  socket.emit("user:login", myUsername);

  // Render initial user list
  renderUserList(allUsers);
})();

// ════════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ════════════════════════════════════════════════════════════

// After re-login confirmed
socket.on("login:success", ({ users }) => {
  allUsers = users;
  renderUserList(users);
});

// Handle duplicate username on chat page (edge case)
socket.on("login:error", () => {
  sessionStorage.clear();
  window.location.href = "/";
});

// A user's online/offline status changed
socket.on("user:status", ({ username, online }) => {
  // Update in our local array
  const user = allUsers.find((u) => u.username === username);
  if (user) {
    user.online = online;
  }
  renderUserList(getFilteredUsers());
  updateChatHeaderStatus();
});

// A brand-new user appeared (never seen before)
socket.on("user:new", ({ username, online }) => {
  const exists = allUsers.find((u) => u.username === username);
  if (!exists) {
    allUsers.push({ username, online });
    renderUserList(getFilteredUsers());
  }
});

// Incoming message from another user
socket.on("message:receive", (message) => {
  const fromUser = message.from;

  if (selectedUser === fromUser) {
    // Chat is already open → show message immediately
    appendMessage(message, false);
    scrollToBottom();
  } else {
    // Chat not open → increment unread badge
    unreadCounts[fromUser] = (unreadCounts[fromUser] || 0) + 1;
    renderUserList(getFilteredUsers());
  }
});

// Server confirmed our sent message
socket.on("message:sent", (message) => {
  appendMessage(message, true);
  scrollToBottom();
});

// Message history loaded when opening a chat
socket.on("chat:history", ({ withUser, messages }) => {
  if (withUser !== selectedUser) return;

  messagesContainer.innerHTML = "";

  if (messages.length === 0) {
    messagesContainer.appendChild(noMessages);
    noMessages.style.display = "flex";
    return;
  }

  noMessages.style.display = "none";
  messages.forEach((msg) => {
    appendMessage(msg, msg.from === myUsername);
  });
  scrollToBottom(false); // No animation for history load
});

// Typing indicator from other user
socket.on("typing:update", ({ fromUser, typing }) => {
  if (fromUser !== selectedUser) return;
  typingText.textContent = `${fromUser} is typing...`;
  typingIndicator.style.display = typing ? "flex" : "none";
  if (typing) scrollToBottom();
});

// ════════════════════════════════════════════════════════════
//  UI: USER LIST
// ════════════════════════════════════════════════════════════

function renderUserList(users) {
  // Update online count
  const onlineCount = users.filter((u) => u.online).length;
  onlineCountEl.textContent = `${onlineCount} online`;

  if (users.length === 0) {
    userListEl.innerHTML = '<li class="no-users">No other users yet...</li>';
    return;
  }

  // Sort: online first, then alphabetical
  const sorted = [...users].sort((a, b) => {
    if (a.online !== b.online) return b.online - a.online;
    return a.username.localeCompare(b.username);
  });

  userListEl.innerHTML = sorted
    .map((user) => buildUserItem(user))
    .join("");

  // Attach click listeners
  userListEl.querySelectorAll(".user-item").forEach((el) => {
    el.addEventListener("click", () => {
      const username = el.dataset.username;
      openChat(username);
    });
  });
}

function buildUserItem(user) {
  const isActive  = user.username === selectedUser;
  const unread    = unreadCounts[user.username] || 0;
  const dotClass  = user.online ? "dot--online" : "dot--offline";
  const statusTxt = user.online ? "Online" : "Offline";
  const initials  = getInitials(user.username);

  return `
    <li class="user-item ${isActive ? "active" : ""}" data-username="${user.username}">
      <div class="avatar-wrapper">
        <div class="avatar avatar--sm">${initials}</div>
        <div class="avatar-dot ${dotClass}"></div>
      </div>
      <div class="user-item-info">
        <div class="user-item-name">${escapeHtml(user.username)}</div>
        <div class="user-item-sub">${statusTxt}</div>
      </div>
      ${unread > 0 ? `<div class="unread-badge">${unread > 9 ? "9+" : unread}</div>` : ""}
    </li>
  `;
}

// ════════════════════════════════════════════════════════════
//  UI: OPEN CHAT
// ════════════════════════════════════════════════════════════

function openChat(username) {
  selectedUser = username;

  // Clear unread count for this user
  unreadCounts[username] = 0;

  // Update sidebar highlight
  renderUserList(getFilteredUsers());

  // Update chat header
  const user = allUsers.find((u) => u.username === username);
  chatAvatar.textContent = getInitials(username);
  chatUsername.textContent = username;
  updateChatHeaderStatus();

  // Show chat area, hide empty state
  emptyState.style.display = "none";
  chatArea.style.display = "flex";

  // On mobile: hide sidebar
  document.querySelector(".sidebar").classList.add("hidden");

  // Clear messages and show loading state
  messagesContainer.innerHTML = "";
  noMessages.style.display = "flex";
  messagesContainer.appendChild(noMessages);

  // Reset typing indicator
  typingIndicator.style.display = "none";

  // Focus the input
  messageInput.focus();

  // Request message history from server
  socket.emit("chat:open", { withUser: username });
}

function updateChatHeaderStatus() {
  if (!selectedUser) return;
  const user = allUsers.find((u) => u.username === selectedUser);
  const online = user?.online || false;
  chatStatusDot.className = `dot ${online ? "dot--online" : "dot--offline"}`;
  chatStatusText.textContent = online ? "Online" : "Offline";
}

// ════════════════════════════════════════════════════════════
//  UI: MESSAGES
// ════════════════════════════════════════════════════════════

function appendMessage(message, isSent) {
  // Remove "no messages" placeholder if present
  const noMsg = document.getElementById("noMessages");
  if (noMsg && noMsg.parentElement === messagesContainer) {
    noMsg.style.display = "none";
  }

  const group = document.createElement("div");
  group.className = `message-group message-group--${isSent ? "sent" : "recv"}`;

  const row = document.createElement("div");
  row.className = "bubble-row";

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = `bubble bubble--${isSent ? "sent" : "recv"}`;
  bubble.textContent = message.text;

  // Meta (sender + time)
  const meta = document.createElement("div");
  meta.className = "bubble-meta";

  const senderEl = document.createElement("span");
  senderEl.className = "bubble-sender";
  senderEl.textContent = isSent ? "You" : message.from;

  const timeEl = document.createElement("span");
  timeEl.className = "bubble-time";
  timeEl.textContent = formatTime(message.timestamp);

  meta.appendChild(senderEl);
  meta.appendChild(timeEl);

  row.appendChild(bubble);
  group.appendChild(row);
  group.appendChild(meta);

  messagesContainer.appendChild(group);
}

function scrollToBottom(animate = true) {
  messagesContainer.scrollTo({
    top: messagesContainer.scrollHeight,
    behavior: animate ? "smooth" : "auto",
  });
}

// ════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ════════════════════════════════════════════════════════════

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !selectedUser) return;

  socket.emit("message:send", { toUser: selectedUser, text });

  // Clear input
  messageInput.value = "";

  // Stop typing indicator
  stopTyping();
}

// ════════════════════════════════════════════════════════════
//  TYPING INDICATORS
// ════════════════════════════════════════════════════════════

function startTyping() {
  if (!selectedUser || isTyping) return;
  isTyping = true;
  socket.emit("typing:start", { toUser: selectedUser });
}

function stopTyping() {
  if (!isTyping) return;
  isTyping = false;
  if (selectedUser) {
    socket.emit("typing:stop", { toUser: selectedUser });
  }
}

// ════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════════════════════════

// Send on button click
sendBtn.addEventListener("click", sendMessage);

// Send on Enter key (Shift+Enter = new line — but since input is single line, just send)
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Typing detection
messageInput.addEventListener("input", () => {
  if (messageInput.value.trim()) {
    startTyping();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 1800); // Stop after 1.8s inactivity
  } else {
    clearTimeout(typingTimer);
    stopTyping();
  }
});

// Logout
logoutBtn.addEventListener("click", () => {
  sessionStorage.clear();
  socket.disconnect();
  window.location.href = "/";
});

// Mobile back button
backBtn.addEventListener("click", () => {
  selectedUser = null;
  emptyState.style.display = "flex";
  chatArea.style.display = "none";
  document.querySelector(".sidebar").classList.remove("hidden");
  renderUserList(getFilteredUsers());
});

// Search / filter users
searchInput.addEventListener("input", () => {
  renderUserList(getFilteredUsers());
});

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

/** Filter users by search term */
function getFilteredUsers() {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) return allUsers;
  return allUsers.filter((u) =>
    u.username.toLowerCase().includes(query)
  );
}

/** Get 1-2 letter initials from username */
function getInitials(name) {
  return name.slice(0, 2).toUpperCase();
}

/** Format ISO timestamp to readable time */
function formatTime(iso) {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Escape HTML to prevent XSS */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
