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
const LANDING_ORIGIN = parseHttpOrigin(process.env.LANDING_ORIGIN);
const PLAUSIBLE_DOMAIN = String(process.env.PLAUSIBLE_DOMAIN || "").trim();
const PLAUSIBLE_UPSTREAM = String(process.env.PLAUSIBLE_UPSTREAM || "https://plausible.io").replace(/\/$/, "");
const PLAUSIBLE_SCRIPT_SRC = String(process.env.PLAUSIBLE_SCRIPT_SRC || "/js/script.js").trim();
const PLAUSIBLE_API_PATH = process.env.PLAUSIBLE_API_PATH === undefined
  ? "/api/event"
  : String(process.env.PLAUSIBLE_API_PATH).trim();
const PLAUSIBLE_HTML_PAGES = new Set([
  "/hosted/register.html",
]);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const MAP_WORLD_FILE = path.join(DATA_DIR, "map-world.json");
const DEFAULT_MAP_WORLD_FILE = path.join(PUBLIC_DIR, "default-map-world.json");
let ALLOWED_ORIGINS = new Set();
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
const MAX_EMAIL_LEN = 254;
const MAX_ORIGIN_LEN = 240;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
const BIRD_FLEE_RADIUS = 0.07;
const VALID_ACTIONS = new Set(["jump", "raise-hand", "high-five"]);
const BIRD_SPAWN_MIN_MS = Number(process.env.BIRD_SPAWN_MIN_MS || 12000);
const BIRD_SPAWN_MAX_MS = Number(process.env.BIRD_SPAWN_MAX_MS || 22000);
const BIRD_FIRST_SPAWN_MS = Number(process.env.BIRD_FIRST_SPAWN_MS || 500);

// Wire-protocol limits and the character palette, shared with the widget.
// Populated from public/shared/shared-constants.mjs in startServer (the server is
// CommonJS, so the shared ES module is loaded via dynamic import).
let MIN_X;
let MAX_X;
let MAX_MESSAGE_LEN;
let MAX_DISPLAY_NAME_LEN;
let MAX_READING_LABEL_LEN;
let MAX_RECENT_MESSAGES;
let HIGH_FIVE_DISTANCE;
let DEFAULT_CHARACTER_COLOR;
let DEFAULT_OWNER_BADGE_COLOR;
/** @type {Set<string>} */
let CHARACTER_COLORS = new Set();
/** @type {Set<string>} */
let OWNER_BADGE_COLORS = new Set();
/** @type {() => number} */
let randomSpawnX;

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

function parseHttpOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

/** @type {Map<string, import("./public/shared/scene-props.mjs").SceneProp>} */
let PROPS_BY_ID = new Map();
/** @type {Array<import("./public/shared/bird-perches.mjs").BirdPerch>} */
let BIRD_PERCHES = [];
let DEFAULT_SITE_SCENE_CONFIG = { benches: 2, trees: 1, lamps: 1, birds: 3 };
let DEFAULT_SITE_STYLE = {
  light: { scene: "#e4e2dd", page: "#efede9", surface: "#fdf8f4", ink: "#2a2926", accent: "#c8641f", other: "#26241f", ground: "rgba(42, 41, 38, 0.16)" },
  dark: { scene: "#242521", page: "#181917", surface: "#24231f", ink: "#f2eee6", accent: "#df8a43", other: "#ddd7cc", ground: "rgba(242, 238, 230, 0.18)" },
};
let sanitizeSceneConfig = (config) => ({ ...DEFAULT_SITE_SCENE_CONFIG, ...(config || {}) });
let sanitizeConnections = (connections) => (Array.isArray(connections) ? connections : []);
let sanitizeSiteStyle = (style) => (style && (style.light || style.dark) ? style : { ...DEFAULT_SITE_STYLE, light: { ...DEFAULT_SITE_STYLE.light, ...(style || {}) } });
let buildSceneProps = () => [];
let buildBirdPerches = () => [];
let buildSiteCss = () => "";
/** @type {(prop: import("./public/shared/site-config.mjs").SceneProp, x: number) => boolean} */
let isWithinPropSettleZone = () => false;
let validateMapWorld;
let mapWorld;
let normalizeOrigin;

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
  sceneConfig: handleSceneConfig,
  settle: handleSettle,
  say: handleSay,
  typing: handleTyping,
};

/** @returns {{connectionId:number,ws:any,scene:any,site:any,origin:string,propsById:Map<string, any>,identity:any,joined:boolean,readingActive:boolean,typing:boolean,lastMoveAt:number,lastActionAt:number,lastChatAt:number}} */
function createClient(connectionId, ws, scene, site, origin = "") {
  return {
    connectionId,
    ws,
    scene,
    site,
    origin,
    propsById: scene.propsById,
    identity: null,
    joined: false,
    readingActive: false,
    lastMoveAt: 0,
    lastActionAt: 0,
    lastChatAt: 0,
    typing: false,
  };
}

