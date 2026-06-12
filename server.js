const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

loadEnvFile();

/**
 * Tiny demo server for the first playable TownSquare slice.
 *
 * Responsibilities:
 * - serve the demo page and widget assets from ./public
 * - keep a short-lived in-memory list of connected visitors
 * - treat multiple tabs from the same browser as one visitor identity
 * - arbitrate interactive props so seat ownership stays consistent
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
const SERVICE_ADMIN_PASSWORD = process.env.SERVICE_ADMIN_PASSWORD || "";
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
const REGISTRATIONS_PER_HOUR = Number(process.env.REGISTRATIONS_PER_HOUR || 20);
const AUTH_FAILURES_PER_HOUR = Number(process.env.AUTH_FAILURES_PER_HOUR || 30);
const LAST_SEEN_SAVE_INTERVAL_MS = 60000;
const MOVE_THROTTLE_MS = 40;
const CHAT_THROTTLE_MS = 1500;
const RECONNECT_GRACE_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 30000;

function loadEnvFile(filePath = path.join(__dirname, ".env")) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(process.env, key)) continue;

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not load .env: ${error.message}`);
    }
  }
}

const PROPS = [
  {
    id: "bench",
    x: 0.2,
    zoneRadius: 0.035,
    pose: "sitting",
    seats: [-0.01, 0.01],
  },
  {
    id: "tree",
    x: 0.8,
    zoneRadius: 0.015,
    pose: "resting",
    seats: [-0.008, 0.008],
  },
];
const PROPS_BY_ID = new Map(PROPS.map((prop) => [prop.id, prop]));

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

function hashAdminToken(adminToken, salt = crypto.randomBytes(16).toString("base64url")) {
  const digest = crypto.createHash("sha256").update(`${salt}:${adminToken}`).digest("base64url");
  return `sha256:${salt}:${digest}`;
}

function tokensMatch(expected, provided) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(provided || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function adminTokenMatches(site, adminToken) {
  const token = typeof adminToken === "string" ? adminToken.trim() : "";
  if (!site || !token) return false;

  if (site.adminTokenHash) {
    const [algorithm, salt] = String(site.adminTokenHash).split(":");
    if (algorithm !== "sha256" || !salt) return false;
    return tokensMatch(site.adminTokenHash, hashAdminToken(token, salt));
  }

  return tokensMatch(site.adminToken, token);
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
}

const CACHEABLE_STATIC_EXTENSIONS = new Set([".css", ".mjs", ".png", ".svg"]);
const WIDGET_CSS_PATH = path.join(PUBLIC_DIR, "widget.css");
const TOKENS_CSS_PATH = path.join(PUBLIC_DIR, "tokens.css");
/** @type {string | null} */
let widgetCssBundle = null;

function getWidgetCssBundle() {
  if (widgetCssBundle) return widgetCssBundle;

  const tokens = fs.readFileSync(TOKENS_CSS_PATH, "utf8");
  const widget = fs.readFileSync(WIDGET_CSS_PATH, "utf8");
  const body = widget.replace(/^@import\s+url\([^)]*tokens\.css[^)]*\)\s*;\s*/m, "");
  widgetCssBundle = `${tokens}\n${body}`;
  return widgetCssBundle;
}

function getStaticHeaders(filePath) {
  const ext = path.extname(filePath);
  const headers = {
    "cache-control": CACHEABLE_STATIC_EXTENSIONS.has(ext) ? "public, max-age=86400" : "no-store",
    "content-type": getContentType(filePath),
  };

  if ([".css", ".mjs"].includes(ext)) {
    headers["access-control-allow-origin"] = "*";
  }

  return headers;
}

