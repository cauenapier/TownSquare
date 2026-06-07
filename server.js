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
const MAX_BROWSER_ID_LEN = 80;
const MAX_MESSAGE_LEN = 140;
const MAX_RECENT_MESSAGES = 5;
const MOVE_THROTTLE_MS = 40;
const RECONNECT_GRACE_MS = 1500;

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

/** @returns {{connectionId:number,ws:any,browserId:string,identity:any,x:number,joined:boolean,lastMoveAt:number}} */
function createClient(connectionId, ws) {
  return {
    connectionId,
    ws,
    browserId: "",
    identity: null,
    x: 0.5,
    joined: false,
    lastMoveAt: 0,
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
  const { exceptConnectionId = null, includeConnectionId = null } = options;
  const message = {
    type: "move",
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
  };

  if (includeConnectionId !== null) {
    const client = clients.get(includeConnectionId);
    if (client?.joined) {
      send(client.ws, message);
    }
  }

  broadcast(message, { exceptConnectionId });
}

function getOrCreateIdentity(browserId, fallbackX) {
  const key = sanitizeBrowserId(browserId) || `connection-${nextConnectionKey++}`;
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
let nextConnectionKey = 1;

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

const wss = new WebSocketServer({ server, path: "/live" });

function handleInit(client, message) {
  if (client.joined) return;

  const nextX = clampPosition(message.x);
  if (nextX !== null) {
    client.x = nextX;
  }

  const identity = getOrCreateIdentity(message.browserId, client.x);
  clearLeaveTimer(identity);

  client.browserId = identity.browserId;
  client.identity = identity;
  client.joined = true;
  client.x = identity.x;
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
  client.x = nextX;
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
  client.x = seatX;

  emitIdentityState(identity, {
    includeConnectionId: client.connectionId,
    exceptConnectionId: client.connectionId,
  });
}

function handleSay(client, message) {
  if (!client.identity) return;

  const text = sanitizeMessage(message.text);
  if (!text) return;
  const at = Date.now();
  client.identity.messages.push({ text, at });
  client.identity.messages = client.identity.messages.slice(-MAX_RECENT_MESSAGES);

  broadcast(
    {
      type: "say",
      id: client.identity.id,
      text,
      at,
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

  if (!message || typeof message !== "object") return;

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

wss.on("connection", (ws) => {
  const client = createClient(nextConnectionId++, ws);
  clients.set(client.connectionId, client);

  ws.on("message", (raw) => handleClientMessage(client, raw));
  ws.on("close", () => {
    clients.delete(client.connectionId);
    handleClientClose(client);
  });
  ws.on("error", () => {
    // close handler owns cleanup
  });
});

server.listen(PORT, HOST, () => {
  console.log(`TownSquare server running at http://${HOST}:${PORT}`);
});
