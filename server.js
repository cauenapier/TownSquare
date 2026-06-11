const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

/**
 * Tiny demo server for the first playable TownSquare slice.
 *
 * Responsibilities:
 * - serve the demo page and widget assets from ./public
 * - keep a short-lived in-memory list of connected visitors
 * - treat multiple tabs from the same browser as one visitor identity
 * - arbitrate the first bench prop so seat ownership stays consistent
 * - broadcast movement/chat/presence events over WebSocket
 *
 * Non-goals for this first slice:
 * - persistence
 * - auth/accounts
 * - durable history
 * - multi-room routing
 */

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, "public");
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");
const DEFAULT_DEV_ORIGINS = new Set([
  `http://${HOST}:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `https://${HOST}:${PORT}`,
  `https://127.0.0.1:${PORT}`,
  `https://localhost:${PORT}`,
]);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 100);
const MAX_BROWSER_ID_LEN = 80;
const MAX_WS_PAYLOAD_BYTES = Number(process.env.MAX_WS_PAYLOAD_BYTES || 512);
const MAX_MESSAGE_LEN = 140;
const MAX_RECENT_MESSAGES = 5;
const MOVE_THROTTLE_MS = 40;
const CHAT_THROTTLE_MS = 1500;
const RECONNECT_GRACE_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 30000;

const BENCH = {
  id: "bench",
  x: 0.2,
  zoneRadius: 0.035,
  pose: "sitting",
  seats: [-0.01, 0.01],
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function parseAllowedOrigins(value) {
  return new Set(
    String(value)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean),
  );
}

function normalizeOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) return null;

  try {
    const url = new URL(origin);
    url.hash = "";
    url.search = "";
    url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin, hostHeader) {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (DEFAULT_DEV_ORIGINS.has(normalized)) return true;

  try {
    const originUrl = new URL(normalized);
    const requestHost = String(hostHeader || "").trim().toLowerCase();
    if (requestHost && originUrl.host.toLowerCase() === requestHost) {
      return true;
    }
  } catch {
    return false;
  }

  if (ALLOWED_ORIGINS.size === 0) return false;
  return ALLOWED_ORIGINS.has(normalized);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKnownMessageType(type) {
  return type === "init" || type === "move" || type === "settle" || type === "say";
}

/** @returns {{connectionId:number,ws:any,identity:any,joined:boolean,lastMoveAt:number,lastChatAt:number}} */
function createClient(connectionId, ws) {
  return {
    connectionId,
    ws,
    identity: null,
    joined: false,
    lastMoveAt: 0,
    lastChatAt: 0,
  };
}

/** @returns {{id:number,browserId:string,x:number,pose:string|null,propId:string|null,clients:Set<any>,joined:boolean,leaveTimer:any,messages:Array<{text:string,at:number}>}} */
function createIdentity(id, browserId, x) {
  return {
    id,
    browserId,
    x,
    pose: null,
    propId: null,
    clients: new Set(),
    joined: false,
    leaveTimer: null,
    messages: [],
  };
}

function clampPosition(x) {
  if (typeof x !== "number" || Number.isNaN(x)) return null;
  if (x < 0 || x > 1) return null;
  return x;
}

function sanitizeBrowserId(browserId) {
  if (typeof browserId !== "string") return "";
  return browserId.slice(0, MAX_BROWSER_ID_LEN).replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeMessage(text) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_MESSAGE_LEN);
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
}

