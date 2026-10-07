const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 3e6, // allow image messages (~3 MB payload)
});

app.use(express.static(path.join(__dirname, "public")));

/* ---------- In-memory stores (replace with a DB for production) ---------- */
const users = new Map();          // userId -> { id, username, email? }
const accounts = new Map();       // email  -> { id, username, email, salt, hash }
const sessions = new Map();       // token  -> userId (keeps you logged in on refresh/reconnect)
const online = new Map();         // userId -> Set(socketId)
const lastSeen = new Map();       // userId -> timestamp
const conversations = new Map();  // "idA:idB" (sorted) -> [messages]

const MAX_HISTORY = 300;
const MAX_MSG_LEN = 2000;
const MAX_IMG_LEN = 2000000; // characters of base64 data URL

/* ---------- Helpers ---------- */
const convKey = (a, b) => [a, b].sort().join(":");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return test.length === stored.length && crypto.timingSafeEqual(test, stored);
}

const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 20);

const publicUser = (u) => ({ id: u.id, username: u.username, registered: !!u.email });

function onlineList() {
  return [...online.keys()].map((id) => publicUser(users.get(id)));
}

const broadcastUsers = () => io.emit("users", onlineList());

function knownContacts(userId) {
  const list = [];
  for (const key of conversations.keys()) {
    const [a, b] = key.split(":");
    if (a !== userId && b !== userId) continue;
    const peer = users.get(a === userId ? b : a);
    if (peer) list.push({ ...publicUser(peer), lastSeen: lastSeen.get(peer.id) || null });
  }
  return list;
}

// When a user comes online, every message sent to them becomes "delivered"
function markDelivered(userId) {
  for (const [key, list] of conversations) {
    if (!key.split(":").includes(userId)) continue;
    const bySender = {};
    list.forEach((m) => {
      if (m.to === userId && m.status === "sent") {
        m.status = "delivered";
        (bySender[m.from] = bySender[m.from] || []).push(m.id);
      }
    });
    for (const [sender, ids] of Object.entries(bySender)) {
      io.to(sender).emit("status_update", { by: userId, ids, status: "delivered" });
    }
  }
}

function attach(socket, user, token) {
  socket.data.user = user;
  socket.data.token = token;
  socket.join(user.id);
  if (!online.has(user.id)) online.set(user.id, new Set());
  online.get(user.id).add(socket.id);

  socket.emit("auth_success", {
    ...publicUser(user),
    email: user.email || null,
    token,
  });
  socket.emit("known_contacts", knownContacts(user.id));
  markDelivered(user.id);
  broadcastUsers();
}

function newSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, userId);
  return token;
}

function allowed(socket) {
  const now = Date.now();
  const w = (socket.data.window = socket.data.window || []);
  while (w.length && now - w[0] > 10000) w.shift();
  if (w.length >= 20) return false;
  w.push(now);
  return true;
}

