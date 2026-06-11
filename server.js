const http = require("http");
const crypto = require("crypto");
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
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
const MAX_SITE_NAME_LEN = 80;
const MAX_ORIGIN_LEN = 240;
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

const MESSAGE_HANDLERS = {
  init: handleInit,
  move: handleMove,
  settle: handleSettle,
  say: handleSay,
};

/** @returns {{connectionId:number,ws:any,identity:any,joined:boolean,lastMoveAt:number,lastChatAt:number}} */
function createClient(connectionId, ws, scene, site) {
  return {
    connectionId,
    ws,
    scene,
    site,
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

function sanitizeSiteName(name, origin) {
  const cleanName = typeof name === "string" ? name.trim().slice(0, MAX_SITE_NAME_LEN) : "";
  if (cleanName) return cleanName;

  try {
    return new URL(origin).hostname;
  } catch {
    return "Untitled site";
  }
}

function createToken(prefix, bytes = 18) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
}

function getStaticHeaders(filePath) {
  const headers = {
    "cache-control": "no-store",
    "content-type": getContentType(filePath),
  };

  if ([".css", ".mjs"].includes(path.extname(filePath))) {
    headers["access-control-allow-origin"] = "*";
  }

  return headers;
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

function readJsonBody(req, res, callback) {
  let raw = "";

  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 4096) {
      res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "request too large" }));
      req.destroy();
    }
  });

  req.on("end", () => {
    if (!raw) {
      callback({});
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      callback(isPlainObject(parsed) ? parsed : {});
    } catch {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid json" }));
    }
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function getAdminSite(url) {
  const siteKey = url.searchParams.get("siteKey") || "";
  const adminToken = url.searchParams.get("adminToken") || "";
  const site = sitesByKey.get(siteKey);
  if (!site || site.adminToken !== adminToken) return null;
  return site;
}

function buildEmbedSnippet(req, site) {
  const serverOrigin = normalizeOrigin(
    process.env.PUBLIC_ORIGIN || `http://${req.headers.host || `${HOST}:${PORT}`}`,
  );

  return `<link rel="stylesheet" href="${serverOrigin}/widget.css" />
<div id="townsquare-root"></div>
<script type="module">
  import { mountTownSquare } from "${serverOrigin}/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "${serverOrigin}",
    siteKey: "${site.siteKey}"
  });
</script>`;
}

function buildAdminUrl(req, site) {
  const serverOrigin = normalizeOrigin(
    process.env.PUBLIC_ORIGIN || `http://${req.headers.host || `${HOST}:${PORT}`}`,
  );
  const url = new URL("/admin.html", `${serverOrigin}/`);
  url.searchParams.set("siteKey", site.siteKey);
  url.searchParams.set("adminToken", site.adminToken);
  return url.toString();
}

function handleRegisterSite(req, res) {
  readJsonBody(req, res, (body) => {
    const origin = normalizeOrigin(String(body.origin || "").slice(0, MAX_ORIGIN_LEN));
    if (!origin) {
      sendJson(res, 400, { error: "Enter a valid website origin, like https://example.com." });
      return;
    }

    const site = createSiteRecord({ name: body.name, origin });
    sitesByKey.set(site.siteKey, site);
    saveSites();

    sendJson(res, 201, {
      site: publicSite(site),
      adminToken: site.adminToken,
      adminUrl: buildAdminUrl(req, site),
      embedSnippet: buildEmbedSnippet(req, site),
    });
  });
}

function handleGetAdminSite(req, res, url) {
  const site = getAdminSite(url);
  if (!site) {
    sendJson(res, 403, { error: "Invalid site key or admin token." });
    return;
  }

  sendJson(res, 200, {
    site: publicSite(site),
    adminUrl: buildAdminUrl(req, site),
    embedSnippet: buildEmbedSnippet(req, site),
    scene: getSceneStats(getScene(site.siteKey)),
  });
}

function handleAdminAction(req, res) {
  readJsonBody(req, res, (body) => {
    const site = sitesByKey.get(String(body.siteKey || ""));
    if (!site || site.adminToken !== body.adminToken) {
      sendJson(res, 403, { error: "Invalid site key or admin token." });
      return;
    }

    const action = String(body.action || "");
    const scene = getScene(site.siteKey);

    if (action === "setChatDisabled") {
      site.chatDisabled = Boolean(body.disabled);
      site.updatedAt = Date.now();
      saveSites();
      sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
      return;
    }

    if (action === "kickVisitor") {
      const visitorId = Number(body.visitorId);
      const identity = scene.identities.get(visitorId);
      if (identity) {
        for (const client of Array.from(identity.clients)) {
          client.ws.close(4001, "kicked");
        }
      }
      sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
      return;
    }

    if (action === "blockVisitor") {
      const visitorId = Number(body.visitorId);
      const identity = scene.identities.get(visitorId);
      if (identity && !site.blockedBrowserIds.includes(identity.browserId)) {
        site.blockedBrowserIds.push(identity.browserId);
        site.updatedAt = Date.now();
        saveSites();
        for (const client of Array.from(identity.clients)) {
          client.ws.close(4003, "blocked");
        }
      }
      sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
      return;
    }

    if (action === "clearMessages") {
      for (const identity of scene.identities.values()) {
        identity.messages = [];
      }
      sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
      return;
    }

    if (action === "disableSite") {
      site.disabled = Boolean(body.disabled);
      site.updatedAt = Date.now();
      saveSites();
      if (site.disabled) {
        for (const client of Array.from(scene.clients.values())) {
          client.ws.close(4003, "site disabled");
        }
      }
      sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
      return;
    }

    sendJson(res, 400, { error: "Unknown action." });
  });
}

function send(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

function snapshotIdentity(identity) {
  return {
    id: identity.id,
    browserId: identity.browserId,
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

function removeIdentity(scene, identity) {
  scene.identities.delete(identity.id);
  scene.identityByBrowser.delete(identity.browserId);
}

function broadcast(scene, message, options = {}) {
  const { exceptConnectionId = null } = options;
  const payload = JSON.stringify(message);

  for (const client of scene.clients.values()) {
    if (!client.joined) continue;
    if (client.connectionId === exceptConnectionId) continue;
    if (client.ws.readyState !== client.ws.OPEN) continue;
    client.ws.send(payload);
  }
}

function emitIdentityState(identity, options = {}) {
  const { scene } = identity;
  const { exceptConnectionId = null } = options;
  const message = {
    type: "move",
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
  };

  broadcast(scene, message, { exceptConnectionId });
}

function getOrCreateIdentity(scene, browserId, fallbackX, connectionId) {
  const key = sanitizeBrowserId(browserId) || `connection-${connectionId}`;
  const existing = scene.identityByBrowser.get(key);
  if (existing) {
    return existing;
  }

  const identity = createIdentity(scene.nextIdentityId++, key, fallbackX);
  identity.scene = scene;
  scene.identities.set(identity.id, identity);
  scene.identityByBrowser.set(key, identity);
  return identity;
}

function clearPose(identity) {
  identity.pose = null;
  identity.propId = null;
}

function findAvailableBenchSeatX(scene, requestedX, excludeIdentityId = null) {
  const takenSeats = new Set();

  for (const identity of scene.identities.values()) {
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

function createScene(key) {
  return {
    key,
    clients: new Map(),
    identities: new Map(),
    identityByBrowser: new Map(),
    nextIdentityId: 1,
  };
}

function createSiteRecord({ name, origin }) {
  const now = Date.now();
  return {
    siteKey: createToken("site", 12),
    adminToken: createToken("admin", 24),
    name: sanitizeSiteName(name, origin),
    origin,
    disabled: false,
    chatDisabled: false,
    verifiedAt: null,
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
    blockedBrowserIds: [],
  };
}

function loadSites() {
  try {
    const raw = fs.readFileSync(SITES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sites)) return new Map();
    return new Map(parsed.sites.map((site) => [site.siteKey, site]));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not load sites registry: ${error.message}`);
    }
    return new Map();
  }
}

function saveSites() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sites = Array.from(sitesByKey.values());
  fs.writeFileSync(SITES_FILE, `${JSON.stringify({ sites }, null, 2)}\n`);
}

function publicSite(site) {
  return {
    siteKey: site.siteKey,
    name: site.name,
    origin: site.origin,
    disabled: site.disabled,
    chatDisabled: site.chatDisabled,
    verifiedAt: site.verifiedAt,
    lastSeenAt: site.lastSeenAt,
    createdAt: site.createdAt,
    blockedCount: site.blockedBrowserIds.length,
  };
}

function getScene(sceneKey) {
  const existing = scenes.get(sceneKey);
  if (existing) return existing;

  const scene = createScene(sceneKey);
  scenes.set(sceneKey, scene);
  return scene;
}

function getSceneStats(scene) {
  const visitors = Array.from(scene.identities.values())
    .filter((identity) => identity.joined)
    .map((identity) => ({
      id: identity.id,
      browserId: identity.browserId,
      x: identity.x,
      pose: identity.pose,
      propId: identity.propId,
      clientCount: identity.clients.size,
      messages: identity.messages,
    }));

  return { activeVisitors: visitors.length, visitors };
}

function validateSiteAccess(reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const siteKey = url.searchParams.get("siteKey") || "";
  if (!siteKey) {
    return { ok: true, scene: getScene("default"), site: null };
  }

  const site = sitesByKey.get(siteKey);
  if (!site || site.disabled) {
    return { ok: false, status: 403, reason: "site disabled or unknown" };
  }

  return { ok: true, scene: getScene(site.siteKey), site };
}

function isOriginAllowedForSite(origin, site) {
  if (!site) return true;
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && normalized === site.origin);
}

const sitesByKey = loadSites();
const scenes = new Map();
let nextConnectionId = 1;

function finalizeDisconnect(identity) {
  if (identity.clients.size > 0) return;
  const hadJoined = identity.joined;
  removeIdentity(identity.scene, identity);

  if (hadJoined) {
    broadcast(identity.scene, { type: "leave", id: identity.id });
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "POST" && url.pathname === "/api/sites") {
    handleRegisterSite(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/site") {
    handleGetAdminSite(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/action") {
    handleAdminAction(req, res);
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

    res.writeHead(200, getStaticHeaders(filePath));
    res.end(data);
  });
});

const wss = new WebSocketServer({
  server,
  path: "/live",
  maxPayload: MAX_WS_PAYLOAD_BYTES,
  verifyClient(info, done) {
    const access = validateSiteAccess(info.req.url || "/live");
    const connectionCount = access.ok ? access.scene.clients.size : 0;

    if (!access.ok) {
      done(false, access.status, access.reason);
      return;
    }

    if (connectionCount >= MAX_CONNECTIONS) {
      done(false, 503, "full");
      return;
    }

    const originAllowed = access.site
      ? isOriginAllowedForSite(info.origin, access.site)
      : isAllowedOrigin(info.origin, info.req.headers.host);

    if (!originAllowed) {
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
  const { scene, site } = client;

  if (site && site.blockedBrowserIds.includes(sanitizeBrowserId(message.browserId))) {
    client.ws.close(4003, "blocked");
    return;
  }

  const identity = getOrCreateIdentity(scene, message.browserId, fallbackX, client.connectionId);
  clearLeaveTimer(identity);

  client.identity = identity;
  client.joined = true;
  identity.clients.add(client);

  const peers = Array.from(scene.identities.values())
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

  if (site) {
    const now = Date.now();
    site.lastSeenAt = now;
    site.verifiedAt = site.verifiedAt || now;
    saveSites();
  }

  broadcast(scene, { type: "join", peer: snapshotIdentity(identity) }, { exceptConnectionId: client.connectionId });
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

  const seatX = findAvailableBenchSeatX(client.scene, identity.x, identity.id);
  if (seatX === null) return;

  identity.x = seatX;
  identity.pose = BENCH.pose;
  identity.propId = BENCH.id;

  emitIdentityState(identity);
}

function handleSay(client, message) {
  if (!client.identity) return;
  if (client.site?.chatDisabled) return;

  const now = Date.now();
  if (now - client.lastChatAt < CHAT_THROTTLE_MS) return;

  const text = sanitizeMessage(message.text);
  if (!text) return;

  client.lastChatAt = now;
  client.identity.messages.push({ text, at: now });
  client.identity.messages = client.identity.messages.slice(-MAX_RECENT_MESSAGES);

  broadcast(
    client.scene,
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
  if (typeof message.type !== "string") return;

  const handler = MESSAGE_HANDLERS[message.type];
  if (typeof handler !== "function") return;

  if (message.type !== "init" && !client.joined) return;

  handler(client, message);
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
  for (const scene of scenes.values()) {
    for (const client of scene.clients.values()) {
      if (client.ws.readyState !== client.ws.OPEN) continue;

      if (!client.ws.isAlive) {
        client.ws.terminate();
        continue;
      }

      client.ws.isAlive = false;
      client.ws.ping();
    }
  }
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref?.();

wss.on("connection", (ws, req) => {
  const access = validateSiteAccess(req.url || "/live");
  if (!access.ok) {
    ws.close(4003, access.reason);
    return;
  }

  const client = createClient(nextConnectionId++, ws, access.scene, access.site);
  access.scene.clients.set(client.connectionId, client);
  ws.isAlive = true;

  ws.on("message", (raw) => handleClientMessage(client, raw));
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("close", () => {
    client.scene.clients.delete(client.connectionId);
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
