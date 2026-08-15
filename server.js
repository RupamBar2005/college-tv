const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Users waiting to be matched.
// A Set is enough for an MVP; use Redis when you scale to multiple servers.
const waiting = new Set();

// socket.id -> partner socket.id
const partners = new Map();

app.use(express.static(__dirname));

app.get("/health", (_req, res) => {
  res.json({ ok: true, waiting: waiting.size, connected: io.engine.clientsCount });
});

function removeFromWaiting(id) {
  waiting.delete(id);
}

function disconnectPair(id, reason = "partner-left") {
  const partnerId = partners.get(id);
  partners.delete(id);

  if (!partnerId) return;

  partners.delete(partnerId);
  const partner = io.sockets.sockets.get(partnerId);
  if (partner) {
    partner.emit("partner-left", { reason });
  }
}

function tryMatch() {
  const ids = [...waiting].filter((id) => io.sockets.sockets.has(id));

  while (ids.length >= 2) {
    const a = ids.shift();
    const b = ids.shift();

    waiting.delete(a);
    waiting.delete(b);

    partners.set(a, b);
    partners.set(b, a);

    io.to(a).emit("matched", { initiator: true });
    io.to(b).emit("matched", { initiator: false });
  }
}

io.on("connection", (socket) => {
  socket.on("join-queue", () => {
    // Don't put a user into the queue while they are already in a call.
    if (partners.has(socket.id)) return;

    waiting.add(socket.id);
    socket.emit("queue-status", { waiting: true });
    tryMatch();
  });

  socket.on("next", () => {
  removeFromWaiting(socket.id);

  const partnerId = partners.get(socket.id);

  // Break the current pair.
  partners.delete(socket.id);

  if (partnerId) {
    partners.delete(partnerId);

    // Automatically put the old partner back into the queue.
    const partner = io.sockets.sockets.get(partnerId);

    if (partner) {
      waiting.add(partnerId);
      partner.emit("partner-next");
      partner.emit("queue-status", { waiting: true });
    }
  }

  // Put the person who pressed Next back into the queue.
  waiting.add(socket.id);
  socket.emit("queue-status", { waiting: true });

  tryMatch();
});

  socket.on("signal", (payload) => {
    const partnerId = partners.get(socket.id);
    if (!partnerId || !payload) return;

    const partner = io.sockets.sockets.get(partnerId);
    if (partner) {
      partner.emit("signal", {
        from: socket.id,
        data: payload
      });
    }
  });

  socket.on("report", (payload = {}) => {
    // MVP: log reports. In production, save to a moderation database.
    console.log("[REPORT]", {
      reporter: socket.id,
      category: String(payload.category || "other").slice(0, 100),
      details: String(payload.details || "").slice(0, 500),
      time: new Date().toISOString()
    });

    socket.emit("report-received");
  });

  socket.on("disconnect", () => {
    removeFromWaiting(socket.id);
    disconnectPair(socket.id, "disconnect");
    tryMatch();
  });
});

server.listen(PORT, () => {
  console.log(`Random Video Chat running at http://localhost:${PORT}`);
});