function syncClientSceneProps(client, message) {
  if (client.site) {
    client.propsById = client.scene.propsById;
    return;
  }

  const config = isPlainObject(message.sceneConfig) ? message.sceneConfig : DEFAULT_SITE_SCENE_CONFIG;
  const props = buildSceneProps(sanitizeSceneConfig(config));
  client.propsById = new Map(props.map((prop) => [prop.id, prop]));
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

function parseReadingUrl(readingUrl) {
  const sanitized = sanitizeReadingUrl(readingUrl);
  if (!sanitized) return null;
  try {
    return new URL(sanitized);
  } catch {
    return null;
  }
}

function labelFromReadingUrl(url) {
  const segment = url.pathname.split("/").filter(Boolean).pop() || "";
  if (!segment) return sanitizeReadingLabel(url.hostname.replace(/^www\./, ""));

  try {
    return sanitizeReadingLabel(decodeURIComponent(segment)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " "));
  } catch {
    return sanitizeReadingLabel(segment.replace(/[-_]+/g, " "));
  }
}

function readingUrlAllowedForClient(client, url) {
  const urlOrigin = normalizeOrigin(url.origin);
  if (!urlOrigin) return false;
  if (client.site) return urlOrigin === client.site.origin;
  return !client.origin || urlOrigin === client.origin;
}

function sanitizeReadingState(client, message, fallback = {}) {
  const hasReadingUrl = Object.hasOwn(message, "readingUrl");
  const readingUrl = hasReadingUrl ? parseReadingUrl(message.readingUrl) : parseReadingUrl(fallback.readingUrl || "");
  if (!readingUrl || !readingUrlAllowedForClient(client, readingUrl)) {
    return { readingLabel: "", readingUrl: "" };
  }

  return {
    readingLabel: labelFromReadingUrl(readingUrl),
    readingUrl: readingUrl.href,
  };
}

function sanitizeCharacterColor(color) {
  return CHARACTER_COLORS.has(color) ? color : DEFAULT_CHARACTER_COLOR;
}

function sanitizeOwnerBadgeColor(color) {
  return OWNER_BADGE_COLORS.has(color) ? color : DEFAULT_OWNER_BADGE_COLOR;
}

/**
 * A site owner's name/color is "claimed" alongside their ownership so it
 * survives client-side profile resets and server restarts. Profiles are keyed
 * by browserId and live on the site record next to `ownerBrowserIds`.
 */
function getOwnerProfile(site, browserId) {
  if (!site || !isPlainObject(site.ownerProfiles)) return null;
  const profile = site.ownerProfiles[browserId];
  return isPlainObject(profile) ? profile : null;
}

/** Persist the current name/color for an owner so it re-applies on rejoin. */
function rememberOwnerProfile(site, identity) {
  if (!site || !identity || !identity.isOwner) return;
  if (!isPlainObject(site.ownerProfiles)) site.ownerProfiles = {};
  const current = getOwnerProfile(site, identity.browserId) || {};
  site.ownerProfiles[identity.browserId] = {
    displayName: identity.displayName,
    color: identity.color,
    badgeColor: sanitizeOwnerBadgeColor(current.badgeColor || identity.badgeColor),
  };
  touchSite(site);
}

/** Re-apply a stored owner profile onto an identity, if one exists. */
function applyOwnerProfile(site, identity) {
  const profile = getOwnerProfile(site, identity.browserId);
  if (!profile) return;
  identity.displayName = sanitizeDisplayName(profile.displayName);
  identity.color = sanitizeCharacterColor(profile.color);
  identity.badgeColor = sanitizeOwnerBadgeColor(profile.badgeColor);
}

/**
 * Opaque, stable reference for an owner used by the admin "Site owner" editor.
 * Lets the admin manage owners without the raw browserId ever leaving the
 * server (kept consistent with the visitor payload, which omits browserId too).
 */
function ownerHandle(siteKey, browserId) {
  return crypto.createHash("sha256").update(`${siteKey}:${browserId}`).digest("hex").slice(0, 16);
}

