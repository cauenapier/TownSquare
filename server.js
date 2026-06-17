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
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
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
const MAX_BROWSER_SECRET_LEN = 64;
const MAX_WS_PAYLOAD_BYTES = Number(process.env.MAX_WS_PAYLOAD_BYTES || 512);
const MAX_READING_URL_LEN = 240;
const MAX_SITE_NAME_LEN = 80;
const MAX_ORIGIN_LEN = 240;
const REGISTRATIONS_PER_HOUR = Number(process.env.REGISTRATIONS_PER_HOUR || 20);
const AUTH_FAILURES_PER_HOUR = Number(process.env.AUTH_FAILURES_PER_HOUR || 30);
const LAST_SEEN_SAVE_INTERVAL_MS = 60000;
const MOVE_THROTTLE_MS = 40;
const ACTION_THROTTLE_MS = 560;
const CHAT_THROTTLE_MS = 1500;
const RECONNECT_GRACE_MS = 1500;
const INACTIVE_DISCONNECT_MS = Number(process.env.INACTIVE_DISCONNECT_MS || 30 * 60 * 1000);
const INACTIVE_CHECK_INTERVAL_MS = Number(process.env.INACTIVE_CHECK_INTERVAL_MS || 60000);
const HEARTBEAT_INTERVAL_MS = 30000;
const BIRD_TICK_INTERVAL_MS = 1000;
const TELEGRAM_API_TIMEOUT_MS = 5000;
const MAX_BIRDS = 3;
const BIRD_FLEE_RADIUS = 0.07;
const BIRD_SPAWN_MIN_MS = Number(process.env.BIRD_SPAWN_MIN_MS || 12000);
const BIRD_SPAWN_MAX_MS = Number(process.env.BIRD_SPAWN_MAX_MS || 22000);
const BIRD_FIRST_SPAWN_MS = Number(process.env.BIRD_FIRST_SPAWN_MS || 500);

// Wire-protocol limits and the character palette, shared with the widget.
// Populated from public/shared-constants.mjs in startServer (the server is
// CommonJS, so the shared ES module is loaded via dynamic import).
let MIN_X;
let MAX_X;
let MAX_MESSAGE_LEN;
let MAX_DISPLAY_NAME_LEN;
let MAX_READING_LABEL_LEN;
let MAX_RECENT_MESSAGES;
let DEFAULT_CHARACTER_COLOR;
/** @type {Set<string>} */
let CHARACTER_COLORS = new Set();

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

/** @type {Map<string, import("./public/scene-props.mjs").SceneProp>} */
let PROPS_BY_ID = new Map();
/** @type {Array<import("./public/bird-perches.mjs").BirdPerch>} */
let BIRD_PERCHES = [];

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
  action: handleAction,
  init: handleInit,
  move: handleMove,
  profile: handleProfile,
  reading: handleReading,
  settle: handleSettle,
  say: handleSay,
};

/** @returns {{connectionId:number,ws:any,identity:any,joined:boolean,readingActive:boolean,lastMoveAt:number,lastActionAt:number,lastChatAt:number}} */
function createClient(connectionId, ws, scene, site) {
  return {
    connectionId,
    ws,
    scene,
    site,
    identity: null,
    joined: false,
    readingActive: false,
    lastMoveAt: 0,
    lastActionAt: 0,
    lastChatAt: 0,
  };
}

/** @returns {{id:number,browserId:string,browserSecret:string,x:number,pose:string|null,propId:string|null,displayName:string,color:string,readingLabel:string,readingUrl:string,readingActive:boolean,isOwner:boolean,clients:Set<any>,joined:boolean,leaveTimer:any,inactiveKick:boolean,lastActivityAt:number,awaySince:number|null,messages:Array<{text:string,at:number}>}} */
function createIdentity(id, browserId, x) {
  return {
    id,
    browserId,
    browserSecret: crypto.randomBytes(32).toString("hex"),
    x,
    pose: null,
    propId: null,
    displayName: "",
    color: DEFAULT_CHARACTER_COLOR,
    readingLabel: "",
    readingUrl: "",
    readingActive: false,
    isOwner: false,
    clients: new Set(),
    joined: false,
    leaveTimer: null,
    inactiveKick: false,
    lastActivityAt: 0,
    awaySince: null,
    messages: [],
  };
}