function resolvePublicFile(requestUrl, hostHeader) {
  const url = new URL(requestUrl, `http://${hostHeader}`);
  const aliases = new Map([
    ["/", "/index.html"],
    ["/register", "/register.html"],
    ["/admin", "/admin.html"],
    ["/service-admin", "/service-admin.html"],
  ]);
  const pathname = aliases.get(url.pathname) || url.pathname;
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

function getAdminSiteByCredentials(siteKey, adminToken) {
  const site = sitesByKey.get(siteKey);
  if (!adminTokenMatches(site, adminToken)) return null;
  return site;
}

function findSiteByAdminToken(adminToken) {
  const token = typeof adminToken === "string" ? adminToken.trim() : "";
  if (!token) return null;

  for (const site of sitesByKey.values()) {
    if (adminTokenMatches(site, token)) return site;
  }

  return null;
}

function getPublicOrigin(req) {
  if (process.env.PUBLIC_ORIGIN) {
    return normalizeOrigin(process.env.PUBLIC_ORIGIN);
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto === "https" ? "https" : "http";
  return normalizeOrigin(`${proto}://${req.headers.host || `${HOST}:${PORT}`}`);
}

function buildEmbedSnippet(req, site) {
  const serverOrigin = getPublicOrigin(req);

  return `<link rel="preconnect" href="${serverOrigin}" crossorigin>
<div id="townsquare-root"></div>
<script type="module">
  const origin = "${serverOrigin}";
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = \`\${origin}/widget.css\`;
  document.head.appendChild(css);
  await new Promise((resolve, reject) => {
    css.addEventListener("load", resolve, { once: true });
    css.addEventListener("error", () => reject(new Error("TownSquare CSS failed to load")), { once: true });
  });
  const { mountTownSquare } = await import(\`\${origin}/townsquare.mjs\`);
  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: origin,
    siteKey: "${site.siteKey}"
  });
</script>`;
}

function buildAdminUrl(req, adminToken) {
  const serverOrigin = getPublicOrigin(req);
  const url = new URL("/admin", `${serverOrigin}/`);
  url.hash = new URLSearchParams({ adminToken }).toString();
  return url.toString();
}

const registrationsByIp = new Map();
const adminAuthFailuresByIp = new Map();
const serviceAdminAuthFailuresByIp = new Map();

function getRequestIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function recentBucket(map, key, limit) {
  if (limit <= 0) return [];

  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;

  if (map.size > 1000) {
    for (const [bucketKey, timestamps] of map) {
      if (timestamps.every((at) => at <= cutoff)) map.delete(bucketKey);
    }
  }

  const recent = (map.get(key) || []).filter((at) => at > cutoff);
  map.set(key, recent);
  return recent;
}

function isRegistrationAllowed(ip) {
  if (REGISTRATIONS_PER_HOUR <= 0) return true;

  const recent = recentBucket(registrationsByIp, ip, REGISTRATIONS_PER_HOUR);

  if (recent.length >= REGISTRATIONS_PER_HOUR) return false;

  recent.push(Date.now());
  return true;
}

function isAuthAttemptAllowed(map, ip) {
  if (AUTH_FAILURES_PER_HOUR <= 0) return true;
  return recentBucket(map, ip, AUTH_FAILURES_PER_HOUR).length < AUTH_FAILURES_PER_HOUR;
}

function recordAuthFailure(map, ip) {
  if (AUTH_FAILURES_PER_HOUR <= 0) return;
  recentBucket(map, ip, AUTH_FAILURES_PER_HOUR).push(Date.now());
}

function clearAuthFailures(map, ip) {
  map.delete(ip);
}

function sendAuthThrottled(res) {
  sendJson(res, 429, { error: "Too many failed sign-in attempts. Try again later." });
}

function handleRegisterSite(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isRegistrationAllowed(getRequestIp(req))) {
      sendJson(res, 429, { error: "Too many registrations from this address. Try again later." });
      return;
    }

    const origin = normalizeOrigin(String(body.origin || "").slice(0, MAX_ORIGIN_LEN));
    if (!origin) {
      sendJson(res, 400, { error: "Enter a valid website origin, like https://example.com." });
      return;
    }

    const { site, adminToken } = createSiteRecord({ name: body.name, origin });
    sitesByKey.set(site.siteKey, site);
    saveSites();

    sendJson(res, 201, {
      site: publicSite(site),
      adminToken,
      adminUrl: buildAdminUrl(req, adminToken),
      embedSnippet: buildEmbedSnippet(req, site),
    });
  });
}

function sendAdminSite(req, res, site, adminToken) {
  if (!site) {
    sendJson(res, 403, { error: "Invalid site key or admin token." });
    return;
  }

  sendJson(res, 200, {
    site: publicSite(site),
    adminUrl: buildAdminUrl(req, adminToken),
    embedSnippet: buildEmbedSnippet(req, site),
    scene: getSceneStats(getScene(site.siteKey)),
  });
}