/** The site's owners with their persisted look, for the dedicated admin section. */
function getOwners(site, scene) {
  if (!site || !Array.isArray(site.ownerBrowserIds)) return [];
  return site.ownerBrowserIds.map((browserId) => {
    const profile = getOwnerProfile(site, browserId) || {};
    const identity = scene ? scene.identityByBrowser.get(browserId) : null;
    return {
      handle: ownerHandle(site.siteKey, browserId),
      displayName: typeof profile.displayName === "string" ? profile.displayName : "",
      color: sanitizeCharacterColor(profile.color),
      badgeColor: sanitizeOwnerBadgeColor(profile.badgeColor),
      online: Boolean(identity && identity.clients && identity.clients.size > 0),
    };
  });
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

function parseOptionalEmail(email) {
  const clean = typeof email === "string" ? email.trim().slice(0, MAX_EMAIL_LEN) : "";
  if (!clean) return { ok: true, email: null };
  if (!EMAIL_RE.test(clean)) return { ok: false, email: null };
  return { ok: true, email: clean };
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

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plausibleScriptPath() {
  if (!PLAUSIBLE_SCRIPT_SRC.startsWith("/")) return null;
  return PLAUSIBLE_SCRIPT_SRC.split("?")[0];
}

function getPublicRelativePath(filePath) {
  return `/${path.relative(PUBLIC_DIR, filePath).split(path.sep).join("/")}`;
}

function shouldInjectPlausible(filePath) {
  if (!PLAUSIBLE_DOMAIN) return false;
  return PLAUSIBLE_HTML_PAGES.has(getPublicRelativePath(filePath));
}

function buildPlausibleSnippet() {
  const attrs = [
    "defer",
    `data-domain="${escapeHtmlAttr(PLAUSIBLE_DOMAIN)}"`,
    `src="${escapeHtmlAttr(PLAUSIBLE_SCRIPT_SRC)}"`,
  ];
  if (PLAUSIBLE_API_PATH) {
    attrs.splice(2, 0, `data-api="${escapeHtmlAttr(PLAUSIBLE_API_PATH)}"`);
  }
  return `<script ${attrs.join(" ")}></script>`;
}

function injectPlausibleIntoHtml(html) {
  const snippet = buildPlausibleSnippet();
  const headClose = html.indexOf("</head>");
  if (headClose === -1) return html;
  return `${html.slice(0, headClose)}    ${snippet}\n  ${html.slice(headClose)}`;
}

async function proxyPlausibleScript(req, res) {
  try {
    const response = await fetch(`${PLAUSIBLE_UPSTREAM}/js/script.js`, {
      headers: { "user-agent": req.headers["user-agent"] || "TownSquare" },
    });
    if (!response.ok) {
      res.writeHead(response.status, { "content-type": "text/plain; charset=utf-8" });
      res.end("upstream error");
      return;
    }

    res.writeHead(200, {
      "content-type": response.headers.get("content-type") || "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=86400, immutable",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.warn(`Plausible script proxy failed: ${error.message}`);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad gateway");
  }
}

function proxyPlausibleEvent(req, res) {
  const chunks = [];

  req.on("data", (chunk) => {
    chunks.push(chunk);
    if (chunks.reduce((size, part) => size + part.length, 0) > 4096) {
      res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
      res.end("payload too large");
      req.destroy();
    }
  });

  req.on("end", () => {
    void forwardPlausibleEvent(req, res, Buffer.concat(chunks));
  });
}

async function forwardPlausibleEvent(req, res, body) {
  try {
    const response = await fetch(`${PLAUSIBLE_UPSTREAM}/api/event`, {
      method: "POST",
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
        "user-agent": req.headers["user-agent"] || "",
        "x-forwarded-for": getRequestIp(req),
      },
      body,
    });

    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.warn(`Plausible event proxy failed: ${error.message}`);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("bad gateway");
  }
}

function resolvePublicFile(requestUrl, hostHeader) {
  const url = new URL(requestUrl, `http://${hostHeader}`);
  const aliases = new Map([
    ["/register", "/hosted/register.html"],
    ["/admin", "/hosted/admin.html"],
    ["/admin/chat", "/hosted/chat.html"],
    ["/service-admin", "/hosted/service-admin.html"],
    ["/map", "/map.html"],
    ["/dev", "/dev/dev.html"],
    ["/walk-sandbox", "/dev/walk-sandbox.html"],
  ]);
  const pathname = aliases.get(url.pathname) || url.pathname;
  const normalized = path.normalize(pathname).replace(/^\.+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

function readJsonBody(req, res, callback, maxBytes = 4096) {
  let raw = "";

  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > maxBytes) {
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

function getSceneConfig(site) {
  return sanitizeSceneConfig(site?.sceneConfig || DEFAULT_SITE_SCENE_CONFIG);
}

function getStyleConfig(site) {
  return sanitizeSiteStyle(site?.styleConfig || DEFAULT_SITE_STYLE);
}

function getConnections(site) {
  return sanitizeConnections(site?.connections || []);
}

function getSceneProps(site) {
  return site ? buildSceneProps(getSceneConfig(site)) : Array.from(PROPS_BY_ID.values());
}

function getSceneBirdPerches(site) {
  return site ? buildBirdPerches(getSceneProps(site)) : BIRD_PERCHES;
}

function buildStyleSnippet(site) {
  return buildSiteCss(getStyleConfig(site));
}

function buildEmbedSnippet(req, site) {
  const serverOrigin = getPublicOrigin(req);
  const connections = getConnections(site);
  const connectionsLine = connections.length > 0
    ? `\n    connections: ${JSON.stringify(connections)},`
    : "";

  return `<link rel="stylesheet" href="${serverOrigin}/widget.css" />
<div id="townsquare-root"></div>
<script type="module">
  import { mountTownSquare } from "${serverOrigin}/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "${serverOrigin}",
    siteKey: "${site.siteKey}",
    scene: ${JSON.stringify(getSceneConfig(site))},${connectionsLine}
    theme: "host"
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

    const parsedEmail = parseOptionalEmail(body.email);
    if (!parsedEmail.ok) {
      sendJson(res, 400, { error: "Enter a valid email address, or leave the field empty." });
      return;
    }

    const { site, adminToken } = createSiteRecord({
      name: body.name,
      origin,
      email: parsedEmail.email,
      sceneConfig: body.sceneConfig,
      styleConfig: body.styleConfig,
      connections: body.connections,
    });
    sitesByKey.set(site.siteKey, site);
    saveSites();

    sendJson(res, 201, {
      site: publicSite(site),
      adminToken,
      adminUrl: buildAdminUrl(req, adminToken),
      embedSnippet: buildEmbedSnippet(req, site),
      styleSnippet: buildStyleSnippet(site),
    });
  });
}

function publicMapSite(site) {
  const scene = scenes.get(site.siteKey);
  return {
    siteKey: site.siteKey,
    name: site.name,
    origin: site.origin,
    verifiedAt: site.verifiedAt,
    lastSeenAt: site.lastSeenAt,
    messageCount: site.messageCount || 0,
    activeVisitors: scene ? countActiveVisitors(scene) : 0,
    connections: getConnections(site),
  };
}

function handleMap(req, res) {
  const sites = Array.from(sitesByKey.values())
    .filter((site) => site.verifiedAt && !site.disabled)
    .map(publicMapSite);

  sendJson(res, 200, { sites, world: mapWorld });
}

function loadMapWorld() {
  const readWorld = (filePath) => validateMapWorld(JSON.parse(fs.readFileSync(filePath, "utf8")));
  try {
    const saved = readWorld(MAP_WORLD_FILE);
    if (saved.ok) return saved.world;
    console.warn(`Ignoring invalid saved map world: ${saved.error}`);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Could not load saved map world: ${error.message}`);
  }

  const fallback = readWorld(DEFAULT_MAP_WORLD_FILE);
  if (!fallback.ok) throw new Error(`Invalid default map world: ${fallback.error}`);
  return fallback.world;
}

function saveMapWorld(nextWorld) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${MAP_WORLD_FILE}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(nextWorld, null, 2)}\n`);
  fs.renameSync(tmpFile, MAP_WORLD_FILE);
  mapWorld = nextWorld;
}

function sendAdminSite(req, res, site, adminToken) {
  if (!site) {
    sendJson(res, 403, { error: "Invalid site key or admin token." });
    return;
  }

  const scene = getScene(site.siteKey, site);
  sendJson(res, 200, {
    site: publicSite(site),
    adminUrl: buildAdminUrl(req, adminToken),
    embedSnippet: buildEmbedSnippet(req, site),
    styleSnippet: buildStyleSnippet(site),
    scene: getSceneStats(scene),
    owners: getOwners(site, scene),
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
  updateCustomization(site, scene, body) {
    site.sceneConfig = sanitizeSceneConfig(body.sceneConfig);
    site.styleConfig = sanitizeSiteStyle(body.styleConfig);
    touchSite(site);

    if (scene.clients.size === 0) {
      scenes.delete(site.siteKey);
      return;
    }

    rebuildSceneProps(scene, site);
  },
  updateConnections(site, scene, body) {
    site.connections = sanitizeConnections(body.connections);
    touchSite(site);
  },
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
    if (owner) {
      // Apply any admin-customised look first so a broadcast/crown never
      // clobbers a saved ownerProfiles entry with a stale in-memory name.
      applyOwnerProfile(site, identity);
      identity.badgeColor = sanitizeOwnerBadgeColor(identity.badgeColor);
      // Seed the saved profile from whatever name/color they have now so the
      // claim "keeps" their current look until it is customised.
      rememberOwnerProfile(site, identity);
    } else if (isPlainObject(site.ownerProfiles)) {
      delete site.ownerProfiles[identity.browserId];
    }
    touchSite(site);
    broadcast(scene, {
      type: "profile",
      id: identity.id,
      displayName: identity.displayName,
      color: identity.color,
      badgeColor: identity.badgeColor,
      isOwner: owner,
    });
  },
  updateOwnerProfile(site, scene, body) {
    // Keyed by the opaque owner handle so the dedicated admin section can edit
    // an owner's saved look whether or not they are currently connected.
    const handle = String(body.handle || "");
    const browserId = site.ownerBrowserIds.find((id) => ownerHandle(site.siteKey, id) === handle);
    if (!browserId) return;
    if (!isPlainObject(site.ownerProfiles)) site.ownerProfiles = {};
    const current = isPlainObject(site.ownerProfiles[browserId]) ? site.ownerProfiles[browserId] : {};
    const next = { ...current };
    if (Object.hasOwn(body, "displayName")) next.displayName = sanitizeDisplayName(body.displayName);
    if (Object.hasOwn(body, "color")) next.color = sanitizeCharacterColor(body.color);
    if (Object.hasOwn(body, "badgeColor")) next.badgeColor = sanitizeOwnerBadgeColor(body.badgeColor);
    site.ownerProfiles[browserId] = next;
    touchSite(site);
    // Apply live and broadcast if that owner is connected right now.
    const identity = scene.identityByBrowser.get(browserId);
    if (identity) {
      applyOwnerProfile(site, identity);
      broadcast(scene, {
        type: "profile",
        id: identity.id,
        displayName: identity.displayName,
        color: identity.color,
        badgeColor: identity.badgeColor,
        isOwner: true,
      });
    }
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

    const scene = getScene(site.siteKey, site);
    ADMIN_ACTIONS[action](site, scene, body);
    sendJson(res, 200, { site: publicSite(site), scene: getSceneStats(scene), owners: getOwners(site, scene) });
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

  return {
    ...publicSite(site),
    updatedAt: site.updatedAt,
    activeVisitors: scene ? countActiveVisitors(scene) : 0,
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

function handleServiceAdminMap(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isServiceAdminAuthorized(req, body, res)) return;
    sendJson(res, 200, { world: mapWorld });
  });
}

function handleServiceAdminMapSave(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isServiceAdminAuthorized(req, body, res)) return;
    const result = validateMapWorld(body.world);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    try {
      saveMapWorld(result.world);
      sendJson(res, 200, { world: mapWorld });
    } catch (error) {
      console.warn(`Could not save map world: ${error.message}`);
      sendJson(res, 500, { error: "Could not save the map." });
    }
  }, 524288);
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

function serializeIdentity(identity, options = {}) {
  const {
    reading = false,
    owner = false,
    messages = false,
    clientCount = false,
    badge = false,
  } = options;
  const serialized = {
    id: identity.id,
    x: identity.x,
    pose: identity.pose,
    propId: identity.propId,
    displayName: identity.displayName,
    color: identity.color,
  };
  if (clientCount) {
    serialized.clientCount = identity.clients.size;
  }
  if (reading) {
    serialized.readingLabel = identity.readingLabel;
    serialized.readingUrl = identity.readingUrl;
    serialized.readingActive = identity.readingActive;
  }
  if (owner) {
    serialized.isOwner = identity.isOwner;
  }
  if (badge && identity.isOwner) {
    serialized.badgeColor = identity.badgeColor;
  }
  if (messages) {
    serialized.messages = identity.messages;
  }
  return serialized;
}

function snapshotIdentity(identity) {
  return serializeIdentity(identity, { reading: true, owner: true, messages: true, badge: true });
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

function broadcastReading(scene, identity, options = {}) {
  const {
    exceptConnectionId = null,
    readingLabel = identity.readingLabel,
    readingUrl = identity.readingUrl,
    readingActive = identity.readingActive,
  } = options;
  broadcast(scene, {
    type: "reading",
    id: identity.id,
    readingLabel,
    readingUrl,
    readingActive,
  }, { exceptConnectionId });
}

function emitIdentityState(identity, options = {}) {
  broadcast(identity.scene, {
    type: "move",
    ...serializeIdentity(identity, { reading: true }),
  }, { exceptConnectionId: options.exceptConnectionId ?? null });
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
  const free = scene.birdPerches.filter((perch) => !occupied.has(perch.id));
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
  if (scene.birds.size >= scene.maxBirds) return false;

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
  if (scene.birds.size >= scene.maxBirds) return;
  if (now < scene.nextSpawnAt) return;
  spawnBird(scene);
}

function createScene(key, site = null) {
  const now = Date.now();
  const config = getSceneConfig(site);
  const props = getSceneProps(site);
  return {
    key,
    props,
    propsById: new Map(props.map((prop) => [prop.id, prop])),
    birdPerches: getSceneBirdPerches(site),
    maxBirds: config.birds,
    clients: new Map(),
    identities: new Map(),
    identityByBrowser: new Map(),
    nextIdentityId: 1,
    birds: new Map(),
    nextBirdId: 1,
    nextSpawnAt: now + BIRD_FIRST_SPAWN_MS,
  };
}

/**
 * Rebuild a live scene's props from the site's current config without dropping
 * connected visitors. Used after a customization change so edits take effect
 * immediately instead of waiting for the scene to empty and be recreated.
 *
 * @param {ReturnType<typeof createScene>} scene
 * @param {ReturnType<typeof createSiteRecord> | null} site
 */
function rebuildSceneProps(scene, site) {
  const config = getSceneConfig(site);
  const props = getSceneProps(site);
  const propsById = new Map(props.map((prop) => [prop.id, prop]));

  scene.props = props;
  scene.propsById = propsById;
  scene.birdPerches = getSceneBirdPerches(site);
  scene.maxBirds = config.birds;

  // Hosted clients arbitrate settle requests against the scene's prop map.
  for (const client of scene.clients.values()) {
    if (client.site) client.propsById = propsById;
  }

  // Stand up anyone whose seat no longer exists or whose prop moved out from
  // under them, so seated poses stay consistent with the new scene.
  for (const identity of scene.identities.values()) {
    if (!identity.pose || !identity.propId) continue;
    const prop = propsById.get(identity.propId);
    if (prop?.pose && isWithinPropSettleZone(prop, identity.x)) continue;
    clearPose(identity);
    if (identity.joined) emitIdentityState(identity);
  }
}

function createSiteRecord({ name, origin, email, sceneConfig, styleConfig, connections }) {
  const now = Date.now();
  const adminToken = createToken("admin", 24);
  return {
    adminToken,
    site: {
      siteKey: createToken("site", 12),
      adminTokenHash: hashAdminToken(adminToken),
      name: sanitizeSiteName(name, origin),
      origin,
      email: email || null,
      sceneConfig: sanitizeSceneConfig(sceneConfig),
      styleConfig: sanitizeSiteStyle(styleConfig),
      connections: sanitizeConnections(connections),
      disabled: false,
      chatDisabled: false,
      verifiedAt: null,
      lastSeenAt: null,
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
      blockedBrowserIds: [],
      ownerBrowserIds: [],
      ownerProfiles: {},
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
      if (!isPlainObject(site.ownerProfiles)) {
        site.ownerProfiles = {};
      }
      if (!Array.isArray(site.connections)) {
        site.connections = [];
      }
      if (typeof site.messageCount !== "number") {
        site.messageCount = 0;
      }
      if (site.lastMessageAt === undefined) {
        site.lastMessageAt = null;
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
  // Atomic write: serialize to a temp file in the same directory, then rename
  // over SITES_FILE. rename(2) is atomic on the same filesystem, so a crash or
  // disk-full mid-write leaves the previous valid sites.json intact (it holds
  // every site's adminTokenHash, and there is no admin-link recovery).
  const tmpFile = `${SITES_FILE}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify({ sites }, null, 2)}\n`);
  fs.renameSync(tmpFile, SITES_FILE);
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
    email: site.email || null,
    sceneConfig: getSceneConfig(site),
    styleConfig: getStyleConfig(site),
    connections: getConnections(site),
    disabled: site.disabled,
    chatDisabled: site.chatDisabled,
    verifiedAt: site.verifiedAt,
    lastSeenAt: site.lastSeenAt,
    messageCount: site.messageCount || 0,
    lastMessageAt: site.lastMessageAt || null,
    createdAt: site.createdAt,
    blockedCount: site.blockedBrowserIds.length,
  };
}

function getScene(sceneKey, site = null) {
  const existing = scenes.get(sceneKey);
  if (existing) return existing;

  const scene = createScene(sceneKey, site);
  scenes.set(sceneKey, scene);
  return scene;
}

function getSceneStats(scene) {
  const visitors = Array.from(scene.identities.values())
    .filter((identity) => identity.joined)
    .map((identity) => serializeIdentity(identity, { owner: true, messages: true, clientCount: true }));

  return { activeVisitors: visitors.length, visitors };
}

function countActiveVisitors(scene) {
  let count = 0;
  for (const identity of scene.identities.values()) {
    if (identity.joined) count += 1;
  }
  return count;
}

function validateSiteAccess(reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const siteKey = url.searchParams.get("siteKey") || "";
  if (!siteKey) {
    return { ok: true, scene: getScene("default", null), site: null };
  }

  const site = sitesByKey.get(siteKey);
  if (!site || site.disabled) {
    return { ok: false, status: 403, reason: "site disabled or unknown" };
  }

  return { ok: true, scene: getScene(site.siteKey, site), site };
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

  if (["GET", "HEAD"].includes(req.method) && ["/", "/docs", "/changelog"].includes(url.pathname)) {
    if (LANDING_ORIGIN) {
      res.writeHead(302, { location: `${LANDING_ORIGIN}${url.pathname}${url.search}` });
      res.end();
    } else {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : "not found");
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/map") {
    handleMap(req, res);
    return;
  }

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

  if (req.method === "POST" && url.pathname === "/api/service-admin/map") {
    handleServiceAdminMap(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/service-admin/map/save") {
    handleServiceAdminMapSave(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/service-admin/action") {
    handleServiceAdminAction(req, res);
    return;
  }

  if (PLAUSIBLE_DOMAIN) {
    const scriptPath = plausibleScriptPath();
    if (scriptPath && req.method === "GET" && url.pathname === scriptPath) {
      void proxyPlausibleScript(req, res);
      return;
    }

    if (PLAUSIBLE_API_PATH && req.method === "POST" && url.pathname === PLAUSIBLE_API_PATH) {
      proxyPlausibleEvent(req, res);
      return;
    }
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

    let body = data;
    if (path.extname(filePath) === ".html" && shouldInjectPlausible(filePath)) {
      body = Buffer.from(injectPlausibleIntoHtml(data.toString("utf8")), "utf8");
    }

    res.writeHead(200, getStaticHeaders(filePath));
    res.end(body);
  });
});

const wss = new WebSocketServer({
  server,
  path: "/live",
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

function handleInit(client, message) {
  if (client.joined) return;

  syncClientSceneProps(client, message);

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
  if (Object.hasOwn(message, "readingUrl")) {
    const reading = sanitizeReadingState(client, message);
    identity.readingLabel = reading.readingLabel;
    identity.readingUrl = reading.readingUrl;
  }
  client.readingActive = message.readingActive !== false;

  if (!identity.joined) {
    identity.displayName = sanitizeDisplayName(message.displayName);
    identity.color = sanitizeCharacterColor(message.color);
  }

  identity.isOwner = Boolean(site) && site.ownerBrowserIds.includes(identity.browserId);

  // An owner's saved name/color is sticky: re-apply it on every (re)join so it
  // survives client-side profile resets and server restarts.
  if (identity.isOwner) {
    applyOwnerProfile(site, identity);
    identity.badgeColor = sanitizeOwnerBadgeColor(identity.badgeColor);
  }

  client.identity = identity;
  client.joined = true;
  identity.clients.add(client);
  refreshIdentityReadingActive(identity);

  const peers = Array.from(scene.identities.values())
    .filter((peer) => peer.joined && peer.id !== identity.id)
    .map(snapshotIdentity);

  const self = serializeIdentity(identity, { reading: true, owner: true, messages: true, badge: true });
  const { id, ...selfFields } = self;

  send(client.ws, {
    type: "hello",
    id,
    browserSecret: identity.browserSecret,
    ...selfFields,
    peers,
    birds: snapshotBirds(scene),
  });

  if (identity.joined) {
    if (
      identity.readingLabel !== previousReadingLabel
      || identity.readingUrl !== previousReadingUrl
      || identity.readingActive !== previousReadingActive
    ) {
      broadcastReading(scene, identity, { exceptConnectionId: client.connectionId });
    }
    // Reconnect during the grace window: the owner gets applyOwnerProfile above
    // but we skip the join broadcast, so refresh peers with the claimed look.
    if (identity.isOwner && site) {
      broadcast(scene, {
        type: "profile",
        id: identity.id,
        displayName: identity.displayName,
        color: identity.color,
        badgeColor: identity.badgeColor,
        isOwner: true,
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
  if (!VALID_ACTIONS.has(message.action)) return;

  const now = Date.now();
  if (now - client.lastActionAt < ACTION_THROTTLE_MS) return;

  let targetId = null;
  if (message.action === "high-five") {
    targetId = Number(message.targetId);
    const target = Number.isInteger(targetId) ? client.scene.identities.get(targetId) : null;
    if (!target || !target.joined || target.id === client.identity.id) return;
    if (Math.abs(target.x - client.identity.x) > HIGH_FIVE_DISTANCE) return;
  }

  client.lastActionAt = now;
  clearPose(client.identity);
  touchIdentityActivity(client.identity, now);
  const action = {
    type: "action",
    id: client.identity.id,
    action: message.action,
  };
  if (targetId !== null) action.targetId = targetId;
  broadcast(client.scene, action, { exceptConnectionId: client.connectionId });
}

function handleProfile(client, message) {
  if (!client.identity) return;

  client.identity.displayName = sanitizeDisplayName(message.displayName);
  client.identity.color = sanitizeCharacterColor(message.color);
  touchIdentityActivity(client.identity);
  // Owners keep their look across resets: persist their own edits too.
  rememberOwnerProfile(client.site, client.identity);

  broadcast(client.scene, {
    type: "profile",
    id: client.identity.id,
    displayName: client.identity.displayName,
    color: client.identity.color,
  });
}

function handleReading(client, message) {
  if (!client.identity) return;

  const reading = sanitizeReadingState(client, message, client.identity);
  const { readingLabel, readingUrl } = reading;
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

  broadcastReading(client.scene, client.identity, { readingLabel, readingUrl });
}

function handleSceneConfig(client, message) {
  if (client.site) return;
  syncClientSceneProps(client, message);
}

function handleSettle(client, message) {
  if (!client.identity) return;
  const prop = client.propsById.get(message.propId);
  if (!prop?.pose) return;

  const identity = client.identity;
  if (!isWithinPropSettleZone(prop, identity.x)) return;

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

  if (client.site) {
    const lastSavedMessageAt = client.site.lastMessageAt || 0;
    client.site.messageCount = (client.site.messageCount || 0) + 1;
    client.site.lastMessageAt = now;
    if (now - lastSavedMessageAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      saveSites();
    }
  }

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

function handleTyping(client, message) {
  if (!client.identity || typeof message.typing !== "boolean") return;

  const wasTyping = Array.from(client.identity.clients).some((candidate) => candidate.typing);
  client.typing = message.typing;
  const typing = Array.from(client.identity.clients).some((candidate) => candidate.typing);
  if (typing === wasTyping) return;

  broadcast(client.scene, { type: "typing", id: client.identity.id, typing });
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
  const wasTyping = Array.from(identity.clients).some((candidate) => candidate.typing);
  identity.clients.delete(client);
  client.joined = false;
  client.identity = null;
  client.readingActive = false;
  if (wasTyping && !Array.from(identity.clients).some((candidate) => candidate.typing)) {
    broadcast(identity.scene, { type: "typing", id: identity.id, typing: false });
  }

  if (identity.clients.size > 0) {
    if (refreshIdentityReadingActive(identity)) {
      broadcastReading(identity.scene, identity);
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

  const origin = normalizeOrigin(req.headers.origin || "");
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

  const client = createClient(nextConnectionId++, ws, access.scene, access.site, origin || "");
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
  await loadSharedModules();

  const shared = await import("./public/shared/shared-constants.mjs");
  MIN_X = shared.MIN_X;
  MAX_X = shared.MAX_X;
  MAX_MESSAGE_LEN = shared.MESSAGE_MAX;
  MAX_DISPLAY_NAME_LEN = shared.DISPLAY_NAME_MAX;
  MAX_READING_LABEL_LEN = shared.READING_LABEL_MAX;
  MAX_RECENT_MESSAGES = shared.MAX_RECENT_MESSAGES;
  HIGH_FIVE_DISTANCE = shared.HIGH_FIVE_DISTANCE;
  DEFAULT_CHARACTER_COLOR = shared.DEFAULT_CHARACTER_COLOR;
  DEFAULT_OWNER_BADGE_COLOR = shared.DEFAULT_OWNER_BADGE_COLOR;
  CHARACTER_COLORS = new Set(shared.CHARACTER_COLORS);
  OWNER_BADGE_COLORS = new Set(shared.OWNER_BADGE_COLORS);
  randomSpawnX = shared.randomSpawnX;

  server.listen(PORT, HOST, () => {
    console.log(`TownSquare server running at http://${HOST}:${PORT}`);
  });
}