function randomSpawnX() {
  return MIN_X + Math.random() * (MAX_X - MIN_X);
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

function sanitizeBrowserSecret(browserSecret) {
  if (typeof browserSecret !== "string") return "";
  return browserSecret.slice(0, MAX_BROWSER_SECRET_LEN).replace(/[^a-f0-9]/gi, "");
}

function sanitizeMessage(text) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_MESSAGE_LEN);
}

function sanitizeDisplayName(displayName) {
  if (typeof displayName !== "string") return "";
  return displayName.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME_LEN);
}

function sanitizeReadingLabel(readingLabel) {
  if (typeof readingLabel !== "string") return "";
  return readingLabel.trim().replace(/\s+/g, " ").slice(0, MAX_READING_LABEL_LEN);
}

function sanitizeReadingUrl(readingUrl) {
  if (typeof readingUrl !== "string") return "";
  try {
    const url = new URL(readingUrl.slice(0, MAX_READING_URL_LEN));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeCharacterColor(color) {
  return CHARACTER_COLORS.has(color) ? color : DEFAULT_CHARACTER_COLOR;
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

function escapeTelegramMarkdown(text) {
  return String(text || "").replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function buildTelegramMessage(site, identity, text, at) {
  const siteLabel = site
    ? `${site.name} (${site.origin})`
    : "default scene";

  return [
    "*TownSquare message*",
    `Site: ${escapeTelegramMarkdown(siteLabel)}`,
    `Visitor: ${escapeTelegramMarkdown(String(identity.id))}`,
    `Browser: ${escapeTelegramMarkdown(identity.browserId)}`,
    `At: ${escapeTelegramMarkdown(new Date(at).toISOString())}`,
    "",
    escapeTelegramMarkdown(text),
  ].join("\n");
}

async function sendTelegramChatNotification(site, identity, text, at) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: buildTelegramMessage(site, identity, text, at),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Telegram notification failed with ${response.status}`);
    }
  } catch (error) {
    console.warn(`Telegram notification failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildEmbedSnippet(req, site) {
  const serverOrigin = getPublicOrigin(req);

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

const ADMIN_ACTIONS = {
  setChatDisabled(site, scene, body) {
    site.chatDisabled = Boolean(body.disabled);
    touchSite(site);
  },
  kickVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (identity) {
      closeIdentityClients(identity, 4001, "kicked");
    }
  },
  blockVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (identity && !site.blockedBrowserIds.includes(identity.browserId)) {
      site.blockedBrowserIds.push(identity.browserId);
      touchSite(site);
      closeIdentityClients(identity, 4003, "blocked");
    }
  },
  setOwnerVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity) return;
    const owner = Boolean(body.owner);
    const index = site.ownerBrowserIds.indexOf(identity.browserId);
    if (owner && index === -1) site.ownerBrowserIds.push(identity.browserId);
    if (!owner && index !== -1) site.ownerBrowserIds.splice(index, 1);
    identity.isOwner = owner;
    touchSite(site);
    broadcast(scene, {
      type: "profile",
      id: identity.id,
      displayName: identity.displayName,
      color: identity.color,
      isOwner: owner,
    });
  },
  clearMessages(site, scene) {
    for (const identity of scene.identities.values()) {
      identity.messages = [];
    }
  },
  disableSite(site, scene, body) {
    site.disabled = Boolean(body.disabled);
    touchSite(site);
    if (site.disabled) {
      for (const client of Array.from(scene.clients.values())) {
        client.ws.close(4003, "site disabled");
      }
    }
  },
};

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
    if (!Object.hasOwn(ADMIN_ACTIONS, action)) {
      sendJson(res, 400, { error: "Unknown action." });
      return;
    }

    const scene = getScene(site.siteKey);
    ADMIN_ACTIONS[action](site, scene, body);
    sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene) });
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