function handlePostAdminSite(req, res) {
  readJsonBody(req, res, (body) => {
    const ip = getRequestIp(req);
    if (!isAuthAttemptAllowed(adminAuthFailuresByIp, ip)) {
      sendAuthThrottled(res);
      return;
    }

    const adminToken = String(body.adminToken || "").trim();
    const site = getAdminSiteByCredentials(String(body.siteKey || ""), adminToken);
    if (!site) {
      recordAuthFailure(adminAuthFailuresByIp, ip);
    } else {
      clearAuthFailures(adminAuthFailuresByIp, ip);
    }
    sendAdminSite(req, res, site, adminToken);
  });
}

function handleAdminLogin(req, res) {
  readJsonBody(req, res, (body) => {
    const ip = getRequestIp(req);
    if (!isAuthAttemptAllowed(adminAuthFailuresByIp, ip)) {
      sendAuthThrottled(res);
      return;
    }

    const adminToken = String(body.adminToken || "").trim();
    const site = findSiteByAdminToken(adminToken);
    if (!site) {
      recordAuthFailure(adminAuthFailuresByIp, ip);
      sendJson(res, 403, { error: "Invalid admin token." });
      return;
    }

    clearAuthFailures(adminAuthFailuresByIp, ip);
    sendJson(res, 200, {
      site: publicSite(site),
      adminUrl: buildAdminUrl(req, adminToken),
    });
  });
}

function handleAdminAction(req, res) {
  readJsonBody(req, res, (body) => {
    const ip = getRequestIp(req);
    if (!isAuthAttemptAllowed(adminAuthFailuresByIp, ip)) {
      sendAuthThrottled(res);
      return;
    }

    const site = getAdminSiteByCredentials(String(body.siteKey || ""), String(body.adminToken || ""));
    if (!site) {
      recordAuthFailure(adminAuthFailuresByIp, ip);
      sendJson(res, 403, { error: "Invalid site key or admin token." });
      return;
    }

    clearAuthFailures(adminAuthFailuresByIp, ip);
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

function serviceAdminPasswordMatches(password) {
  const expected = SERVICE_ADMIN_PASSWORD.trim();
  const provided = typeof password === "string" ? password.trim() : "";
  if (!expected || !provided) return false;
  return tokensMatch(expected, provided);
}

function isServiceAdminAuthorized(req, body, res) {
  if (!SERVICE_ADMIN_PASSWORD.trim()) {
    sendJson(res, 403, { error: "Service admin is not configured." });
    return false;
  }

  const ip = getRequestIp(req);
  if (!isAuthAttemptAllowed(serviceAdminAuthFailuresByIp, ip)) {
    sendAuthThrottled(res);
    return false;
  }

  if (!serviceAdminPasswordMatches(body.password)) {
    recordAuthFailure(serviceAdminAuthFailuresByIp, ip);
    sendJson(res, 403, { error: "Invalid service admin password." });
    return false;
  }

  clearAuthFailures(serviceAdminAuthFailuresByIp, ip);
  return true;
}

function serviceAdminSite(site) {
  const scene = scenes.get(site.siteKey);
  const sceneStats = scene ? getSceneStats(scene) : { activeVisitors: 0 };

  return {
    ...publicSite(site),
    updatedAt: site.updatedAt,
    activeVisitors: sceneStats.activeVisitors,
  };
}

function sendServiceAdminSites(res) {
  sendJson(res, 200, {
    sites: Array.from(sitesByKey.values()).map((site) => serviceAdminSite(site)),
  });
}

function closeSiteScene(siteKey, code, reason) {
  const scene = scenes.get(siteKey);
  if (!scene) return;

  for (const client of Array.from(scene.clients.values())) {
    client.ws.close(code, reason);
  }
  scenes.delete(siteKey);
}

function handleServiceAdminSites(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isServiceAdminAuthorized(req, body, res)) return;
    sendServiceAdminSites(res);
  });
}