/* ---------- Socket handlers ---------- */
io.on("connection", (socket) => {
  // Resume an existing session (page refresh / network reconnect)
  socket.on("resume", (token) => {
    if (socket.data.user) return;
    const userId = sessions.get(String(token));
    const user = userId && users.get(userId);
    if (!user) return socket.emit("resume_failed");
    attach(socket, user, String(token));
  });

  // 1. Guest quick join (name only)
  socket.on("join", (username) => {
    if (socket.data.user) return;
    const name = cleanName(username);
    if (!name) return socket.emit("auth_error", "Please enter a valid name.");
    const user = { id: crypto.randomUUID(), username: name };
    users.set(user.id, user);
    attach(socket, user, newSession(user.id));
  });

  // 2. Register with email + password
  socket.on("register", ({ name, email, password } = {}) => {
    if (socket.data.user) return;
    const username = cleanName(name);
    const mail = String(email || "").trim().toLowerCase();
    const pass = String(password || "");

    if (!username || !/^\S+@\S+\.\S+$/.test(mail))
      return socket.emit("auth_error", "Enter a valid name and email address.");
    if (pass.length < 6)
      return socket.emit("auth_error", "Password must be at least 6 characters.");
    if (accounts.has(mail))
      return socket.emit("auth_error", "An account with this email already exists.");

    const { salt, hash } = hashPassword(pass);
    const user = { id: crypto.randomUUID(), username, email: mail };
    accounts.set(mail, { ...user, salt, hash });
    users.set(user.id, user);
    attach(socket, user, newSession(user.id));
  });

  // 3. Login with email + password
  socket.on("login", ({ email, password } = {}) => {
    if (socket.data.user) return;
    const mail = String(email || "").trim().toLowerCase();
    const acc = accounts.get(mail);
    if (!acc || !verifyPassword(String(password || ""), acc.salt, acc.hash))
      return socket.emit("auth_error", "Invalid email or password.");

    const user = { id: acc.id, username: acc.username, email: acc.email };
    users.set(user.id, user);
    attach(socket, user, newSession(user.id));
  });

  socket.on("logout", () => {
    if (socket.data.token) sessions.delete(socket.data.token);
  });

  // 4. Conversation history
  socket.on("get_history", (peerId, cb) => {
    const me = socket.data.user;
    if (!me || typeof cb !== "function") return;
    cb(conversations.get(convKey(me.id, String(peerId))) || []);
  });

  // 5. Send message (text, image, reply)
  socket.on("private message", ({ to, text, image, replyTo } = {}, cb) => {
    const me = socket.data.user;
    const done = typeof cb === "function" ? cb : () => {};
    if (!me) return done({ ok: false, error: "Not authenticated." });
    if (!allowed(socket)) return done({ ok: false, error: "You're sending too fast." });
    if (!users.has(to) || to === me.id) return done({ ok: false, error: "User not found." });

    const body = String(text || "").trim().slice(0, MAX_MSG_LEN);
    let img = null;
    if (image) {
      if (
        typeof image !== "string" ||
        image.length > MAX_IMG_LEN ||
        !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)
      )
        return done({ ok: false, error: "Invalid or too large image." });
      img = image;
    }
    if (!body && !img) return done({ ok: false, error: "Empty message." });

    const recipient = users.get(to);
    if (!online.has(to) && !recipient.email)
      return done({ ok: false, error: "User is offline." });

    const key = convKey(me.id, to);
    const list = conversations.get(key) || [];

    let quote = null;
    if (replyTo) {
      const orig = list.find((m) => m.id === replyTo);
      if (orig && !orig.deleted) {
        quote = {
          id: orig.id,
          fromName: orig.fromName,
          type: orig.image ? "image" : "text",
          text: orig.text.slice(0, 120),
        };
      }
    }

    const msg = {
      id: crypto.randomUUID(),
      from: me.id,
      fromName: me.username,
      to,
      text: body,
      image: img,
      replyTo: quote,
      ts: Date.now(),
      status: online.has(to) ? "delivered" : "sent",
      deleted: false,
    };

    list.push(msg);
    if (list.length > MAX_HISTORY) list.shift();
    conversations.set(key, list);

    io.to(to).to(me.id).emit("private message", msg);
    done({ ok: true });
  });

  // 6. Read receipts
  socket.on("mark_read", (peerId) => {
    const me = socket.data.user;
    if (!me) return;
    const list = conversations.get(convKey(me.id, String(peerId)));
    if (!list) return;
    const ids = [];
    list.forEach((m) => {
      if (m.from === peerId && m.to === me.id && m.status !== "read") {
        m.status = "read";
        ids.push(m.id);
      }
    });
    if (ids.length) io.to(String(peerId)).emit("status_update", { by: me.id, ids, status: "read" });
  });

  // 7. Delete for everyone (own messages only)
  socket.on("delete_message", ({ id, peerId } = {}) => {
    const me = socket.data.user;
    if (!me) return;
    const list = conversations.get(convKey(me.id, String(peerId)));
    const m = list && list.find((x) => x.id === id);
    if (!m || m.from !== me.id || m.deleted) return;
    m.deleted = true;
    m.text = "";
    m.image = null;
    m.replyTo = null;
    io.to(m.to).to(m.from).emit("message_deleted", { id: m.id, from: m.from, to: m.to });
  });

  // 8. Typing indicator
  socket.on("typing", ({ to, isTyping } = {}) => {
    const me = socket.data.user;
    if (!me || !users.has(to)) return;
    socket.to(to).emit("typing", { from: me.id, isTyping: !!isTyping });
  });

  // 9. Disconnect -> last seen
  socket.on("disconnect", () => {
    const me = socket.data.user;
    if (!me) return;
    const set = online.get(me.id);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(me.id);
        const ts = Date.now();
        lastSeen.set(me.id, ts);
        io.emit("last_seen", { id: me.id, ts });
      }
    }
    broadcastUsers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexus chat running at http://localhost:${PORT}`);
});
