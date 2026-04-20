/* ═══════════════════════════════════════════════════════
   ChatWave — Frontend Logic (script.js)
   ═══════════════════════════════════════════════════════ */

// ── Auth guard ────────────────────────────────────────────────────────────────
const ME = sessionStorage.getItem("chatUsername");
if (!ME) {
  window.location.href = "/";
}

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();

// ── State ─────────────────────────────────────────────────────────────────────
let currentPeer    = null;   // username of currently open chat
let onlineSet      = new Set();
let allUsers       = [];
let typingTimer    = null;
let mediaRecorder  = null;
let audioChunks    = [];
let isRecording    = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const userListEl      = $("user-list");
const messagesEl      = $("messages");
const messagesWrap    = $("messages-wrap");
const msgInput        = $("msg-input");
const emptyChat       = $("empty-chat");
const chatView        = $("chat-view");
const peerName        = $("peer-name");
const peerStatus      = $("peer-status");
const peerAvatar      = $("peer-avatar");
const typingIndicator = $("typing-indicator");
const typingName      = $("typing-name");
const recordingBar    = $("recording-bar");
const voiceBtn        = $("voice-btn");

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  $("my-username").textContent = ME;
  $("my-avatar").textContent   = ME[0].toUpperCase();

  socket.emit("join", { username: ME });
  socket.emit("get_all_users");
  socket.emit("get_online_users");
});

// ── Socket events ─────────────────────────────────────────────────────────────

// All registered users
socket.on("all_users", (users) => {
  allUsers = users.filter(u => u !== ME);
  renderUserList(allUsers);
});

// Online users broadcast
socket.on("online_users", (users) => {
  onlineSet = new Set(users.filter(u => u !== ME));
  updateOnlineStatus();
});

// Individual status change
socket.on("user_status", ({ username, status }) => {
  if (username === ME) return;

  if (status === "online") {
    onlineSet.add(username);
    // Make sure they appear in the list
    if (!allUsers.includes(username)) {
      allUsers.push(username);
    }
  } else {
    onlineSet.delete(username);
  }

  updateOnlineStatus();

  // Update peer status in header if chatting with them
  if (currentPeer === username) {
    renderPeerStatus(username);
  }
});

// Message history (on room open)
socket.on("message_history", ({ messages }) => {
  messagesEl.innerHTML = "";
  let lastDate = null;

  messages.forEach(msg => {
    const d = new Date(msg.timestamp).toDateString();
    if (d !== lastDate) {
      appendDateDivider(d);
      lastDate = d;
    }
    appendMessage(msg);
  });

  scrollBottom();
});

// Typing
socket.on(`typing_${getRoomId(ME, currentPeer)}`, handleTypingEvent);