/** Each handler mutates the site and returns the JSON response body. */
const SERVICE_ADMIN_ACTIONS = {
  resetAdminToken(req, site) {
    const adminToken = createToken("admin", 24);
    site.adminTokenHash = hashAdminToken(adminToken);
    touchSite(site);
    return {
      site: serviceAdminSite(site),
      adminToken,
      adminUrl: buildAdminUrl(req, adminToken),
    };
  },
  setSiteDisabled(req, site, body) {
    site.disabled = Boolean(body.disabled);
    touchSite(site);
    if (site.disabled) {
      closeSiteScene(site.siteKey, 4003, "site disabled");
    }
    return { site: serviceAdminSite(site) };
  },
  setChatDisabled(req, site, body) {
    site.chatDisabled = Boolean(body.disabled);
    touchSite(site);
    return { site: serviceAdminSite(site) };
  },
  deleteSite(req, site) {
    closeSiteScene(site.siteKey, 4003, "site deleted");
    sitesByKey.delete(site.siteKey);
    saveSites();
    return { deletedSiteKey: site.siteKey };
  },
};

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
    if (!Object.hasOwn(SERVICE_ADMIN_ACTIONS, action)) {
      sendJson(res, 400, { error: "Unknown action." });
      return;
    }

    sendJson(res, 200, SERVICE_ADMIN_ACTIONS[action](req, site, body));
  });
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
    displayName: identity.displayName,
    color: identity.color,
    readingLabel: identity.readingLabel,
    readingUrl: identity.readingUrl,
    readingActive: identity.readingActive,
    isOwner: identity.isOwner,
    messages: identity.messages,
  };
}

function getIdentityReadingActive(identity) {
  return Array.from(identity.clients).some((client) => client.joined && client.readingActive);
}

function refreshIdentityReadingActive(identity) {
  const previous = identity.readingActive;
  identity.readingActive = getIdentityReadingActive(identity);
  return identity.readingActive !== previous;
}

function touchIdentityActivity(identity, now = Date.now()) {
  identity.lastActivityAt = now;
}

function syncIdentityAwayState(identity, now = Date.now()) {
  if (!identity.joined) return;

  if (identity.readingActive) {
    identity.awaySince = null;
    return;
  }

  if (identity.awaySince === null) {
    identity.awaySince = now;
  }
}

function isIdentityInactive(identity, now = Date.now()) {
  if (!identity.joined || identity.clients.size === 0) return false;
  if (INACTIVE_DISCONNECT_MS <= 0) return false;

  if (identity.awaySince !== null && now - identity.awaySince >= INACTIVE_DISCONNECT_MS) {
    return true;
  }

  return identity.lastActivityAt > 0 && now - identity.lastActivityAt >= INACTIVE_DISCONNECT_MS;
}

function disconnectInactiveIdentity(identity) {
  if (!identity.joined) return;
  clearLeaveTimer(identity);
  identity.inactiveKick = true;
  closeIdentityClients(identity, 4001, "inactive");
}

function sweepInactiveIdentities(now = Date.now()) {
  if (INACTIVE_DISCONNECT_MS <= 0) return;

  for (const scene of scenes.values()) {
    for (const identity of scene.identities.values()) {
      if (isIdentityInactive(identity, now)) {
        disconnectInactiveIdentity(identity);
      }
    }
  }
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
    displayName: identity.displayName,
    color: identity.color,
    readingLabel: identity.readingLabel,
    readingUrl: identity.readingUrl,
    readingActive: identity.readingActive,
  };

  broadcast(scene, message, { exceptConnectionId });
}