function handleServiceAdminAction(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isServiceAdminAuthorized(req, body, res)) return;

    const siteKey = String(body.siteKey || "");
    const site = sitesByKey.get(siteKey);
    if (!site) {
      sendJson(res, 404, { error: "Site not found." });
      return;
    }

    const action = String(body.action || "");

    if (action === "resetAdminToken") {
      const adminToken = createToken("admin", 24);
      site.adminTokenHash = hashAdminToken(adminToken);
      site.updatedAt = Date.now();
      saveSites();
      sendJson(res, 200, {
        site: serviceAdminSite(site),
        adminToken,
        adminUrl: buildAdminUrl(req, adminToken),
      });
      return;
    }

    if (action === "setSiteDisabled") {
      site.disabled = Boolean(body.disabled);
      site.updatedAt = Date.now();
      saveSites();
      if (site.disabled) {
        closeSiteScene(site.siteKey, 4003, "site disabled");
      }
      sendJson(res, 200, { site: serviceAdminSite(site) });
      return;
    }

    if (action === "setChatDisabled") {
      site.chatDisabled = Boolean(body.disabled);
      site.updatedAt = Date.now();
      saveSites();
      sendJson(res, 200, { site: serviceAdminSite(site) });
      return;
    }

    if (action === "deleteSite") {
      closeSiteScene(site.siteKey, 4003, "site deleted");
      sitesByKey.delete(site.siteKey);
      saveSites();
      sendJson(res, 200, { deletedSiteKey: site.siteKey });
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

function findAvailableSeatX(scene, prop, requestedX, excludeIdentityId = null) {
  const seats = Array.isArray(prop.seats) && prop.seats.length > 0 ? prop.seats : [0];
  const takenSeats = new Set();

  for (const identity of scene.identities.values()) {
    if (!identity.joined || identity.propId !== prop.id) continue;
    if (identity.id === excludeIdentityId) continue;

    const seatIndex = seats.findIndex((offset) => Math.abs(identity.x - (prop.x + offset)) < 0.005);
    if (seatIndex !== -1) {
      takenSeats.add(seatIndex);
    }
  }

  const freeSeats = seats
    .map((offset, index) => ({ index, x: prop.x + offset }))
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
  const adminToken = createToken("admin", 24);
  return {
    adminToken,
    site: {
      siteKey: createToken("site", 12),
      adminTokenHash: hashAdminToken(adminToken),
      name: sanitizeSiteName(name, origin),
      origin,
      disabled: false,
      chatDisabled: false,
      verifiedAt: null,
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
      blockedBrowserIds: [],
    },
  };
}

let sitesMigratedOnLoad = false;

function loadSites() {
  try {
    const raw = fs.readFileSync(SITES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sites)) return new Map();
    return new Map(parsed.sites.map((site) => {
      if (site.adminToken) {
        if (!site.adminTokenHash) {
          site.adminTokenHash = hashAdminToken(site.adminToken);
        }
        delete site.adminToken;
        sitesMigratedOnLoad = true;
      }
      return [site.siteKey, site];
    }));
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
if (sitesMigratedOnLoad) {
  saveSites();
}
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

  if (req.method === "POST" && url.pathname === "/api/admin/site") {
    handlePostAdminSite(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    handleAdminLogin(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/action") {
    handleAdminAction(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/service-admin/sites") {
    handleServiceAdminSites(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/service-admin/action") {
    handleServiceAdminAction(req, res);
    return;
  }

  const filePath = resolvePublicFile(req.url || "/", req.headers.host || `${HOST}:${PORT}`);

  if (!filePath) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }

  if (filePath === WIDGET_CSS_PATH) {
    res.writeHead(200, getStaticHeaders(filePath));
    res.end(getWidgetCssBundle());
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
  verifyClient(_info, done) {
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
    const firstVerify = !site.verifiedAt;
    const lastSavedSeenAt = site.lastSeenAt || 0;
    site.lastSeenAt = now;
    site.verifiedAt = site.verifiedAt || now;

    if (firstVerify || now - lastSavedSeenAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      saveSites();
    }
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
  const prop = PROPS_BY_ID.get(message.propId);
  if (!prop?.pose) return;

  const identity = client.identity;
  if (Math.abs(identity.x - prop.x) > prop.zoneRadius) return;

  const seatX = findAvailableSeatX(client.scene, prop, identity.x, identity.id);
  if (seatX === null) return;

  identity.x = seatX;
  identity.pose = prop.pose;
  identity.propId = prop.id;

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

  const originAllowed = access.site
    ? isOriginAllowedForSite(req.headers.origin, access.site)
    : isAllowedOrigin(req.headers.origin, req.headers.host);

  if (!originAllowed) {
    ws.close(4003, "origin not allowed");
    return;
  }

  if (access.scene.clients.size >= MAX_CONNECTIONS) {
    ws.close(1013, "full");
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