// ── Render user list ──────────────────────────────────────────────────────────
function renderUserList(users) {
  if (!users.length) {
    userListEl.innerHTML = '<div class="empty-list">No other users yet</div>';
    return;
  }

  // Sort: online first, then alphabetical
  const sorted = [...users].sort((a, b) => {
    const ao = onlineSet.has(a) ? 0 : 1;
    const bo = onlineSet.has(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });

  userListEl.innerHTML = sorted.map(u => `
    <div class="user-item ${currentPeer === u ? 'active' : ''}" onclick="openChat('${u}')" id="user-${u}">
      <div class="avatar">
        ${u[0].toUpperCase()}
        <span class="avatar-status ${onlineSet.has(u) ? 'online' : 'offline'}"></span>
      </div>
      <div class="user-item-info">
        <span class="user-item-name">${u}</span>
        <span class="user-item-sub">${onlineSet.has(u) ? '● Online' : 'Offline'}</span>
      </div>
    </div>
  `).join('');
}

function updateOnlineStatus() {
  renderUserList(filterSearch());
}

function filterSearch() {
  const q = ($("user-search")?.value || "").toLowerCase();
  return q ? allUsers.filter(u => u.toLowerCase().includes(q)) : allUsers;
}

function filterUsers() {
  renderUserList(filterSearch());
}

// ── Open chat ─────────────────────────────────────────────────────────────────
function openChat(peer) {
  // Unsubscribe old room
  if (currentPeer) {
    socket.off(`message_${getRoomId(ME, currentPeer)}`);
    socket.off(`typing_${getRoomId(ME, currentPeer)}`);
  }

  currentPeer = peer;
  closeSidebar();

  // Show chat view
  emptyChat.style.display = "none";
  chatView.style.display  = "flex";

  // Render header
  peerName.textContent = peer;
  peerAvatar.className = "avatar lg";
  peerAvatar.textContent = peer[0].toUpperCase();
  renderPeerStatus(peer);

  // Highlight sidebar item
  document.querySelectorAll(".user-item").forEach(el => el.classList.remove("active"));
  const item = $(`user-${peer}`);
  if (item) item.classList.add("active");

  // Subscribe to this room
  const roomId = getRoomId(ME, peer);
  socket.on(`message_${roomId}`, (msg) => {
    appendMessage(msg);
    scrollBottom();
  });

  socket.on(`typing_${roomId}`, handleTypingEvent);

  // Load history
  socket.emit("get_messages", { user1: ME, user2: peer });

  // Focus input
  setTimeout(() => msgInput.focus(), 100);
}

function renderPeerStatus(peer) {
  const online = onlineSet.has(peer);
  peerStatus.textContent  = online ? "Online" : "Offline";
  peerStatus.className    = "chat-peer-status" + (online ? " is-online" : "");
}

// ── Send message ──────────────────────────────────────────────────────────────
function sendMessage() {
  const content = msgInput.value.trim();
  if (!content || !currentPeer) return;

  socket.emit("send_message", { from: ME, to: currentPeer, content });
  msgInput.value = "";

  // Stop typing
  socket.emit("typing", { from: ME, to: currentPeer, isTyping: false });
}

// ── Append message ────────────────────────────────────────────────────────────
function appendMessage(msg) {
  const isSent = msg.from === ME;
  const div = document.createElement("div");
  div.className = `msg ${isSent ? "sent" : "recv"}`;

  const time = formatTime(msg.timestamp);

  if (msg.type === "voice") {
    div.innerHTML = `
      <div class="msg-bubble voice-bubble">
        🎤 <audio controls src="${msg.content}"></audio>
      </div>
      <span class="msg-time">${time}</span>
    `;
  } else {
    div.innerHTML = `
      <div class="msg-bubble">${escapeHtml(msg.content)}</div>
      <span class="msg-time">${time}</span>
    `;
  }

  messagesEl.appendChild(div);
}

function appendDateDivider(dateStr) {
  const el = document.createElement("div");
  el.className = "date-divider";
  el.innerHTML = `<span>${friendlyDate(dateStr)}</span>`;
  messagesEl.appendChild(el);
}

// ── Typing ────────────────────────────────────────────────────────────────────
function onTyping() {
  if (!currentPeer) return;
  socket.emit("typing", { from: ME, to: currentPeer, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("typing", { from: ME, to: currentPeer, isTyping: false });
  }, 1500);
}

function handleTypingEvent({ from, isTyping }) {
  if (from !== currentPeer) return;
  typingName.textContent = from;
  typingIndicator.style.display = isTyping ? "flex" : "none";
}

// ── Voice recording ───────────────────────────────────────────────────────────
async function toggleRecording() {
  if (!currentPeer) return;

  if (!isRecording) {
    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          socket.emit("send_voice", {
            from: ME,
            to: currentPeer,
            audioData: reader.result, // base64 data URL
          });
        };
        reader.readAsDataURL(blob);

        // Stop mic
        stream.getTracks().forEach(t => t.stop());
        setRecordingUI(false);
      };

      mediaRecorder.start();
      isRecording = true;
      setRecordingUI(true);

    } catch (err) {
      alert("Microphone access denied. Please allow mic access to send voice messages.");
    }
  } else {
    // Stop & send
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    isRecording = false;
  }
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    // Stop mic tracks
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
  audioChunks = [];
  isRecording = false;
  setRecordingUI(false);
}

function setRecordingUI(on) {
  voiceBtn.classList.toggle("recording", on);
  recordingBar.style.display = on ? "flex" : "none";
}

// ── Scroll ────────────────────────────────────────────────────────────────────
function scrollBottom() {
  requestAnimationFrame(() => {
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  });
}

// ── Sidebar (mobile) ──────────────────────────────────────────────────────────
function openSidebar() {
  $("sidebar").classList.add("open");
  $("sidebar-overlay").classList.add("open");
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebar-overlay").classList.remove("open");
}

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  sessionStorage.removeItem("chatUsername");
  socket.disconnect();
  window.location.href = "/";
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
msgInput?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getRoomId(a, b) {
  return [a, b].sort().join("_");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function friendlyDate(dateStr) {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