function resolvePublicFile(requestUrl, hostHeader) {
  const pathname = requestUrl === "/"
    ? "/index.html"
    : new URL(requestUrl, `http://${hostHeader}`).pathname;
  const normalized = path.normalize(pathname).replace(/^\.+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

function send(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

function snapshotIdentity(identity) {
  return {
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
    messages: identity.messages,
  };
}

function clearLeaveTimer(identity) {
  if (!identity.leaveTimer) return;
  clearTimeout(identity.leaveTimer);
  identity.leaveTimer = null;
}

function removeIdentity(identity) {
  identities.delete(identity.id);
  identityByBrowser.delete(identity.browserId);
}

function broadcast(message, options = {}) {
  const { exceptConnectionId = null } = options;
  const payload = JSON.stringify(message);

  for (const client of clients.values()) {
    if (!client.joined) continue;
    if (client.connectionId === exceptConnectionId) continue;
    if (client.ws.readyState !== client.ws.OPEN) continue;
    client.ws.send(payload);
  }
}

function emitIdentityState(identity, options = {}) {
  const { exceptConnectionId = null } = options;
  const message = {
    type: "move",
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
  };

  broadcast(message, { exceptConnectionId });
}

function getOrCreateIdentity(browserId, fallbackX, connectionId) {
  const key = sanitizeBrowserId(browserId) || `connection-${connectionId}`;
  const existing = identityByBrowser.get(key);
  if (existing) {
    return existing;
  }

  const identity = createIdentity(nextIdentityId++, key, fallbackX);
  identities.set(identity.id, identity);
  identityByBrowser.set(key, identity);
  return identity;
}

function clearPose(identity) {
  identity.pose = null;
  identity.propId = null;
}

function findAvailableBenchSeatX(requestedX, excludeIdentityId = null) {
  const takenSeats = new Set();

  for (const identity of identities.values()) {
    if (!identity.joined || identity.propId !== BENCH.id) continue;
    if (identity.id === excludeIdentityId) continue;

    const seatIndex = BENCH.seats.findIndex((offset) => Math.abs(identity.x - (BENCH.x + offset)) < 0.005);
    if (seatIndex !== -1) {
      takenSeats.add(seatIndex);
    }
  }

  const freeSeats = BENCH.seats
    .map((offset, index) => ({ index, x: BENCH.x + offset }))
    .filter((seat) => !takenSeats.has(seat.index));

  if (freeSeats.length === 0) {
    return null;
  }

  return freeSeats.reduce((best, seat) => (
    Math.abs(seat.x - requestedX) < Math.abs(best.x - requestedX) ? seat : best
  )).x;
}

const clients = new Map();
const identities = new Map();
const identityByBrowser = new Map();
let nextIdentityId = 1;
let nextConnectionId = 1;

function finalizeDisconnect(identity) {
  if (identity.clients.size > 0) return;
  const hadJoined = identity.joined;
  removeIdentity(identity);

  if (hadJoined) {
    broadcast({ type: "leave", id: identity.id });
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  const filePath = resolvePublicFile(req.url || "/", req.headers.host || `${HOST}:${PORT}`);

  if (!filePath) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      const status = error.code === "ENOENT" ? 404 : 500;
      const body = status === 404 ? "not found" : "server error";
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(body);
      return;
    }

    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": getContentType(filePath),
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({
  server,
  path: "/live",
  maxPayload: MAX_WS_PAYLOAD_BYTES,
  verifyClient(info, done) {
    if (clients.size >= MAX_CONNECTIONS) {
      done(false, 503, "full");
      return;
    }

    if (!isAllowedOrigin(info.origin, info.req.headers.host)) {
      done(false, 403, "origin not allowed");
      return;
    }

    done(true);
  },
});

function handleInit(client, message) {
  if (client.joined) return;

  const nextX = clampPosition(message.x);
  const fallbackX = nextX ?? 0.5;

  const identity = getOrCreateIdentity(message.browserId, fallbackX, client.connectionId);
  clearLeaveTimer(identity);

  client.identity = identity;
  client.joined = true;
  identity.clients.add(client);

  const peers = Array.from(identities.values())
    .filter((peer) => peer.joined && peer.id !== identity.id)
    .map(snapshotIdentity);

  send(client.ws, {
    type: "hello",
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
    messages: identity.messages,
    peers,
  });

  if (identity.joined) {
    return;
  }

  identity.joined = true;
  broadcast({ type: "join", peer: snapshotIdentity(identity) }, { exceptConnectionId: client.connectionId });
}

function handleMove(client, message) {
  if (!client.identity) return;

  const nextX = clampPosition(message.x);
  if (nextX === null) return;

  const now = Date.now();
  if (now - client.lastMoveAt < MOVE_THROTTLE_MS) return;

  client.lastMoveAt = now;
  client.identity.x = nextX;
  clearPose(client.identity);

  emitIdentityState(client.identity, { exceptConnectionId: client.connectionId });
}

function handleSettle(client, message) {
  if (!client.identity) return;
  if (message.propId !== BENCH.id) return;

  const identity = client.identity;
  if (Math.abs(identity.x - BENCH.x) > BENCH.zoneRadius) return;

  const seatX = findAvailableBenchSeatX(identity.x, identity.id);
  if (seatX === null) return;

  identity.x = seatX;
  identity.pose = BENCH.pose;
  identity.propId = BENCH.id;

  emitIdentityState(identity);
}

function handleSay(client, message) {
  if (!client.identity) return;

  const now = Date.now();
  if (now - client.lastChatAt < CHAT_THROTTLE_MS) return;

  const text = sanitizeMessage(message.text);
  if (!text) return;

  client.lastChatAt = now;
  client.identity.messages.push({ text, at: now });
  client.identity.messages = client.identity.messages.slice(-MAX_RECENT_MESSAGES);

  broadcast(
    {
      type: "say",
      id: client.identity.id,
      text,
      at: now,
    },
    { exceptConnectionId: client.connectionId },
  );
}

function handleClientMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (!isPlainObject(message)) return;
  if (typeof message.type !== "string" || !isKnownMessageType(message.type)) return;

  if (message.type === "init") {
    handleInit(client, message);
    return;
  }

  if (!client.joined) return;

  if (message.type === "move") {
    handleMove(client, message);
    return;
  }

  if (message.type === "settle") {
    handleSettle(client, message);
    return;
  }

  if (message.type === "say") {
    handleSay(client, message);
  }
}

function handleClientClose(client) {
  if (!client.joined || !client.identity) return;

  const identity = client.identity;
  identity.clients.delete(client);
  client.joined = false;
  client.identity = null;

  if (identity.clients.size > 0) {
    return;
  }

  identity.leaveTimer = setTimeout(() => {
    identity.leaveTimer = null;
    finalizeDisconnect(identity);
  }, RECONNECT_GRACE_MS);
}

const heartbeatTimer = setInterval(() => {
  for (const client of clients.values()) {
    if (client.ws.readyState !== client.ws.OPEN) continue;

    if (!client.ws.isAlive) {
      client.ws.terminate();
      continue;
    }

    client.ws.isAlive = false;
    client.ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref?.();

wss.on("connection", (ws) => {
  const client = createClient(nextConnectionId++, ws);
  clients.set(client.connectionId, client);
  ws.isAlive = true;

  ws.on("message", (raw) => handleClientMessage(client, raw));
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("close", () => {
    clients.delete(client.connectionId);
    handleClientClose(client);
  });
  ws.on("error", () => {
    // close handler owns cleanup
  });
});

wss.on("close", () => {
  clearInterval(heartbeatTimer);
});

server.listen(PORT, HOST, () => {
  console.log(`TownSquare server running at http://${HOST}:${PORT}`);
});
