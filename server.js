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
const MOVE_THROTTLE_MS = 40;
const RECONNECT_GRACE_MS = 1500;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
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

/** @returns {{id:number,browserId:string,x:number,clients:Set<any>,joined:boolean,leaveTimer:any}} */
function createIdentity(id, browserId, x) {
  return {
    id,
    browserId,
    x,
    clients: new Set(),
    joined: false,
    leaveTimer: null,
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

  broadcast(
    { type: "move", id: client.identity.id, x: client.identity.x },
    { exceptConnectionId: client.connectionId },
  );
}

function handleSay(client, message) {
  if (!client.identity) return;

  const text = sanitizeMessage(message.text);
  if (!text) return;

  broadcast(
    {
      type: "say",
      id: client.identity.id,
      text,
      at: Date.now(),
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
  console.log(`TownSquare demo running at http://${HOST}:${PORT}`);
});