async function loadSharedModules() {
  const [siteConfig, scenePropsModule, birdPerchesModule, geometry, mapWorldModule, urlModule] = await Promise.all([
    import("./public/shared/site-config.mjs"),
    import("./public/shared/scene-props.mjs"),
    import("./public/shared/bird-perches.mjs"),
    import("./public/shared/scene-prop-geometry.mjs"),
    import("./public/shared/map-world.mjs"),
    import("./public/shared/url.mjs"),
  ]);

  DEFAULT_SITE_SCENE_CONFIG = siteConfig.DEFAULT_SCENE_CONFIG;
  DEFAULT_SITE_STYLE = siteConfig.DEFAULT_SITE_STYLE;
  sanitizeSceneConfig = siteConfig.sanitizeSceneConfig;
  sanitizeConnections = siteConfig.sanitizeConnections;
  sanitizeSiteStyle = siteConfig.sanitizeSiteStyle;
  buildSceneProps = siteConfig.buildSceneProps;
  buildBirdPerches = siteConfig.buildBirdPerches;
  buildSiteCss = siteConfig.buildSiteCss;
  isWithinPropSettleZone = geometry.isWithinPropSettleZone;
  validateMapWorld = mapWorldModule.validateMapWorld;
  normalizeOrigin = urlModule.normalizeAbsoluteOrigin;
  ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");
  mapWorld = loadMapWorld();

  PROPS_BY_ID = new Map(scenePropsModule.PROPS.map((prop) => [prop.id, prop]));
  BIRD_PERCHES = birdPerchesModule.BIRD_PERCHES;
}

startServer().catch((error) => {
  console.error(`Failed to start TownSquare server: ${error.message}`);
  process.exit(1);
});