function createEphemeralIdentity(scene, fallbackX, connectionId) {
  const key = `connection-${connectionId}`;
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

function getOrCreateIdentity(scene, browserId, browserSecret, fallbackX, connectionId) {
  const key = sanitizeBrowserId(browserId) || `connection-${connectionId}`;
  const existing = scene.identityByBrowser.get(key);
  if (existing) {
    const cleanSecret = sanitizeBrowserSecret(browserSecret);
    if (cleanSecret && cleanSecret === existing.browserSecret) {
      return existing;
    }
    return createEphemeralIdentity(scene, fallbackX, connectionId);
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

function randomBirdSpawnDelay() {
  return BIRD_SPAWN_MIN_MS + Math.floor(Math.random() * (BIRD_SPAWN_MAX_MS - BIRD_SPAWN_MIN_MS + 1));
}

function snapshotBirds(scene) {
  return Array.from(scene.birds.values()).map(({ id, perchId, x, state }) => ({
    id,
    perchId,
    x,
    state,
  }));
}

function sceneHasJoinedClients(scene) {
  for (const client of scene.clients.values()) {
    if (client.joined) return true;
  }
  return false;
}

function occupiedBirdPerchIds(scene) {
  return new Set(Array.from(scene.birds.values(), (bird) => bird.perchId));
}

function pickFreeBirdPerch(scene) {
  const occupied = occupiedBirdPerchIds(scene);
  const free = BIRD_PERCHES.filter((perch) => !occupied.has(perch.id));
  if (free.length === 0) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function broadcastBird(scene, message, options = {}) {
  broadcast(scene, { type: "bird", ...message }, options);
}

function fleeBird(scene, bird, playerX) {
  if (!scene.birds.delete(bird.id)) return;

  const dir = playerX < bird.x ? 1 : -1;
  broadcastBird(scene, {
    action: "flee",
    id: bird.id,
    x: bird.x,
    dir,
    at: Date.now(),
  });
  scene.nextSpawnAt = Date.now() + randomBirdSpawnDelay();
}

function maybeFleeBirds(scene, playerX) {
  for (const bird of scene.birds.values()) {
    if (bird.state !== "perched") continue;
    if (Math.abs(playerX - bird.x) >= BIRD_FLEE_RADIUS) continue;
    fleeBird(scene, bird, playerX);
    return;
  }
}

function spawnBird(scene) {
  if (scene.birds.size >= MAX_BIRDS) return false;

  const perch = pickFreeBirdPerch(scene);
  if (!perch) return false;

  const bird = {
    id: scene.nextBirdId++,
    perchId: perch.id,
    x: perch.x,
    state: "perched",
  };
  scene.birds.set(bird.id, bird);

  const from = perch.x < 0.5 ? "left" : "right";
  broadcastBird(scene, {
    action: "spawn",
    id: bird.id,
    perchId: bird.perchId,
    x: bird.x,
    from,
    at: Date.now(),
  });
  scene.nextSpawnAt = Date.now() + randomBirdSpawnDelay();
  return true;
}

function tickSceneBirds(scene, now) {
  if (!sceneHasJoinedClients(scene)) return;
  if (scene.birds.size >= MAX_BIRDS) return;
  if (now < scene.nextSpawnAt) return;
  spawnBird(scene);
}

function createScene(key) {
  const now = Date.now();
  return {
    key,
    clients: new Map(),
    identities: new Map(),
    identityByBrowser: new Map(),
    nextIdentityId: 1,
    birds: new Map(),
    nextBirdId: 1,
    nextSpawnAt: now + BIRD_FIRST_SPAWN_MS,
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
      ownerBrowserIds: [],
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
      if (!Array.isArray(site.ownerBrowserIds)) {
        site.ownerBrowserIds = [];
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

function touchSite(site) {
  site.updatedAt = Date.now();
  saveSites();
}

function closeIdentityClients(identity, code, reason) {
  for (const client of Array.from(identity.clients)) {
    client.ws.close(code, reason);
  }
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
      x: identity.x,
      pose: identity.pose,
      propId: identity.propId,
      displayName: identity.displayName,
      color: identity.color,
      clientCount: identity.clients.size,
      isOwner: identity.isOwner,
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
});

function handleInit(client, message) {
  if (client.joined) return;

  const nextX = clampPosition(message.x);
  const fallbackX = nextX ?? randomSpawnX();
  const { scene, site } = client;

  if (site && site.blockedBrowserIds.includes(sanitizeBrowserId(message.browserId))) {
    client.ws.close(4003, "blocked");
    return;
  }

  const identity = getOrCreateIdentity(scene, message.browserId, message.browserSecret, fallbackX, client.connectionId);
  clearLeaveTimer(identity);
  const previousReadingLabel = identity.readingLabel;
  const previousReadingUrl = identity.readingUrl;
  const previousReadingActive = identity.readingActive;
  if (Object.hasOwn(message, "readingLabel")) {
    identity.readingLabel = sanitizeReadingLabel(message.readingLabel);
  }
  if (Object.hasOwn(message, "readingUrl")) {
    identity.readingUrl = sanitizeReadingUrl(message.readingUrl);
  }
  client.readingActive = message.readingActive !== false;

  if (!identity.joined) {
    identity.displayName = sanitizeDisplayName(message.displayName);
    identity.color = sanitizeCharacterColor(message.color);
  }

  identity.isOwner = Boolean(site) && site.ownerBrowserIds.includes(identity.browserId);

  client.identity = identity;
  client.joined = true;
  identity.clients.add(client);
  refreshIdentityReadingActive(identity);

  const peers = Array.from(scene.identities.values())
    .filter((peer) => peer.joined && peer.id !== identity.id)
    .map(snapshotIdentity);

  send(client.ws, {
    type: "hello",
    id: identity.id,
    browserSecret: identity.browserSecret,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
    displayName: identity.displayName,
    color: identity.color,
    readingLabel: identity.readingLabel,
    readingUrl: identity.readingUrl,
    readingActive: identity.readingActive,
    isOwner: identity.isOwner,
    messages: identity.messages,
    peers,
    birds: snapshotBirds(scene),
  });

  if (identity.joined) {
    if (
      identity.readingLabel !== previousReadingLabel
      || identity.readingUrl !== previousReadingUrl
      || identity.readingActive !== previousReadingActive
    ) {
      broadcast(scene, {
        type: "reading",
        id: identity.id,
        readingLabel: identity.readingLabel,
        readingUrl: identity.readingUrl,
        readingActive: identity.readingActive,
      }, { exceptConnectionId: client.connectionId });
    }
    syncIdentityAwayState(identity);
    return;
  }

  identity.joined = true;
  const joinedAt = Date.now();
  identity.lastActivityAt = joinedAt;

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
  syncIdentityAwayState(identity, joinedAt);
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
  touchIdentityActivity(client.identity, now);

  emitIdentityState(client.identity, { exceptConnectionId: client.connectionId });
  maybeFleeBirds(client.scene, nextX);
}

function handleAction(client, message) {
  if (!client.identity) return;
  if (message.action !== "jump") return;

  const now = Date.now();
  if (now - client.lastActionAt < ACTION_THROTTLE_MS) return;

  client.lastActionAt = now;
  clearPose(client.identity);
  touchIdentityActivity(client.identity, now);
  broadcast(client.scene, {
    type: "action",
    id: client.identity.id,
    action: "jump",
  }, { exceptConnectionId: client.connectionId });
}

function handleProfile(client, message) {
  if (!client.identity) return;

  client.identity.displayName = sanitizeDisplayName(message.displayName);
  client.identity.color = sanitizeCharacterColor(message.color);
  touchIdentityActivity(client.identity);

  broadcast(client.scene, {
    type: "profile",
    id: client.identity.id,
    displayName: client.identity.displayName,
    color: client.identity.color,
  });
}

function handleReading(client, message) {
  if (!client.identity) return;

  const readingLabel = sanitizeReadingLabel(message.readingLabel);
  const readingUrl = sanitizeReadingUrl(message.readingUrl);
  const readingActive = message.readingActive !== false;
  const previousReadingLabel = client.identity.readingLabel;
  const previousReadingUrl = client.identity.readingUrl;
  const previousReadingActive = client.identity.readingActive;
  if (
    readingLabel === previousReadingLabel
    && readingUrl === previousReadingUrl
    && readingActive === client.readingActive
  ) return;

  client.readingActive = readingActive;
  client.identity.readingLabel = readingLabel;
  client.identity.readingUrl = readingUrl;
  refreshIdentityReadingActive(client.identity);
  const now = Date.now();
  if (client.identity.readingActive && !previousReadingActive) {
    touchIdentityActivity(client.identity, now);
  }
  syncIdentityAwayState(client.identity, now);
  if (
    readingLabel === previousReadingLabel
    && readingUrl === previousReadingUrl
    && client.identity.readingActive === previousReadingActive
  ) return;

  broadcast(client.scene, {
    type: "reading",
    id: client.identity.id,
    readingLabel,
    readingUrl,
    readingActive: client.identity.readingActive,
  });
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
  touchIdentityActivity(identity);

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
  touchIdentityActivity(client.identity, now);

  void sendTelegramChatNotification(client.site, client.identity, text, now);

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
  if (!Object.hasOwn(MESSAGE_HANDLERS, message.type)) return;

  if (message.type !== "init" && !client.joined) return;

  MESSAGE_HANDLERS[message.type](client, message);
}

function handleClientClose(client) {
  if (!client.joined || !client.identity) return;

  const identity = client.identity;
  identity.clients.delete(client);
  client.joined = false;
  client.identity = null;
  client.readingActive = false;

  if (identity.clients.size > 0) {
    if (refreshIdentityReadingActive(identity)) {
      broadcast(identity.scene, {
        type: "reading",
        id: identity.id,
        readingLabel: identity.readingLabel,
        readingUrl: identity.readingUrl,
        readingActive: identity.readingActive,
      });
    }
    syncIdentityAwayState(identity);
    return;
  }

  if (identity.inactiveKick) {
    identity.inactiveKick = false;
    finalizeDisconnect(identity);
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

const birdTimer = setInterval(() => {
  const now = Date.now();
  for (const scene of scenes.values()) {
    tickSceneBirds(scene, now);
  }
}, BIRD_TICK_INTERVAL_MS);

birdTimer.unref?.();

const inactiveTimer = setInterval(() => {
  sweepInactiveIdentities(Date.now());
}, INACTIVE_CHECK_INTERVAL_MS);

inactiveTimer.unref?.();

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
  clearInterval(birdTimer);
  clearInterval(inactiveTimer);
});

async function startServer() {
  const { PROPS } = await import("./public/scene-props.mjs");
  PROPS_BY_ID = new Map(PROPS.map((prop) => [prop.id, prop]));

  const birdPerches = await import("./public/bird-perches.mjs");
  BIRD_PERCHES = birdPerches.BIRD_PERCHES;

  const shared = await import("./public/shared-constants.mjs");
  MIN_X = shared.MIN_X;
  MAX_X = shared.MAX_X;
  MAX_MESSAGE_LEN = shared.MESSAGE_MAX;
  MAX_DISPLAY_NAME_LEN = shared.DISPLAY_NAME_MAX;
  MAX_READING_LABEL_LEN = shared.READING_LABEL_MAX;
  MAX_RECENT_MESSAGES = shared.MAX_RECENT_MESSAGES;
  DEFAULT_CHARACTER_COLOR = shared.DEFAULT_CHARACTER_COLOR;
  CHARACTER_COLORS = new Set(shared.CHARACTER_COLORS);

  server.listen(PORT, HOST, () => {
    console.log(`TownSquare server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(`Failed to start TownSquare server: ${error.message}`);
  process.exit(1);
});
