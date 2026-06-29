const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { ensurePluginData, getPluginData, setPluginData } = require("./server/plugin-data");
const { plugins } = require("./server/plugins");
const { atomicWriteJson } = require("./server/atomic-write");
const { createVisitorStats } = require("./server/visitor-stats");
const { registerPublicPlugins } = require("./plugins");
const { createToken, hashAdminToken, tokensMatch, adminTokenMatches } = require("./server/auth-tokens");
const { createAdminSessionStore, parseCookies } = require("./server/admin-sessions");
const { createPlausibleProxy } = require("./server/plausible");
const { createStaticFiles } = require("./server/static-files");
const { makeBucketStore } = require("./server/rate-limit");
const { createSitesWriter } = require("./server/sites-store");
const {
  clampPosition,
  sanitizeBrowserId,
  sanitizeBrowserSecret,
  sanitizeBlockedWords,
  parseOptionalEmail,
} = require("./server/sanitize");

// Browser admin sessions: a valid token login mints one of these and the id is
// returned in an HttpOnly cookie, so the raw token is not persisted in JS.
const adminSessions = createAdminSessionStore();

loadEnvFile();
// Defense-in-depth: registration is already isolated per-plugin, but never let
// a registration failure prevent the server process from starting.
try {
  registerPublicPlugins();
} catch (error) {
  console.error("Plugin registration failed; continuing without plugins", error);
}

// Optional plugin injection: TOWNSQUARE_EXTRA_PLUGINS is a comma/space-separated
// list of module paths that self-register via registerPlugin on require. Used by
// the plugin smoke test and by private plugin bundles loaded at deploy time.
for (const entry of String(process.env.TOWNSQUARE_EXTRA_PLUGINS || "").split(/[,\s]+/).filter(Boolean)) {
  try {
    require(path.resolve(entry));
  } catch (error) {
    console.error(`Failed to load extra plugin '${entry}'`, error);
  }
}

/**
 * Tiny demo server for the first playable TownSquare slice.
 *
 * Responsibilities:
 * - serve widget, hosted admin, map, and development assets from ./public
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
const LANDING_ORIGIN = parseHttpOrigin(process.env.LANDING_ORIGIN);
const PLAUSIBLE_DOMAIN = String(process.env.PLAUSIBLE_DOMAIN || "").trim();
const PLAUSIBLE_UPSTREAM = String(process.env.PLAUSIBLE_UPSTREAM || "https://plausible.io").replace(/\/$/, "");
const PLAUSIBLE_SCRIPT_SRC = String(process.env.PLAUSIBLE_SCRIPT_SRC || "/js/script.js").trim();
const PLAUSIBLE_API_PATH = process.env.PLAUSIBLE_API_PATH === undefined
  ? "/api/event"
  : String(process.env.PLAUSIBLE_API_PATH).trim();
const PUBLIC_DIR = path.join(__dirname, "public");
// Optional overlay of extra static assets (e.g. private plugin browser modules)
// served as a fallback after the core public dir. Replaces the dev symlink.
const PLUGIN_ASSETS_DIR = process.env.TOWNSQUARE_PLUGIN_ASSETS_DIR
  ? path.resolve(process.env.TOWNSQUARE_PLUGIN_ASSETS_DIR)
  : null;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const DEV_TOOLS_ENABLED = envFlag("ENABLE_DEV_TOOLS");
const STAGING_PAGE_ENABLED = envFlag("ENABLE_STAGING_PAGE");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const MAP_WORLD_FILE = path.join(DATA_DIR, "map-world.json");
const VISITOR_STATS_FILE = path.join(DATA_DIR, "visitor-stats.json");
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
const MAX_SITE_CONNECTION_LIMIT = 1000;
const DEFAULT_CONNECTION_LIMIT = Math.min(MAX_SITE_CONNECTION_LIMIT, Math.max(1, readLimit("MAX_CONNECTIONS", 100)));
const MAX_WS_PAYLOAD_BYTES = Number(process.env.MAX_WS_PAYLOAD_BYTES || 512);
const MAX_READING_URL_LEN = 240;
const MAX_SITE_NAME_LEN = 80;
const MAX_ORIGIN_LEN = 240;
const MAX_PAGE_URL_LEN = 512;
const REGISTRATIONS_PER_HOUR = Number(process.env.REGISTRATIONS_PER_HOUR || 20);
const AUTH_FAILURES_PER_HOUR = Number(process.env.AUTH_FAILURES_PER_HOUR || 30);
const IP_MAX_IDENTITIES = readLimit("IP_MAX_IDENTITIES", 2);
const IP_JOIN_LIMIT = readLimit("IP_JOIN_LIMIT", 30);
const IP_STATE_EVENT_LIMIT = readLimit("IP_STATE_EVENT_LIMIT", 600);
const IP_CHAT_EVENT_LIMIT = readLimit("IP_CHAT_EVENT_LIMIT", 20);
// Behavioral flood ban: count rename + chat actions per IP over a rolling
// window. Crossing FLOOD_BAN_LIMIT is non-human (the abuse bot renames several
// times a second), so the IP is persistently blocked — but only when
// FLOOD_BAN_ENFORCE is set. Unset (default) is dry-run: it logs `flood_detect`
// with the rate it *would* ban and changes nothing, so the threshold can be
// validated against real traffic before it can act. Owners are exempt.
const FLOOD_BAN_LIMIT = readLimit("FLOOD_BAN_LIMIT", 30);
const FLOOD_BAN_WINDOW_MS = readLimit("FLOOD_BAN_WINDOW_MS", 10000);
const FLOOD_BAN_ENFORCE = process.env.FLOOD_BAN_ENFORCE === "1";
const IP_SYNC_ACTION_ROUNDS = readLimit("IP_SYNC_ACTION_ROUNDS", 3);
const IP_SYNC_ACTION_WINDOW_MS = readLimit("IP_SYNC_ACTION_WINDOW_MS", 10000);
const IP_SYNC_ACTION_TOLERANCE_MS = readLimit("IP_SYNC_ACTION_TOLERANCE_MS", 250);
const IP_QUARANTINE_MS = readLimit("IP_QUARANTINE_MS", 10 * 60 * 1000);
// Hard cap on the per-(scene, IP) activity map so a flood of distinct keys
// (including spoofed x-real-ip behind a proxy) can't grow it without bound.
const MAX_IP_ACTIVITY_ENTRIES = readLimit("MAX_IP_ACTIVITY_ENTRIES", 50000);
const IP_JOIN_WINDOW_MS = 60 * 1000;
const IP_EVENT_WINDOW_MS = 10 * 1000;
const LAST_SEEN_SAVE_INTERVAL_MS = 60000;
const MOVE_THROTTLE_MS = 40;
const ACTION_THROTTLE_MS = 560;
const DEFAULT_CHAT_THROTTLE_MS = 500;
const MAX_CHAT_THROTTLE_MS = 30000;
const MAX_MODERATION_LOG = 50;
const RECONNECT_GRACE_MS = 1500;
const INACTIVE_DISCONNECT_MS = Number(process.env.INACTIVE_DISCONNECT_MS || 30 * 60 * 1000);
const INACTIVE_CHECK_INTERVAL_MS = Number(process.env.INACTIVE_CHECK_INTERVAL_MS || 60000);
const HEARTBEAT_INTERVAL_MS = 30000;
const BIRD_TICK_INTERVAL_MS = 1000;
// Minimum delay between a visitor joining and their first chat message. A human
// cannot read the widget and type within this window, so faster messages are the
// scripted enter-say-leave pattern and are dropped. 0 disables the check.
const MIN_HUMAN_SAY_MS = readLimit("MIN_HUMAN_SAY_MS", 1500);
// Proof-of-work difficulty (leading zero bits) for the per-site bot-protection
// gate. Sent to the widget in the challenge, so it is tunable without shipping a
// new widget. Higher costs the client more CPU per join.
const POW_DIFFICULTY_BITS = readLimit("POW_DIFFICULTY_BITS", 15);
// Emit one structured JSON line per new visitor join (name, IP, a stable
// per-site browser fingerprint, origin, PoW status) so abuse can be diagnosed
// from server logs. On by default; set LOG_JOINS=0 to silence.
const LOG_JOINS = process.env.LOG_JOINS !== "0";
const BIRD_FLEE_RADIUS = 0.07;
const VALID_ACTIONS = new Set(["jump", "raise-hand", "high-five"]);
const BIRD_SPAWN_MIN_MS = Number(process.env.BIRD_SPAWN_MIN_MS || 12000);
const BIRD_SPAWN_MAX_MS = Number(process.env.BIRD_SPAWN_MAX_MS || 22000);
const BIRD_FIRST_SPAWN_MS = Number(process.env.BIRD_FIRST_SPAWN_MS || 500);

// Wire-protocol limits and the character palette, shared with the widget.
// Populated from public/shared/shared-constants.mjs in startServer (the server is
// CommonJS, so the shared ES module is loaded via dynamic import).
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

function envFlag(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

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
// Shared realtime protocol vocabulary, assigned from protocol.mjs in
// loadSharedModules() before the server starts listening.
let MSG;
let GESTURE;
let BIRD_ACTION;
// Assigned synchronously from site-config-core.mjs once loadSharedModules()
// resolves — before server.listen(), so requests never see them unset. (No
// stub re-implementations: those were a second, divergent source of truth.)
let DEFAULT_SITE_SCENE_CONFIG;
let DEFAULT_SITE_STYLE;
let sanitizeSceneConfig;
let sanitizeConnections;
let sanitizeMessageBoard;
let sanitizeSiteStyle;
let buildSceneProps;
let buildBirdPerches;
let buildSiteCss;
/** @type {(prop: import("./public/shared/site-config-core.mjs").SceneProp, x: number) => boolean} */
let isWithinPropSettleZone = () => false;
let validateMapWorld;
/** @type {(storedWorld: object, siteCount: number) => object} */
let resolveMapWorld = (storedWorld) => storedWorld;
let mapWorld;
let normalizeOrigin;
let buildAllowedOrigins = (origin) => (origin ? [origin] : []);
let getMatchingWwwOrigin = () => null;

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
  solve: handleSolve,
  typing: handleTyping,
};

/** @returns {{connectionId:number,ws:any,scene:any,site:any,origin:string,ip:string,propsById:Map<string, any>,identity:any,joined:boolean,spectator:boolean,readingActive:boolean,typing:boolean,lastMoveAt:number,lastActionAt:number,lastChatAt:number}} */
function createClient(connectionId, ws, scene, site, origin = "", ip = "unknown", spectator = false) {
  return {
    connectionId,
    ws,
    scene,
    site,
    origin,
    ip,
    propsById: scene.propsById,
    identity: null,
    joined: false,
    // Read-only livestream overlay: receives broadcasts but never joins as an
    // identity, so it isn't counted or shown to real visitors.
    spectator,
    readingActive: false,
    lastMoveAt: 0,
    lastActionAt: 0,
    lastChatAt: 0,
    typing: false,
    challenge: null,
    powVerified: false,
    pendingInit: null,
  };
}

// Count the leading zero bits of a hash buffer, used to grade proof-of-work.
function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

// Issue a fresh per-connection proof-of-work challenge. The salt is random so a
// solution cannot be precomputed or replayed across connections.
function issuePowChallenge(client) {
  const salt = crypto.randomBytes(16).toString("hex");
  client.challenge = { salt, difficulty: POW_DIFFICULTY_BITS };
  send(client.ws, { type: MSG.CHALLENGE, salt, difficulty: POW_DIFFICULTY_BITS });
}

function verifyPow(challenge, nonce) {
  if (!challenge || typeof nonce !== "string" || nonce.length === 0 || nonce.length > 64) return false;
  const hash = crypto.createHash("sha256").update(`${challenge.salt}:${nonce}`).digest();
  return leadingZeroBits(hash) >= challenge.difficulty;
}

function handleSolve(client, message) {
  if (client.powVerified || !client.challenge) return;
  if (!verifyPow(client.challenge, message.nonce)) {
    client.ws.close(1008, "challenge failed");
    return;
  }
  client.powVerified = true;
  client.challenge = null;
  const pending = client.pendingInit;
  client.pendingInit = null;
  if (pending) handleInit(client, pending);
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
    joinedAt: 0,
    awaySince: null,
    messages: [],
  };
}

function sanitizeMessage(text) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_MESSAGE_LEN);
}

/** Per-site slow-mode cooldown, clamped to a sane range; falls back to default. */
function sanitizeChatThrottle(input) {
  const ms = Number(input);
  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_CHAT_THROTTLE_MS;
  return Math.min(Math.round(ms), MAX_CHAT_THROTTLE_MS);
}

/** Per-site concurrent WebSocket cap, persisted on each site record. */
function sanitizeConnectionLimit(input) {
  const limit = Number(input);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_CONNECTION_LIMIT;
  return Math.min(Math.round(limit), MAX_SITE_CONNECTION_LIMIT);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mask any forbidden word in `text` with asterisks. Whole-word and
 * case-insensitive so innocent substrings (the Scunthorpe problem) survive.
 * Returns the text unchanged when the site has no word list.
 */
function applyWordFilter(text, words) {
  if (!text || !Array.isArray(words) || words.length === 0) return text;
  let filtered = text;
  for (const word of words) {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    filtered = filtered.replace(pattern, (match) => "*".repeat(match.length));
  }
  return filtered;
}

/** Names are visible to everyone, so they run through the same word filter. */
function filterDisplayName(site, name) {
  return site ? applyWordFilter(name, site.blockedWords) : name;
}

/**
 * The verified owner badge is a 👑 the server renders next to a name only when
 * it has stamped `isOwner` on that identity. A visitor could otherwise fake the
 * badge by simply typing a crown (or a crown-like confusable) into their own
 * name. Strip those glyphs from every display name so the crown stays a signal
 * the server alone can grant. Covers the crown emoji plus the obvious royalty /
 * chess-king/queen lookalikes; ordinary letters are untouched.
 */
const OWNER_BADGE_LOOKALIKES = /[\u{1F451}\u{1F934}\u{1F478}\u{1FAC5}♔♕♚♛]/gu;

function stripOwnerBadgeLookalikes(text) {
  return text.replace(OWNER_BADGE_LOOKALIKES, "");
}

function sanitizeDisplayName(displayName) {
  if (typeof displayName !== "string") return "";
  return stripOwnerBadgeLookalikes(displayName)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_DISPLAY_NAME_LEN);
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
  if (client.site) return isOriginAllowedForSite(urlOrigin, client.site);
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

// One structured line per genuine new join, for diagnosing bot/abuse patterns
// from server logs. The browser fingerprint is the same per-site hash the admin
// editor uses (ownerHandle), so a bot reusing its browserId shows a stable `fp`
// across joins; a rotating one shows a fresh `fp` each time. Raw browserId never
// leaves the server.
function logJoin(client, identity) {
  if (!LOG_JOINS) return;
  const site = client.site;
  console.log(JSON.stringify({
    event: "join",
    at: new Date().toISOString(),
    site: site ? site.siteKey : null,
    scene: client.scene.key,
    name: identity.displayName,
    ip: client.ip,
    fp: site ? ownerHandle(site.siteKey, identity.browserId) : null,
    origin: client.origin || null,
    powVerified: Boolean(client.powVerified),
    botProtection: Boolean(site && site.botProtection),
  }));
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

function sendJson(res, status, body, extraHeaders = null) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(extraHeaders || {}),
  });
  res.end(JSON.stringify(body));
}

function sendPublicJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
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

function getSceneConfig(site) {
  return sanitizeSceneConfig(site?.sceneConfig || DEFAULT_SITE_SCENE_CONFIG);
}

function getStyleConfig(site) {
  return sanitizeSiteStyle(site?.styleConfig || DEFAULT_SITE_STYLE);
}

function getConnections(site) {
  return sanitizeConnections(site?.connections || []);
}

function getMessageBoard(site) {
  return sanitizeMessageBoard(site?.messageBoard || {});
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

function getAllowedOrigins(site) {
  if (!site) return [];
  const origins = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeOrigin(value || "");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    origins.push(normalized);
  };

  add(site.origin);
  if (Array.isArray(site.allowedOrigins)) {
    site.allowedOrigins.forEach(add);
  }
  return origins;
}

function siteUsesMatchingWwwOrigin(site) {
  if (!site) return false;
  const matching = getMatchingWwwOrigin(site.origin);
  return Boolean(matching && getAllowedOrigins(site).includes(matching));
}

function parseSiteOriginSettings(body, { defaultIncludeMatchingWww = true } = {}) {
  const origin = normalizeOrigin(String(body.origin || "").slice(0, MAX_ORIGIN_LEN));
  if (!origin) {
    return { error: "Enter a valid website origin, like https://example.com." };
  }

  const includeMatchingWww = body.includeMatchingWww === undefined
    ? defaultIncludeMatchingWww
    : Boolean(body.includeMatchingWww);
  return {
    origin,
    allowedOrigins: buildAllowedOrigins(origin, { includeMatchingWww }),
    includeMatchingWww,
  };
}

function buildEmbedSnippet(req, site) {
  const serverOrigin = getPublicOrigin(req);
  const pluginModules = plugins.browserModules("widget", pluginContext(site));
  // Scene, connections, and the message board are delivered live over the socket
  // (see the `hello` payload), not baked here, so this snippet is install-once:
  // owners paste it a single time and manage everything else from the dashboard.
  // Power users can still pin any of those fields inline to take them off live
  // management (see README → Customization).
  const coreConfig = {
    serverOrigin,
    siteKey: site.siteKey,
    ...(pluginModules.length > 0 ? { pluginModules } : {}),
    theme: "host",
  };
  const extendedConfig = plugins.extend("extendWidgetConfig", coreConfig, pluginContext(site));
  const widgetConfig = isPlainObject(extendedConfig) ? extendedConfig : coreConfig;
  const configLines = Object.entries(widgetConfig)
    .filter(([key]) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key))
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
    .join(",\n");

  // `preconnect` warms the DNS/TLS handshake to the widget origin before the
  // module import fires, shaving a round trip off a cross-origin embed. `async`
  // on the module lets it run the moment it arrives instead of waiting in the
  // defer queue, so the widget never delays the host page's own work.
  return `<link rel="preconnect" href="${serverOrigin}" crossorigin />
<link rel="stylesheet" href="${serverOrigin}/widget.css" />
<div id="townsquare-root"></div>
<script type="module" async>
  import { mountTownSquare } from "${serverOrigin}/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
${configLines}
  });
</script>`;
}

function buildAdminUrl(req, adminToken) {
  const serverOrigin = getPublicOrigin(req);
  const url = new URL("/admin", `${serverOrigin}/`);
  url.hash = new URLSearchParams({ adminToken }).toString();
  return url.toString();
}

// Cookies are only marked Secure over https, otherwise the browser would drop
// them on plain-http local dev.
function requestIsSecure(req) {
  return getPublicOrigin(req).startsWith("https://");
}

function buildSessionCookie(id, maxAgeMs, secure) {
  const attrs = [
    `${adminSessions.cookieName}=${id}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/admin",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function clearSessionCookie(secure) {
  const attrs = [
    `${adminSessions.cookieName}=`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/admin",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function readSessionFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return adminSessions.get(cookies[adminSessions.cookieName]);
}

/**
 * Authenticate an admin request, preferring an HttpOnly session cookie over the
 * bootstrap token in the body. On a successful token bootstrap a fresh session
 * is minted and a Set-Cookie header is returned so the raw token is not needed
 * (nor resent) again.
 *
 * @returns {{ site: any, tokenPresented: boolean, setCookie: string|null }|null}
 */
function resolveAdminRequest(req, body) {
  const requestedKey = String(body.siteKey || "");
  const token = String(body.adminToken || "").trim();

  // 1) Existing session cookie. The cookie's site must match an explicitly
  //    requested siteKey so a session can't be aimed at another site.
  const session = readSessionFromCookie(req);
  if (session) {
    const site = sitesByKey.get(session.siteKey);
    if (site && (!requestedKey || requestedKey === session.siteKey)) {
      return { site, tokenPresented: token.length > 0, setCookie: null };
    }
  }

  // 2) Bootstrap token in the body. Mint a session cookie on success.
  if (token) {
    const site = getAdminSiteByCredentials(requestedKey, token);
    if (site) {
      const created = adminSessions.create(site.siteKey, { remember: Boolean(body.rememberMe) });
      return {
        site,
        tokenPresented: true,
        setCookie: buildSessionCookie(created.id, created.maxAgeMs, requestIsSecure(req)),
      };
    }
  }

  return null;
}

const registrationsByIp = makeBucketStore();
const adminAuthFailuresByIp = makeBucketStore();
const serviceAdminAuthFailuresByIp = makeBucketStore();
const activityByIpAndScene = new Map();

function getRequestIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  const fromLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const proxyIp = fromLoopback ? String(req.headers["x-real-ip"] || "").trim() : "";
  return proxyIp && !/[\s,]/.test(proxyIp) ? proxyIp.slice(0, 64) : remote;
}

function getIpActivity(scene, ip, now = Date.now()) {
  const key = `${scene.key}\0${ip}`;
  let activity = activityByIpAndScene.get(key);
  if (!activity) {
    if (activityByIpAndScene.size >= MAX_IP_ACTIVITY_ENTRIES) {
      enforceIpActivityCap(now);
    }
    activity = { lastSeenAt: now, budgets: new Map() };
    activityByIpAndScene.set(key, activity);
  }
  activity.lastSeenAt = now;
  return activity;
}

// Bound activityByIpAndScene so a flood of distinct (scene, spoofed-IP) keys —
// including quarantined ones, which pruneIpActivity deliberately keeps — can't
// grow it without limit. Drop stale entries first, then, if still at the cap,
// evict the least-recently-seen entries (preferring un-quarantined ones) down
// to 90% in a single batch so this stays amortized cheap per insert.
function enforceIpActivityCap(now = Date.now()) {
  pruneIpActivity(now);
  const target = Math.floor(MAX_IP_ACTIVITY_ENTRIES * 0.9);
  if (activityByIpAndScene.size <= target) return;

  const byAge = Array.from(activityByIpAndScene.entries())
    .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (const [key, activity] of byAge) {
    if (activityByIpAndScene.size <= target) break;
    if ((activity.quarantinedUntil || 0) > now) continue;
    activityByIpAndScene.delete(key);
  }
  for (const [key] of byAge) {
    if (activityByIpAndScene.size <= target) break;
    activityByIpAndScene.delete(key);
  }
}

function consumeIpBudget(client, type, limit, windowMs, now = Date.now()) {
  if (limit <= 0) return true;

  const activity = getIpActivity(client.scene, client.ip, now);
  let budget = activity.budgets.get(type);
  if (!budget || now - budget.startedAt >= windowMs) {
    budget = { startedAt: now, count: 0 };
    activity.budgets.set(type, budget);
  }

  if (budget.count >= limit) return false;
  budget.count += 1;
  return true;
}

function pruneIpActivity(now = Date.now()) {
  const cutoff = now - Math.max(IP_JOIN_WINDOW_MS, IP_EVENT_WINDOW_MS) * 2;
  for (const [key, activity] of activityByIpAndScene) {
    if (activity.lastSeenAt < cutoff && (activity.quarantinedUntil || 0) <= now) {
      activityByIpAndScene.delete(key);
    }
  }
}

function closeRateLimited(client) {
  client.ws.close(1008, "rate limited");
}

function allowIpEvent(client, type, limit) {
  if (consumeIpBudget(client, type, limit, IP_EVENT_WINDOW_MS)) return true;
  closeRateLimited(client);
  return false;
}

// Behavioral flood detector: tally rename/chat actions per IP in a rolling
// window. A human cannot rename or message dozens of times in 10s; the abuse bot
// does. On crossing the threshold we persistently block the IP (reusing
// blockedIps enforcement) and kick every connection on it. In dry-run
// (FLOOD_BAN_ENFORCE unset) it only logs what it *would* ban. Returns true when
// the caller's action should be dropped (i.e. the IP was just banned).
function registerFloodAction(client, now = Date.now()) {
  if (FLOOD_BAN_LIMIT <= 0 || !client.site) return false;
  if (client.identity?.isOwner) return false; // never auto-ban a verified owner

  const activity = getIpActivity(client.scene, client.ip, now);
  let flood = activity.flood;
  if (!flood || now - flood.startedAt >= FLOOD_BAN_WINDOW_MS) {
    flood = { startedAt: now, count: 0, flagged: false };
    activity.flood = flood;
  }
  flood.count += 1;
  if (flood.count < FLOOD_BAN_LIMIT || flood.flagged) return false;

  // Threshold crossed: log once per window either way (audit + dry-run signal).
  flood.flagged = true;
  console.log(JSON.stringify({
    event: "flood_detect",
    at: new Date(now).toISOString(),
    enforce: FLOOD_BAN_ENFORCE,
    site: client.site.siteKey,
    ip: client.ip,
    count: flood.count,
    windowMs: FLOOD_BAN_WINDOW_MS,
    name: client.identity?.displayName || "",
  }));

  if (!FLOOD_BAN_ENFORCE) return false; // dry-run: detect only

  if (!Array.isArray(client.site.blockedIps)) client.site.blockedIps = [];
  if (client.ip && client.ip !== "unknown" && !client.site.blockedIps.includes(client.ip)) {
    client.site.blockedIps.push(client.ip);
    logModeration(client.site, "auto-block-ip", client.ip);
    touchSite(client.site);
  }
  // Kick every live connection from this IP in the scene, not just this one.
  for (const peer of client.scene.clients.values()) {
    if (peer.ip === client.ip && peer.ws.readyState === peer.ws.OPEN) {
      peer.ws.close(4003, "blocked");
    }
  }
  return true;
}

function isIpQuarantined(scene, ip, now = Date.now()) {
  const activity = activityByIpAndScene.get(`${scene.key}\0${ip}`);
  return Boolean(activity && activity.quarantinedUntil > now);
}

function quarantineIp(client, action, rounds, now = Date.now()) {
  const activity = getIpActivity(client.scene, client.ip, now);
  activity.quarantinedUntil = now + IP_QUARANTINE_MS;
  console.warn(JSON.stringify({
    event: "ip_quarantine",
    ip: client.ip,
    scene: client.scene.key,
    reason: `synchronized ${action}`,
    rounds,
    until: new Date(activity.quarantinedUntil).toISOString(),
  }));

  for (const candidate of client.scene.clients.values()) {
    if (candidate.ip === client.ip && candidate.ws.readyState === candidate.ws.OPEN) {
      closeRateLimited(candidate);
    }
  }
}

function allowSynchronizedAction(client, action, now = Date.now()) {
  if (
    IP_SYNC_ACTION_ROUNDS <= 0
    || IP_SYNC_ACTION_WINDOW_MS <= 0
    || IP_SYNC_ACTION_TOLERANCE_MS <= 0
    || IP_QUARANTINE_MS <= 0
  ) return true;

  const activity = getIpActivity(client.scene, client.ip, now);
  if (activity.quarantinedUntil > now) {
    closeRateLimited(client);
    return false;
  }

  activity.actions ||= new Map();
  let signal = activity.actions.get(action);
  if (!signal) {
    signal = { events: [], rounds: [], lastRoundAt: 0 };
    activity.actions.set(action, signal);
  }

  signal.events = signal.events.filter((event) => now - event.at <= IP_SYNC_ACTION_TOLERANCE_MS);
  const synchronized = signal.events.some((event) => event.identityId !== client.identity.id);
  signal.events.push({ at: now, identityId: client.identity.id });
  if (!synchronized || now - signal.lastRoundAt <= IP_SYNC_ACTION_TOLERANCE_MS) return true;

  signal.lastRoundAt = now;
  signal.rounds = signal.rounds.filter((at) => now - at <= IP_SYNC_ACTION_WINDOW_MS);
  signal.rounds.push(now);
  if (signal.rounds.length < IP_SYNC_ACTION_ROUNDS) return true;

  quarantineIp(client, action, signal.rounds.length, now);
  return false;
}

function reusableIdentity(scene, message) {
  const key = sanitizeBrowserId(message.browserId);
  if (!key) return null;
  const identity = scene.identityByBrowser.get(key);
  const secret = sanitizeBrowserSecret(message.browserSecret);
  return identity && secret && secret === identity.browserSecret ? identity : null;
}

function countIpIdentities(scene, ip) {
  const ids = new Set();
  for (const client of scene.clients.values()) {
    if (client.joined && client.identity && client.ip === ip) ids.add(client.identity.id);
  }
  return ids.size;
}

function allowIdentityInit(client, message) {
  if (isIpQuarantined(client.scene, client.ip)) {
    closeRateLimited(client);
    return false;
  }

  const identity = reusableIdentity(client.scene, message);
  const alreadyCounted = identity && Array.from(identity.clients).some((candidate) => candidate.ip === client.ip);
  if (!alreadyCounted && IP_MAX_IDENTITIES > 0 && countIpIdentities(client.scene, client.ip) >= IP_MAX_IDENTITIES) {
    closeRateLimited(client);
    return false;
  }

  if ((!identity || !identity.joined) && !consumeIpBudget(client, "join", IP_JOIN_LIMIT, IP_JOIN_WINDOW_MS)) {
    closeRateLimited(client);
    return false;
  }
  return true;
}

function isRegistrationAllowed(ip) {
  return registrationsByIp.take(ip, REGISTRATIONS_PER_HOUR);
}

function isAuthAttemptAllowed(store, ip) {
  return store.under(ip, AUTH_FAILURES_PER_HOUR);
}

function recordAuthFailure(store, ip) {
  store.record(ip, AUTH_FAILURES_PER_HOUR);
}

function clearAuthFailures(store, ip) {
  store.clear(ip);
}

function sendAuthThrottled(res) {
  sendJson(res, 429, { error: "Too many failed sign-in attempts. Try again later." });
}

// Per-IP hourly budget for the first-party Plausible event relay, so it can't
// be abused to amplify traffic at the upstream using this server's address.
const plausibleEventsByIp = makeBucketStore();
const PLAUSIBLE_EVENTS_PER_HOUR = readLimit("PLAUSIBLE_EVENTS_PER_HOUR", 600);
function isPlausibleEventAllowed(ip) {
  return plausibleEventsByIp.take(ip, PLAUSIBLE_EVENTS_PER_HOUR);
}

const plausible = createPlausibleProxy({
  domain: PLAUSIBLE_DOMAIN,
  upstream: PLAUSIBLE_UPSTREAM,
  scriptSrc: PLAUSIBLE_SCRIPT_SRC,
  apiPath: PLAUSIBLE_API_PATH,
  getRequestIp,
  isEventAllowed: isPlausibleEventAllowed,
});

const staticFiles = createStaticFiles({
  publicDir: PUBLIC_DIR,
  pluginAssetsDir: PLUGIN_ASSETS_DIR,
  devToolsEnabled: DEV_TOOLS_ENABLED,
  stagingPageEnabled: STAGING_PAGE_ENABLED,
  shouldInjectHtml: (filePath) => plausible.shouldInject(filePath),
  injectHtml: (html) => plausible.injectIntoHtml(html),
});

function handleRegisterSite(req, res) {
  readJsonBody(req, res, (body) => {
    if (!isRegistrationAllowed(getRequestIp(req))) {
      sendJson(res, 429, { error: "Too many registrations from this address. Try again later." });
      return;
    }

    const originSettings = parseSiteOriginSettings(body, { defaultIncludeMatchingWww: true });
    if (originSettings.error) {
      sendJson(res, 400, { error: originSettings.error });
      return;
    }

    const parsedEmail = parseOptionalEmail(body.email);
    if (!parsedEmail.ok) {
      sendJson(res, 400, { error: "Enter a valid email address, or leave the field empty." });
      return;
    }

    const { site, adminToken } = createSiteRecord({
      name: body.name,
      origin: originSettings.origin,
      allowedOrigins: originSettings.allowedOrigins,
      email: parsedEmail.email,
      sceneConfig: body.sceneConfig,
      styleConfig: body.styleConfig,
      connections: body.connections,
      messageBoard: body.messageBoard,
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
    supporter: Boolean(site.supporter),
  };
}

function countVerifiedMapSites() {
  let count = 0;
  for (const site of sitesByKey.values()) {
    if (site.verifiedAt && !site.disabled) count += 1;
  }
  return count;
}

function resolvedMapWorld() {
  return resolveMapWorld(mapWorld, countVerifiedMapSites());
}

function ensureMapWorldGrown(siteCount = countVerifiedMapSites()) {
  const resolved = resolveMapWorld(mapWorld, siteCount);
  if (resolved.width <= mapWorld.width && resolved.height <= mapWorld.height) return;
  saveMapWorld({
    ...mapWorld,
    width: resolved.width,
    height: resolved.height,
  });
}

function handleMap(req, res) {
  const sites = Array.from(sitesByKey.values())
    .filter((site) => site.verifiedAt && !site.disabled)
    .map(publicMapSite);

  const coreMap = { sites, world: resolvedMapWorld() };
  const extendedMap = plugins.extend("extendMapData", coreMap);
  sendJson(res, 200, isPlainObject(extendedMap) ? extendedMap : coreMap);
}

function getPublicStats() {
  let registered = 0;
  let verified = 0;
  let messages = 0;

  for (const site of sitesByKey.values()) {
    registered += 1;
    if (site.verifiedAt) verified += 1;
    messages += site.messageCount || 0;
  }

  return { registered, verified, messages };
}

function handleStats(_req, res) {
  sendPublicJson(res, 200, getPublicStats());
}

/**
 * Public, read-only presence count for one site's town square, used by the
 * lightweight "N people here" counter widget. Reads the live scene count
 * ({@link countActiveVisitors}) without opening a socket or creating an
 * identity, so a page that only shows the counter never inflates the number
 * or spawns a ghost avatar for visitors in the square. A missing `siteKey`
 * reads the shared default (self-hosted) scene; an unknown or disabled site
 * returns 404 so the counter can hide itself.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function handleSitePresence(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const siteKey = url.searchParams.get("siteKey") || "";

  if (!siteKey) {
    const scene = scenes.get("default");
    sendPublicJson(res, 200, { activeVisitors: scene ? countActiveVisitors(scene) : 0 });
    return;
  }

  const site = sitesByKey.get(siteKey);
  if (!site || site.disabled) {
    sendPublicJson(res, 404, { error: "unknown site" });
    return;
  }

  const scene = scenes.get(site.siteKey);
  sendPublicJson(res, 200, { activeVisitors: scene ? countActiveVisitors(scene) : 0 });
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
  atomicWriteJson(MAP_WORLD_FILE, nextWorld);
  mapWorld = nextWorld;
}

function sendAdminSite(req, res, site, adminToken, setCookie = null) {
  if (!site) {
    sendJson(res, 403, { error: "Invalid site key or admin token." });
    return;
  }

  const scene = getScene(site.siteKey, site);
  const panel = {
    site: publicSite(site),
    // The recovery link embeds the raw token, so only surface it on a request
    // that actually presented it (login/bootstrap), never on cookie-auth polls.
    ...(adminToken ? { adminUrl: buildAdminUrl(req, adminToken) } : {}),
    embedSnippet: buildEmbedSnippet(req, site),
    styleSnippet: buildStyleSnippet(site),
    scene: getSceneStats(scene, site),
    owners: getOwners(site, scene),
  };
  sendJson(res, 200, extendAdminPanel(panel, site), setCookie ? { "set-cookie": setCookie } : null);
}

function extendAdminPanel(panel, site) {
  const sitePlugins = describeSitePlugins(site);
  const withPlugins = sitePlugins.length > 0 ? { ...panel, plugins: sitePlugins } : panel;
  const pluginModules = plugins.browserModules("admin", pluginContext(site));
  const corePanel = pluginModules.length > 0 ? { ...withPlugins, pluginModules } : withPlugins;
  const extended = plugins.extend("extendAdminPanel", corePanel, pluginContext(site));
  return isPlainObject(extended) ? extended : corePanel;
}

function handlePostAdminSite(req, res) {
  readJsonBody(req, res, (body) => {
    const ip = getRequestIp(req);
    if (!isAuthAttemptAllowed(adminAuthFailuresByIp, ip)) {
      sendAuthThrottled(res);
      return;
    }

    const presentedToken = String(body.adminToken || "").trim();
    const resolved = resolveAdminRequest(req, body);
    if (!resolved) {
      // Only count a token brute-force attempt; an expired/absent cookie alone
      // is a benign re-auth, not a failed credential guess.
      if (presentedToken) recordAuthFailure(adminAuthFailuresByIp, ip);
      sendAdminSite(req, res, null, presentedToken);
      return;
    }

    if (resolved.tokenPresented) clearAuthFailures(adminAuthFailuresByIp, ip);
    sendAdminSite(req, res, resolved.site, presentedToken, resolved.setCookie);
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
    // Mint a session so subsequent admin requests authenticate via the HttpOnly
    // cookie and never need to resend the raw token.
    const created = adminSessions.create(site.siteKey, { remember: Boolean(body.rememberMe) });
    sendJson(res, 200, {
      site: publicSite(site),
      adminUrl: buildAdminUrl(req, adminToken),
    }, { "set-cookie": buildSessionCookie(created.id, created.maxAgeMs, requestIsSecure(req)) });
  });
}

function handleAdminLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[adminSessions.cookieName];
  if (sessionId) adminSessions.destroy(sessionId);
  sendJson(res, 200, { ok: true }, { "set-cookie": clearSessionCookie(requestIsSecure(req)) });
}

const ADMIN_ACTIONS = {
  updateSiteDetails(site, scene, body) {
    const originSettings = parseSiteOriginSettings(body, {
      defaultIncludeMatchingWww: siteUsesMatchingWwwOrigin(site),
    });
    if (originSettings.error) {
      return { error: originSettings.error };
    }

    const parsedEmail = parseOptionalEmail(body.email);
    if (!parsedEmail.ok) {
      return { error: "Enter a valid email address, or leave the field empty." };
    }

    site.origin = originSettings.origin;
    site.allowedOrigins = originSettings.allowedOrigins;
    site.name = sanitizeSiteName(body.name, site.origin);
    site.email = parsedEmail.email;
    if (Object.hasOwn(body, "connectionLimit")) {
      site.connectionLimit = sanitizeConnectionLimit(body.connectionLimit);
    }
    touchSite(site);
  },
  updateCustomization(site, scene, body) {
    site.sceneConfig = sanitizeSceneConfig(body.sceneConfig);
    site.styleConfig = sanitizeSiteStyle(body.styleConfig);
    site.messageBoard = sanitizeMessageBoard(body.messageBoard);
    touchSite(site);

    if (scene.clients.size === 0) {
      scenes.delete(site.siteKey);
      return;
    }

    rebuildSceneProps(scene, site);
    // Push the edited scene and board to everyone currently in the square so they
    // update live, no snippet re-paste needed. Colours stay in the pasted CSS.
    broadcast(scene, { type: MSG.SCENE, scene: getSceneConfig(site) });
    broadcast(scene, { type: MSG.MESSAGE_BOARD, messageBoard: getMessageBoard(site) });
  },
  updateConnections(site, scene, body) {
    site.connections = sanitizeConnections(body.connections);
    touchSite(site);
    // Push edited neighbour links to everyone currently in the square so they
    // update live, no snippet re-paste needed.
    if (scene.clients.size > 0) {
      broadcast(scene, { type: MSG.CONNECTIONS, connections: getConnections(site) });
    }
  },
  setChatDisabled(site, scene, body) {
    site.chatDisabled = Boolean(body.disabled);
    logModeration(site, site.chatDisabled ? "chat-off" : "chat-on");
    touchSite(site);
  },
  setBotProtection(site, scene, body) {
    site.botProtection = Boolean(body.enabled);
    logModeration(site, site.botProtection ? "bot-protection-on" : "bot-protection-off");
    touchSite(site);
  },
  updateModeration(site, scene, body) {
    site.blockedWords = sanitizeBlockedWords(body.blockedWords);
    site.chatThrottleMs = sanitizeChatThrottle(body.chatThrottleMs);
    touchSite(site);
    // Push the new cooldown to connected widgets so their "wait" hint stays in
    // sync — otherwise a visitor keeps the old limit until they reconnect.
    broadcast(scene, { type: MSG.CHAT_THROTTLE, ms: getChatThrottle(site) });
  },
  kickVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (identity) {
      logModeration(site, "kick", visitorLogLabel(identity));
      touchSite(site);
      closeIdentityClients(identity, 4001, "kicked");
    }
  },
  blockVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity) return;
    if (!site.blockedBrowserIds.includes(identity.browserId)) {
      site.blockedBrowserIds.push(identity.browserId);
    }
    // Also block the visitor's live source IP(s). The browserId is chosen by the
    // client, so a reconnecting bot rotates it and a browserId-only block never
    // sticks. The IP is far harder to rotate, so capturing it here is what makes
    // Block actually hold across reconnects. Runs even when the browserId was
    // already blocked, so re-blocking a rotated identity still catches its IP.
    if (!Array.isArray(site.blockedIps)) site.blockedIps = [];
    for (const peerClient of identity.clients) {
      const peerIp = peerClient.ip;
      if (peerIp && peerIp !== "unknown" && !site.blockedIps.includes(peerIp)) {
        site.blockedIps.push(peerIp);
      }
    }
    logModeration(site, "block", visitorLogLabel(identity));
    touchSite(site);
    closeIdentityClients(identity, 4003, "blocked");
  },
  muteVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity) return;
    if (!Array.isArray(site.mutedBrowserIds)) site.mutedBrowserIds = [];
    if (!site.mutedBrowserIds.includes(identity.browserId)) {
      site.mutedBrowserIds.push(identity.browserId);
      logModeration(site, "mute", visitorLogLabel(identity));
      touchSite(site);
    }
  },
  unmuteVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity || !Array.isArray(site.mutedBrowserIds)) return;
    const index = site.mutedBrowserIds.indexOf(identity.browserId);
    if (index !== -1) {
      site.mutedBrowserIds.splice(index, 1);
      logModeration(site, "unmute", visitorLogLabel(identity));
      touchSite(site);
    }
  },
  hideVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity) return;
    if (!Array.isArray(site.shadowBlockedBrowserIds)) site.shadowBlockedBrowserIds = [];
    if (!site.shadowBlockedBrowserIds.includes(identity.browserId)) {
      broadcastIdentity(scene, { type: MSG.LEAVE, id: identity.id }, identity);
      site.shadowBlockedBrowserIds.push(identity.browserId);
      logModeration(site, "hide", visitorLogLabel(identity));
      touchSite(site);
    }
  },
  unhideVisitor(site, scene, body) {
    const identity = scene.identities.get(Number(body.visitorId));
    if (!identity || !Array.isArray(site.shadowBlockedBrowserIds)) return;
    const index = site.shadowBlockedBrowserIds.indexOf(identity.browserId);
    if (index !== -1) {
      site.shadowBlockedBrowserIds.splice(index, 1);
      logModeration(site, "unhide", visitorLogLabel(identity));
      touchSite(site);
      if (identity.joined) {
        broadcastIdentity(scene, { type: MSG.JOIN, peer: snapshotIdentity(identity) }, identity);
      }
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
    broadcastIdentity(scene, { type: MSG.PROFILE, ...serializeIdentity(identity, { owner: true, badge: true }) }, identity);
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
      broadcastIdentity(scene, { type: MSG.PROFILE, ...serializeIdentity(identity, { owner: true, badge: true }) }, identity);
    }
  },
  clearMessages(site, scene) {
    for (const identity of scene.identities.values()) {
      identity.messages = [];
    }
    logModeration(site, "clear-messages");
    touchSite(site);
  },
  setPluginEnabled(site, scene, body) {
    const name = String(body.name || "");
    if (!plugins.toggleable(pluginContext(site)).some((plugin) => plugin.name === name)) {
      return { error: "Unknown plugin." };
    }
    if (!isPlainObject(site.pluginsEnabled)) site.pluginsEnabled = {};
    site.pluginsEnabled[name] = Boolean(body.enabled);
    logModeration(site, body.enabled ? "plugin-on" : "plugin-off", name);
    touchSite(site);
  },
  disableSite(site, scene, body) {
    site.disabled = Boolean(body.disabled);
    logModeration(site, site.disabled ? "site-off" : "site-on");
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

    const presentedToken = String(body.adminToken || "").trim();
    const resolved = resolveAdminRequest(req, body);
    if (!resolved) {
      if (presentedToken) recordAuthFailure(adminAuthFailuresByIp, ip);
      sendJson(res, 403, { error: "Invalid site key or admin token." });
      return;
    }
    if (resolved.tokenPresented) clearAuthFailures(adminAuthFailuresByIp, ip);

    const site = resolved.site;
    // Carry the upgrade cookie (if any) on whichever response this handler sends.
    const cookieHeader = resolved.setCookie ? { "set-cookie": resolved.setCookie } : null;
    const respond = (status, payload) => sendJson(res, status, payload, cookieHeader);
    const action = String(body.action || "");
    const pluginName = String(body.plugin || "");
    const scene = getScene(site.siteKey, site);

    if (pluginName) {
      let changed = false;
      const hadPluginData = Object.hasOwn(site.plugins, pluginName);
      const previousPluginData = getPluginData(site, pluginName);
      const context = (name) => Object.freeze({
        site: pluginSite(site),
        data: getPluginData(site, name),
        owners: getOwners(site, scene),
        visitors: getSceneStats(scene, site).visitors,
        setData(value) {
          setPluginData(site, name, value);
          changed = true;
        },
      });
      const invoked = plugins.invokeAdminAction(
        pluginName,
        action,
        context,
        isPlainObject(body.input) ? body.input : {},
      );
      if (!invoked.found) {
        respond(400, { error: "Unknown plugin action." });
        return;
      }
      if (invoked.error || invoked.result?.error) {
        if (changed) {
          if (hadPluginData) site.plugins[pluginName] = previousPluginData;
          else delete site.plugins[pluginName];
        }
        respond(400, { error: invoked.error || invoked.result.error });
        return;
      }
      if (changed) {
        touchSite(site);
        for (const identity of scene.identities.values()) {
          if (!identity.joined) continue;
          broadcastIdentity(scene, { type: MSG.PROFILE, ...serializeIdentity(identity, { owner: true, badge: true }) }, identity);
        }
      }
      const panel = { site: publicSite(site), scene: getSceneStats(scene, site), owners: getOwners(site, scene) };
      respond(200, extendAdminPanel(panel, site));
      return;
    }

    if (!Object.hasOwn(ADMIN_ACTIONS, action)) {
      respond(400, { error: "Unknown action." });
      return;
    }

    const actionResult = ADMIN_ACTIONS[action](site, scene, body);
    if (actionResult?.error) {
      respond(400, actionResult);
      return;
    }
    const panel = { site: publicSite(site), scene: getSceneStats(scene, site), owners: getOwners(site, scene) };
    respond(200, extendAdminPanel(panel, site));
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
  const connectionClicks = isPlainObject(site.connectionClicks) ? site.connectionClicks : {};
  const mapClicks = isPlainObject(site.mapClicks) ? site.mapClicks : {};

  return {
    ...publicSite(site),
    updatedAt: site.updatedAt,
    activeVisitors: scene ? countActiveVisitors(scene) : 0,
    visitorStats: visitorStats.getStats(site.siteKey),
    connectionClicks,
    connectionClickTotal: Object.values(connectionClicks).reduce(
      (sum, entry) => sum + (entry?.count || 0),
      0,
    ),
    mapClickTotal: Number(mapClicks.count || 0),
    mapClickLastAt: Number(mapClicks.lastAt || 0),
  };
}

function buildServiceAdminPlatformStats(sites) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let onlineNow = 0;
  let activeSitesNow = 0;
  let seenToday = 0;
  let activeSites7d = 0;
  let activeSites30d = 0;
  let visitorsWeekly = 0;
  let chattingThisWeek = 0;

  for (const site of sites) {
    const active = site.activeVisitors ?? 0;
    const weekly = site.visitorStats?.weekly ?? 0;
    const monthly = site.visitorStats?.monthly ?? 0;
    onlineNow += active;
    if (active > 0) activeSitesNow += 1;
    if (site.lastSeenAt && now - site.lastSeenAt < dayMs) seenToday += 1;
    visitorsWeekly += weekly;
    if (weekly > 0) activeSites7d += 1;
    if (monthly > 0) activeSites30d += 1;
    if (site.lastMessageAt && now - site.lastMessageAt < 7 * dayMs) chattingThisWeek += 1;
  }

  return {
    onlineNow,
    activeSitesNow,
    seenToday,
    activeSites7d,
    activeSites30d,
    visitorsWeekly,
    chattingThisWeek,
    dailySeries: visitorStats.getAggregateDailySeries(7),
  };
}

function sendServiceAdminSites(res) {
  const sites = Array.from(sitesByKey.values()).map((site) => serviceAdminSite(site));
  sendJson(res, 200, {
    sites,
    platform: buildServiceAdminPlatformStats(sites),
  });
}

function closeSiteScene(siteKey, code, reason) {
  const scene = scenes.get(siteKey);
  if (!scene) return;

  // Cancel pending reconnect-grace disconnects so their timers don't fire
  // against this scene after it's been removed.
  for (const identity of scene.identities.values()) {
    clearLeaveTimer(identity);
  }
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
    sendJson(res, 200, { world: resolvedMapWorld() });
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
      ensureMapWorldGrown();
      sendJson(res, 200, { world: resolvedMapWorld() });
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
    // Existing admin sessions were authorized by the old token; revoke them.
    adminSessions.destroyForSite(site.siteKey);
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
  setSiteSupporter(req, site, body) {
    site.supporter = Boolean(body.supporter);
    touchSite(site);
    return { site: serviceAdminSite(site) };
  },
  setSitePlus(req, site, body) {
    site.plus = Boolean(body.plus);
    touchSite(site);
    return { site: serviceAdminSite(site) };
  },
  deleteSite(req, site) {
    closeSiteScene(site.siteKey, 4003, "site deleted");
    adminSessions.destroyForSite(site.siteKey);
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
  return plugins.extendVisitor(
    serialized,
    pluginContext(identity.scene?.site || null, { visitor: pluginVisitor(identity) }),
  );
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
    if (!client.joined && !client.spectator) continue;
    if (client.connectionId === exceptConnectionId) continue;
    if (client.ws.readyState !== client.ws.OPEN) continue;
    client.ws.send(payload);
  }
}

/** Whether `viewer` should receive presence/chat events from `target`. */
function canSeeIdentity(site, viewerIdentity, targetIdentity) {
  if (!targetIdentity) return true;
  if (viewerIdentity.id === targetIdentity.id) return true;
  return !isShadowBlocked(site, targetIdentity.browserId);
}

/** Broadcast an identity-scoped event only to clients who can see that identity. */
function broadcastIdentity(scene, message, sourceIdentity, options = {}) {
  const { exceptConnectionId = null } = options;
  const site = scene.site;
  const payload = JSON.stringify(message);

  for (const client of scene.clients.values()) {
    if (client.connectionId === exceptConnectionId) continue;
    if (client.ws.readyState !== client.ws.OPEN) continue;
    // Read-only overlays have no identity of their own: they see every visitor
    // except shadow-blocked ones.
    if (client.spectator) {
      if (isShadowBlocked(site, sourceIdentity?.browserId)) continue;
      client.ws.send(payload);
      continue;
    }
    if (!client.joined || !client.identity) continue;
    if (!canSeeIdentity(site, client.identity, sourceIdentity)) continue;
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
  broadcastIdentity(scene, {
    type: MSG.READING,
    id: identity.id,
    readingLabel,
    readingUrl,
    readingActive,
  }, identity, { exceptConnectionId });
}

function emitIdentityState(identity, options = {}) {
  broadcastIdentity(identity.scene, {
    type: MSG.MOVE,
    ...serializeIdentity(identity, { reading: true }),
  }, identity, { exceptConnectionId: options.exceptConnectionId ?? null });
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

function syncSceneBirdPerches(scene) {
  const perchById = new Map(scene.birdPerches.map((perch) => [perch.id, perch]));
  for (const [id, bird] of scene.birds) {
    if (bird.state !== "perched") continue;
    const perch = perchById.get(bird.perchId);
    if (!perch) {
      scene.birds.delete(id);
      continue;
    }
    bird.x = perch.x;
  }
}

function broadcastBird(scene, message, options = {}) {
  broadcast(scene, { type: MSG.BIRD, ...message }, options);
}

function fleeBird(scene, bird, playerX) {
  if (!scene.birds.delete(bird.id)) return;

  const dir = playerX < bird.x ? 1 : -1;
  broadcastBird(scene, {
    action: BIRD_ACTION.FLEE,
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
    action: BIRD_ACTION.SPAWN,
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
    site,
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
  syncSceneBirdPerches(scene);

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

function createSiteRecord({ name, origin, allowedOrigins, email, sceneConfig, styleConfig, connections, messageBoard }) {
  const now = Date.now();
  const adminToken = createToken("admin", 24);
  return {
    adminToken,
    site: {
      siteKey: createToken("site", 12),
      adminTokenHash: hashAdminToken(adminToken),
      name: sanitizeSiteName(name, origin),
      origin,
      allowedOrigins: Array.isArray(allowedOrigins) && allowedOrigins.length > 0 ? allowedOrigins : [origin],
      email: email || null,
      sceneConfig: sanitizeSceneConfig(sceneConfig),
      styleConfig: sanitizeSiteStyle(styleConfig),
      connections: sanitizeConnections(connections),
      messageBoard: sanitizeMessageBoard(messageBoard),
      disabled: false,
      chatDisabled: false,
      botProtection: true,
      // Marks that the on-by-default flip has already been applied, so the
      // one-time migration in loadSites never re-forces it (owners stay free to
      // turn protection off afterwards).
      botProtectionDefaulted: true,
      plus: false,
      verifiedAt: null,
      lastSeenAt: null,
      lastSeenUrl: null,
      messageCount: 0,
      lastMessageAt: null,
      connectionClicks: {},
      mapClicks: { count: 0, lastAt: 0 },
      createdAt: now,
      updatedAt: now,
      blockedBrowserIds: [],
      blockedIps: [],
      mutedBrowserIds: [],
      shadowBlockedBrowserIds: [],
      ownerBrowserIds: [],
      ownerProfiles: {},
      blockedWords: [],
      chatThrottleMs: DEFAULT_CHAT_THROTTLE_MS,
      connectionLimit: DEFAULT_CONNECTION_LIMIT,
      moderationLog: [],
      plugins: {},
      pluginsEnabled: {},
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
      if (!Array.isArray(site.blockedBrowserIds)) {
        site.blockedBrowserIds = [];
      }
      if (!Array.isArray(site.blockedIps)) {
        site.blockedIps = [];
      }
      if (!Array.isArray(site.mutedBrowserIds)) {
        site.mutedBrowserIds = [];
      }
      if (!Array.isArray(site.shadowBlockedBrowserIds)) {
        site.shadowBlockedBrowserIds = [];
      }
      if (!Array.isArray(site.ownerBrowserIds)) {
        site.ownerBrowserIds = [];
      }
      if (!isPlainObject(site.ownerProfiles)) {
        site.ownerProfiles = {};
      }
      if (!Array.isArray(site.blockedWords)) {
        site.blockedWords = [];
      }
      if (typeof site.chatThrottleMs !== "number") {
        site.chatThrottleMs = DEFAULT_CHAT_THROTTLE_MS;
      }
      if (typeof site.connectionLimit !== "number") {
        site.connectionLimit = DEFAULT_CONNECTION_LIMIT;
        sitesMigratedOnLoad = true;
      } else {
        const nextConnectionLimit = sanitizeConnectionLimit(site.connectionLimit);
        if (nextConnectionLimit !== site.connectionLimit) {
          site.connectionLimit = nextConnectionLimit;
          sitesMigratedOnLoad = true;
        }
      }
      if (!Array.isArray(site.moderationLog)) {
        site.moderationLog = [];
      }
      if (!Array.isArray(site.connections)) {
        site.connections = [];
      }
      if (!isPlainObject(site.messageBoard)) {
        site.messageBoard = sanitizeMessageBoard({});
        sitesMigratedOnLoad = true;
      }
      if (ensurePluginData(site)) {
        sitesMigratedOnLoad = true;
      }
      if (!isPlainObject(site.pluginsEnabled)) {
        site.pluginsEnabled = {};
      }
      const nextAllowedOrigins = getAllowedOrigins(site);
      if (JSON.stringify(nextAllowedOrigins) !== JSON.stringify(site.allowedOrigins || [])) {
        site.allowedOrigins = nextAllowedOrigins;
        sitesMigratedOnLoad = true;
      }
      if (typeof site.messageCount !== "number") {
        site.messageCount = 0;
      }
      if (site.lastMessageAt === undefined) {
        site.lastMessageAt = null;
      }
      if (!isPlainObject(site.connectionClicks)) {
        site.connectionClicks = {};
      }
      if (!isPlainObject(site.mapClicks)) {
        site.mapClicks = { count: 0, lastAt: 0 };
      }
      if (typeof site.supporter !== "boolean") {
        site.supporter = false;
      }
      // Bot protection is on by default. Flip every pre-existing site on exactly
      // once (including those persisted as `false`), then record the marker so a
      // later owner toggle-off survives restarts instead of being re-forced.
      if (site.botProtectionDefaulted !== true) {
        site.botProtection = true;
        site.botProtectionDefaulted = true;
        sitesMigratedOnLoad = true;
      }
      if (typeof site.plus !== "boolean") {
        // Migrate the former `pro` flag onto `plus`; default new/unset sites to false.
        site.plus = typeof site.pro === "boolean" ? site.pro : false;
      }
      delete site.pro;
      return [site.siteKey, site];
    }));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not load sites registry: ${error.message}`);
    }
    return new Map();
  }
}

// Persistence lives in server/sites-store.js; it reads the current registry at
// write time and coalesces the high-frequency metadata writes (profile edits,
// owner toggles, lastSeen) so a busy site doesn't block the event loop.
const sitesWriter = createSitesWriter({
  dataDir: DATA_DIR,
  sitesFile: SITES_FILE,
  getSites: () => Array.from(sitesByKey.values()),
});

function saveSites() {
  sitesWriter.saveNow();
}

function scheduleSitesSave() {
  sitesWriter.scheduleSave();
}

function flushSites() {
  sitesWriter.flush();
}

function touchSite(site) {
  site.updatedAt = Date.now();
  scheduleSitesSave();
}

// Visitor connection clicks are high-frequency, so we mirror the lastSeen save
// pattern: tally in memory on every click and flush the whole registry to disk
// at most once per interval. Losing up to a minute of clicks on a crash is fine
// for traffic analytics.
let lastConnectionClicksSaveAt = 0;
let lastMapClicksSaveAt = 0;

// lastSeenUrl is refreshed on every navigation across every connected visitor.
// Throttle the full sites.json rewrite the same way lastSeenAt is throttled so a
// busy (or hostile) client can't amplify reading updates into one disk write each.
// The in-memory value is updated immediately, so admin views stay current; we only
// risk losing up to a minute of freshness on a crash.
let lastSeenUrlSaveAt = 0;

/**
 * Record one visitor click on a configured neighbouring-town link. The reported
 * destination must match one of the source site's sanitized connections, so the
 * tally cannot be inflated with arbitrary URLs.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function handleConnectionClick(req, res) {
  readJsonBody(req, res, (body) => {
    // sendBeacon ignores the response, so a 204 with permissive CORS is enough.
    const respond = (status) => {
      res.writeHead(status, { "access-control-allow-origin": "*" });
      res.end();
    };

    const siteKey = typeof body.siteKey === "string" ? body.siteKey : "";
    const url = typeof body.url === "string" ? body.url : "";
    const site = sitesByKey.get(siteKey);
    if (!site || site.disabled) {
      respond(204);
      return;
    }

    const target = getConnections(site).find((connection) => connection.url === url);
    if (!target) {
      respond(204);
      return;
    }

    const now = Date.now();
    const clicks = isPlainObject(site.connectionClicks) ? site.connectionClicks : (site.connectionClicks = {});
    const entry = isPlainObject(clicks[url]) ? clicks[url] : (clicks[url] = { count: 0, lastAt: 0 });
    entry.count += 1;
    entry.lastAt = now;

    if (now - lastConnectionClicksSaveAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      lastConnectionClicksSaveAt = now;
      saveSites();
    }

    respond(204);
  });
}

/**
 * Record one visitor click on a site's outbound website link from the public
 * /map page. We only need a per-site tally (the map exposes a single website
 * link per town), so a verified siteKey is enough to attribute the click.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function handleMapClick(req, res) {
  readJsonBody(req, res, (body) => {
    // sendBeacon ignores the response, so a 204 with permissive CORS is enough.
    const respond = (status) => {
      res.writeHead(status, { "access-control-allow-origin": "*" });
      res.end();
    };

    const siteKey = typeof body.siteKey === "string" ? body.siteKey : "";
    const site = sitesByKey.get(siteKey);
    if (!site || site.disabled) {
      respond(204);
      return;
    }

    const now = Date.now();
    const mapClicks = isPlainObject(site.mapClicks) ? site.mapClicks : (site.mapClicks = { count: 0, lastAt: 0 });
    mapClicks.count = (Number(mapClicks.count) || 0) + 1;
    mapClicks.lastAt = now;

    if (now - lastMapClicksSaveAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      lastMapClicksSaveAt = now;
      saveSites();
    }

    respond(204);
  });
}

function closeIdentityClients(identity, code, reason) {
  for (const client of Array.from(identity.clients)) {
    client.ws.close(code, reason);
  }
}

/** Effective slow-mode cooldown for a site (default when site-less or unset). */
function getChatThrottle(site) {
  return site ? sanitizeChatThrottle(site.chatThrottleMs) : DEFAULT_CHAT_THROTTLE_MS;
}

function getConnectionLimit(site) {
  return site ? sanitizeConnectionLimit(site.connectionLimit) : DEFAULT_CONNECTION_LIMIT;
}

/** A muted visitor stays present but their messages are dropped server-side. */
function isMuted(site, browserId) {
  return Boolean(site) && Array.isArray(site.mutedBrowserIds) && site.mutedBrowserIds.includes(browserId);
}

/** A hidden visitor stays connected but is invisible to everyone else. */
function isShadowBlocked(site, browserId) {
  return Boolean(site) && Array.isArray(site.shadowBlockedBrowserIds) && site.shadowBlockedBrowserIds.includes(browserId);
}

/** A short, human label for an identity used in the moderation log. */
function visitorLogLabel(identity) {
  const name = String(identity?.displayName || "").trim();
  return name || `Visitor ${identity?.id ?? "?"}`;
}

/** Record a moderation action, newest first, capped. Caller persists via touchSite. */
function logModeration(site, action, detail = "") {
  if (!site) return;
  if (!Array.isArray(site.moderationLog)) site.moderationLog = [];
  site.moderationLog.unshift({ at: Date.now(), action, detail });
  if (site.moderationLog.length > MAX_MODERATION_LOG) {
    site.moderationLog.length = MAX_MODERATION_LOG;
  }
}

function publicSite(site) {
  const config = {
    siteKey: site.siteKey,
    name: site.name,
    origin: site.origin,
    allowedOrigins: getAllowedOrigins(site),
    includeMatchingWww: siteUsesMatchingWwwOrigin(site),
    email: site.email || null,
    sceneConfig: getSceneConfig(site),
    styleConfig: getStyleConfig(site),
    connections: getConnections(site),
    messageBoard: getMessageBoard(site),
    disabled: site.disabled,
    chatDisabled: site.chatDisabled,
    botProtection: Boolean(site.botProtection),
    verifiedAt: site.verifiedAt,
    lastSeenAt: site.lastSeenAt,
    lastSeenUrl: site.lastSeenUrl || null,
    messageCount: site.messageCount || 0,
    lastMessageAt: site.lastMessageAt || null,
    createdAt: site.createdAt,
    blockedCount: site.blockedBrowserIds.length,
    blockedIpCount: Array.isArray(site.blockedIps) ? site.blockedIps.length : 0,
    mutedCount: Array.isArray(site.mutedBrowserIds) ? site.mutedBrowserIds.length : 0,
    hiddenCount: Array.isArray(site.shadowBlockedBrowserIds) ? site.shadowBlockedBrowserIds.length : 0,
    blockedWords: Array.isArray(site.blockedWords) ? site.blockedWords : [],
    chatThrottleMs: typeof site.chatThrottleMs === "number" ? site.chatThrottleMs : DEFAULT_CHAT_THROTTLE_MS,
    connectionLimit: getConnectionLimit(site),
    moderationLog: Array.isArray(site.moderationLog) ? site.moderationLog : [],
    supporter: Boolean(site.supporter),
    plus: Boolean(site.plus),
  };
  const extendedConfig = plugins.extend("extendSiteConfig", config, pluginContext(site));
  return isPlainObject(extendedConfig) ? extendedConfig : config;
}

function pluginSite(site) {
  if (!site) return null;
  return Object.freeze({
    siteKey: site.siteKey,
    name: site.name,
    origin: site.origin,
    supporter: Boolean(site.supporter),
    plus: Boolean(site.plus),
  });
}

function pluginVisitor(identity) {
  const site = identity.scene?.site || null;
  // Stable per-visitor fingerprint (same hash as ownerHandle), so plugins can
  // key data on a visitor without ever seeing the raw browserId. Matches the
  // `fp` exposed to the admin panel by getSceneStats.
  const fp = site ? ownerHandle(site.siteKey, identity.browserId) : null;
  return Object.freeze({
    id: identity.id,
    browserId: identity.browserId,
    displayName: identity.displayName,
    color: identity.color,
    isOwner: identity.isOwner,
    ownerHandle: identity.isOwner ? fp : null,
    fp,
  });
}

function isPluginEnabledForSite(site, pluginName) {
  // Toggleable add-ons are off until a site owner switches them on, so anything
  // not explicitly true stays inactive.
  return Boolean(site && isPlainObject(site.pluginsEnabled) && site.pluginsEnabled[pluginName] === true);
}

function describeSitePlugins(site) {
  return plugins.toggleable(pluginContext(site)).map((plugin) => ({
    ...plugin,
    enabled: isPluginEnabledForSite(site, plugin.name),
  }));
}

function pluginContext(site, values = {}) {
  return (pluginName) => Object.freeze({
    ...values,
    site: pluginSite(site),
    data: getPluginData(site, pluginName),
    enabled: isPluginEnabledForSite(site, pluginName),
  });
}

function getScene(sceneKey, site = null) {
  const existing = scenes.get(sceneKey);
  if (existing) {
    if (!existing.site && site) existing.site = site;
    return existing;
  }

  const scene = createScene(sceneKey, site);
  scenes.set(sceneKey, scene);
  return scene;
}

function getSceneStats(scene, site = null) {
  const visitors = Array.from(scene.identities.values())
    .filter((identity) => identity.joined)
    .map((identity) => {
      const serialized = serializeIdentity(identity, { owner: true, messages: true, clientCount: true });
      serialized.muted = isMuted(site, identity.browserId);
      serialized.hidden = isShadowBlocked(site, identity.browserId);
      // Stable fingerprint so the admin UI / plugin actions can target a
      // specific visitor (e.g. assign a hat) without exposing the browserId.
      serialized.fp = site ? ownerHandle(site.siteKey, identity.browserId) : null;
      return serialized;
    });

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
  // Livestream overlays connect read-only: they receive the live scene but are
  // never registered as a visitor (no identity, no JOIN, uncounted).
  const watch = url.searchParams.get("watch") === "1";
  if (!siteKey) {
    return { ok: true, scene: getScene("default", null), site: null, watch };
  }

  const site = sitesByKey.get(siteKey);
  if (!site || site.disabled) {
    return { ok: false, status: 403, reason: "site disabled or unknown" };
  }

  return { ok: true, scene: getScene(site.siteKey, site), site, watch };
}

function isOriginAllowedForSite(origin, site) {
  if (!site) return true;
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && getAllowedOrigins(site).includes(normalized));
}

/**
 * Remember the page a site's widget was last seen on. The source is the
 * visitor's reading URL, which the widget defaults to `window.location.href`
 * and which the server has already validated against the site's allowed
 * origins (browsers do not send a Referer on the WebSocket upgrade, so the
 * reading URL is how the host page reaches us). Stored as origin + pathname
 * only, so query strings and hashes are never persisted. Returns true when the
 * stored value changed.
 */
function rememberSiteLastSeenUrl(site, readingUrl) {
  if (!site || !readingUrl) return false;
  let url;
  try {
    url = new URL(readingUrl);
  } catch {
    return false;
  }
  const origin = normalizeOrigin(url.origin);
  if (!origin) return false;
  const pageUrl = `${origin}${url.pathname}`.slice(0, MAX_PAGE_URL_LEN);
  if (pageUrl === site.lastSeenUrl) return false;
  site.lastSeenUrl = pageUrl;
  return true;
}

let sitesByKey = new Map();
const scenes = new Map();
const visitorStats = createVisitorStats({ filePath: VISITOR_STATS_FILE });
let nextConnectionId = 1;

function finalizeDisconnect(identity) {
  if (identity.clients.size > 0) return;
  const scene = identity.scene;
  // The scene may have been torn down (site disabled/deleted) during the
  // reconnect-grace window; if so there's nothing left to remove or notify.
  if (!scene || scenes.get(scene.key) !== scene) return;
  const hadJoined = identity.joined;
  removeIdentity(scene, identity);

  if (hadJoined) {
    broadcastIdentity(scene, { type: MSG.LEAVE, id: identity.id }, identity);
  }
}

function handleHttpRequest(req, res) {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (
    (!DEV_TOOLS_ENABLED && staticFiles.isDevToolsRequest(url.pathname))
    || (!STAGING_PAGE_ENABLED && staticFiles.isStagingPageRequest(url.pathname))
  ) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "not found");
    return;
  }

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

  if (req.method === "GET" && url.pathname === "/api/stats") {
    handleStats(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/site-presence") {
    handleSitePresence(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sites") {
    handleRegisterSite(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/connection-click") {
    handleConnectionClick(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/map-click") {
    handleMapClick(req, res);
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

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    handleAdminLogout(req, res);
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

  if (plausible.enabled) {
    const scriptPath = plausible.scriptPath();
    if (scriptPath && req.method === "GET" && url.pathname === scriptPath) {
      void plausible.proxyScript(req, res);
      return;
    }

    if (plausible.apiPath && req.method === "POST" && url.pathname === plausible.apiPath) {
      plausible.proxyEvent(req, res);
      return;
    }
  }

  const candidates = staticFiles.resolvePublicFile(req.url || "/", req.headers.host || `${HOST}:${PORT}`);

  if (!candidates) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }

  staticFiles.serveCandidate(candidates, 0, res, req);
}

// Wraps the request dispatcher so a single unhandled throw cannot crash the
// process (and with it every live WebSocket connection across every site).
const server = http.createServer((req, res) => {
  try {
    handleHttpRequest(req, res);
  } catch (error) {
    console.error("Unhandled error handling request", req.method, req.url, error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : "server error");
    } else {
      res.end();
    }
  }
});

// Tries each candidate file path in order, falling back to the next on a
// missing file so the plugin assets overlay can back the core public dir.
const wss = new WebSocketServer({
  server,
  path: "/live",
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

// One-off snapshot for a read-only livestream overlay. Mirrors the peers/birds/
// scene payload of the join HELLO but carries no self identity, so the widget
// renders the live crowd without placing the viewer in it.
function sendSpectatorHello(client) {
  const { scene, site } = client;
  const peers = Array.from(scene.identities.values())
    .filter((peer) => peer.joined && !isShadowBlocked(site, peer.browserId))
    .map(snapshotIdentity);

  send(client.ws, {
    type: MSG.HELLO,
    id: null,
    spectator: true,
    peers,
    birds: snapshotBirds(scene),
    chatThrottleMs: getChatThrottle(site),
    pluginModules: plugins.browserModules("widget", pluginContext(site)),
    // Hosted sites carry scene/connections/board over the socket so overlays
    // track admin edits live, just like a normal embed.
    ...(site ? { scene: getSceneConfig(site), connections: getConnections(site), messageBoard: getMessageBoard(site) } : {}),
  });
}

function handleInit(client, message) {
  if (client.joined) return;

  // Per-site bot protection: require a solved proof-of-work before joining. A
  // raw script that does not run the widget never solves it; a scripted solver
  // pays CPU per visitor. The init is replayed once the solution arrives.
  if (client.site && client.site.botProtection && !client.powVerified) {
    client.pendingInit = message;
    issuePowChallenge(client);
    return;
  }

  // Livestream overlay: send a one-off snapshot of the live scene, then let the
  // normal broadcast fan-out keep it updated. The spectator never becomes an
  // identity, so it is uncounted, invisible to real visitors, and consumes no
  // join budget.
  if (client.spectator) {
    sendSpectatorHello(client);
    return;
  }

  if (!allowIdentityInit(client, message)) return;

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
    identity.displayName = filterDisplayName(site, sanitizeDisplayName(message.displayName));
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
    .filter((peer) => peer.joined && peer.id !== identity.id && canSeeIdentity(site, identity, peer))
    .map(snapshotIdentity);

  const self = serializeIdentity(identity, { reading: true, owner: true, messages: true, badge: true });
  const { id, ...selfFields } = self;

  send(client.ws, {
    type: MSG.HELLO,
    id,
    browserSecret: identity.browserSecret,
    ...selfFields,
    peers,
    birds: snapshotBirds(scene),
    chatThrottleMs: getChatThrottle(site),
    pluginModules: plugins.browserModules("widget", pluginContext(site)),
    // Hosted sites carry scene, connections, and the message board over the socket
    // so admin edits apply live without re-pasting the embed snippet.
    ...(site ? { scene: getSceneConfig(site), connections: getConnections(site), messageBoard: getMessageBoard(site) } : {}),
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
      broadcastIdentity(
        scene,
        { type: MSG.PROFILE, ...serializeIdentity(identity, { owner: true, badge: true }) },
        identity,
        { exceptConnectionId: client.connectionId },
      );
    }
    syncIdentityAwayState(identity);
    return;
  }

  identity.joined = true;
  const joinedAt = Date.now();
  identity.lastActivityAt = joinedAt;
  identity.joinedAt = joinedAt;

  logJoin(client, identity);

  if (site) {
    const now = Date.now();
    const firstVerify = !site.verifiedAt;
    const lastSavedSeenAt = site.lastSeenAt || 0;
    site.lastSeenAt = now;
    site.verifiedAt = site.verifiedAt || now;

    const urlChanged = rememberSiteLastSeenUrl(site, identity.readingUrl);

    if (firstVerify || urlChanged || now - lastSavedSeenAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      saveSites();
      if (firstVerify) ensureMapWorldGrown();
    }

    // Tally this visitor toward the site's daily/weekly/monthly unique counts.
    visitorStats.recordVisit(site.siteKey, identity.browserId, now);
  }

  if (!isShadowBlocked(site, identity.browserId)) {
    broadcastIdentity(scene, { type: MSG.JOIN, peer: snapshotIdentity(identity) }, identity, { exceptConnectionId: client.connectionId });
  }
  syncIdentityAwayState(identity, joinedAt);
  if (!isShadowBlocked(site, identity.browserId)) {
    plugins.run("onVisitorJoin", pluginContext(site, {
      visitor: pluginVisitor(identity),
      joinedAt,
    }));
  }
}

function handleMove(client, message) {
  if (!client.identity) return;

  const nextX = clampPosition(message.x);
  if (nextX === null) return;

  const now = Date.now();
  if (now - client.lastMoveAt < MOVE_THROTTLE_MS) return;
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;

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
  let target = null;
  if (message.action === GESTURE.HIGH_FIVE) {
    targetId = Number(message.targetId);
    target = Number.isInteger(targetId) ? client.scene.identities.get(targetId) : null;
    if (!target || !target.joined || target.id === client.identity.id) return;
    if (Math.abs(target.x - client.identity.x) > HIGH_FIVE_DISTANCE) return;
  }
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;
  if (!allowSynchronizedAction(client, message.action, now)) return;

  client.lastActionAt = now;
  clearPose(client.identity);
  if (target) clearPose(target);
  touchIdentityActivity(client.identity, now);
  const action = {
    type: MSG.ACTION,
    id: client.identity.id,
    action: message.action,
  };
  if (targetId !== null) action.targetId = targetId;
  broadcastIdentity(client.scene, action, client.identity, { exceptConnectionId: client.connectionId });
}

function handleProfile(client, message) {
  if (!client.identity) return;

  const displayName = filterDisplayName(client.site, sanitizeDisplayName(message.displayName));
  const color = sanitizeCharacterColor(message.color);
  if (displayName === client.identity.displayName && color === client.identity.color) return;
  if (registerFloodAction(client)) return;
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;

  client.identity.displayName = displayName;
  client.identity.color = color;
  // Log renames: the abusive bot joins blank then renames to slurs, so this is
  // where its IP + fingerprint become visible for a targeted IP block.
  if (LOG_JOINS && displayName) {
    console.log(JSON.stringify({
      event: "rename",
      at: new Date().toISOString(),
      site: client.site ? client.site.siteKey : null,
      name: displayName,
      ip: client.ip,
      fp: client.site ? ownerHandle(client.site.siteKey, client.identity.browserId) : null,
      origin: client.origin || null,
    }));
  }
  touchIdentityActivity(client.identity);
  // Owners keep their look across resets: persist their own edits too.
  rememberOwnerProfile(client.site, client.identity);

  broadcastIdentity(client.scene, { type: MSG.PROFILE, ...serializeIdentity(client.identity, { owner: true, badge: true }) }, client.identity);
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
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;

  client.readingActive = readingActive;
  client.identity.readingLabel = readingLabel;
  client.identity.readingUrl = readingUrl;
  if (client.site && rememberSiteLastSeenUrl(client.site, readingUrl)) {
    const nowSave = Date.now();
    if (nowSave - lastSeenUrlSaveAt > LAST_SEEN_SAVE_INTERVAL_MS) {
      lastSeenUrlSaveAt = nowSave;
      saveSites();
    }
  }
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
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;

  identity.x = seatX;
  identity.pose = prop.pose;
  identity.propId = prop.id;
  touchIdentityActivity(identity);

  emitIdentityState(identity);
}

function handleSay(client, message) {
  if (!client.identity) return;
  const site = client.site;
  if (site?.chatDisabled) return;
  if (isMuted(site, client.identity.browserId)) return;
  if (isShadowBlocked(site, client.identity.browserId)) return;

  const now = Date.now();
  if (now - client.lastChatAt < getChatThrottle(site)) return;

  // Scripted abuse joins and immediately chats. A human cannot read the widget
  // and type this fast, so drop messages sent within MIN_HUMAN_SAY_MS of joining.
  if (MIN_HUMAN_SAY_MS > 0 && client.identity.joinedAt && now - client.identity.joinedAt < MIN_HUMAN_SAY_MS) return;

  let text = sanitizeMessage(message.text);
  if (site) text = applyWordFilter(text, site.blockedWords);
  if (!text) return;
  if (registerFloodAction(client)) return;
  if (!allowIpEvent(client, "chat", IP_CHAT_EVENT_LIMIT)) return;

  client.lastChatAt = now;

  const event = pluginContext(client.site, {
    visitor: pluginVisitor(client.identity),
    message: Object.freeze({ text, at: now }),
  });
  if (!plugins.run("onMessage", event)) return;

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

  broadcastIdentity(
    client.scene,
    {
      type: MSG.SAY,
      id: client.identity.id,
      text,
      at: now,
    },
    client.identity,
    { exceptConnectionId: client.connectionId },
  );
}

function handleTyping(client, message) {
  if (!client.identity || typeof message.typing !== "boolean") return;

  const wasTyping = Array.from(client.identity.clients).some((candidate) => candidate.typing);
  const typing = message.typing
    || Array.from(client.identity.clients).some((candidate) => candidate !== client && candidate.typing);
  if (typing === wasTyping) return;
  if (!allowIpEvent(client, "state", IP_STATE_EVENT_LIMIT)) return;

  client.typing = message.typing;
  broadcastIdentity(client.scene, { type: MSG.TYPING, id: client.identity.id, typing }, client.identity);
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

  const pluginMessage = { ...message };
  delete pluginMessage.browserSecret;
  const accepted = plugins.run("onSocketMessage", pluginContext(client.site, {
    visitor: client.identity ? pluginVisitor(client.identity) : null,
    message: Object.freeze(pluginMessage),
  }));
  if (!accepted) return;

  if (!Object.hasOwn(MESSAGE_HANDLERS, message.type)) return;

  if (message.type !== MSG.INIT && message.type !== MSG.SOLVE && !client.joined) return;

  try {
    MESSAGE_HANDLERS[message.type](client, message);
  } catch (error) {
    // Isolate a faulty handler to this one connection rather than letting the
    // throw bubble up and take down every other live socket.
    console.error("Error handling client message", message.type, error);
    try {
      client.ws.close(1011, "internal error");
    } catch {
      // socket already closing/closed
    }
  }
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
    broadcastIdentity(identity.scene, { type: MSG.TYPING, id: identity.id, typing: false }, identity);
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
  const now = Date.now();
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
  pruneIpActivity(now);
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

  if (access.scene.clients.size >= getConnectionLimit(access.site)) {
    ws.close(1013, "full");
    return;
  }

  const ip = getRequestIp(req);
  if (isIpQuarantined(access.scene, ip)) {
    ws.close(1008, "rate limited");
    return;
  }

  // Per-site IP block (set when an admin blocks a visitor). Rejected here, before
  // the connection can join or pick a fresh browserId, so a reconnecting bot
  // cannot evade the block by rotating its client-chosen identity.
  if (access.site && Array.isArray(access.site.blockedIps) && access.site.blockedIps.includes(ip)) {
    console.log(JSON.stringify({ event: "block_ip_reject", at: new Date().toISOString(), site: access.site.siteKey, ip }));
    ws.close(4003, "blocked");
    return;
  }

  const client = createClient(nextConnectionId++, ws, access.scene, access.site, origin || "", ip, access.watch === true);
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

  sitesByKey = loadSites();
  if (sitesMigratedOnLoad) {
    saveSites();
  }

  visitorStats.load();
  visitorStats.start();

  const shared = await import("./public/shared/shared-constants.mjs");
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

  // A failure to bind the port is fatal and must not be swallowed by the
  // uncaughtException guard below — exit so the supervisor can restart.
  server.on("error", (error) => {
    console.error(`TownSquare server error: ${error.message}`);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`TownSquare server running at http://${HOST}:${PORT}`);
  });
}

async function loadSharedModules() {
  const [siteConfig, scenePropsModule, birdPerchesModule, geometry, mapWorldModule, urlModule, protocol] = await Promise.all([
    import("./public/shared/site-config-core.mjs"),
    import("./public/shared/scene-props.mjs"),
    import("./public/shared/bird-perches.mjs"),
    import("./public/shared/scene-prop-geometry.mjs"),
    import("./public/shared/map-world.mjs"),
    import("./public/shared/url.mjs"),
    import("./public/shared/protocol.mjs"),
  ]);

  MSG = protocol.MSG;
  GESTURE = protocol.GESTURE;
  BIRD_ACTION = protocol.BIRD_ACTION;
  // Fail loudly at boot if a handler key drifts from the shared vocabulary.
  for (const type of Object.keys(MESSAGE_HANDLERS)) {
    if (!Object.values(MSG).includes(type)) {
      throw new Error(`MESSAGE_HANDLERS has unknown message type "${type}" (not in shared protocol)`);
    }
  }

  DEFAULT_SITE_SCENE_CONFIG = siteConfig.DEFAULT_SCENE_CONFIG;
  DEFAULT_SITE_STYLE = siteConfig.DEFAULT_SITE_STYLE;
  sanitizeSceneConfig = siteConfig.sanitizeSceneConfig;
  sanitizeConnections = siteConfig.sanitizeConnections;
  sanitizeMessageBoard = siteConfig.sanitizeMessageBoard;
  sanitizeSiteStyle = siteConfig.sanitizeSiteStyle;
  buildSceneProps = siteConfig.buildSceneProps;
  buildBirdPerches = siteConfig.buildBirdPerches;
  buildSiteCss = siteConfig.buildSiteCss;
  isWithinPropSettleZone = geometry.isWithinPropSettleZone;
  validateMapWorld = mapWorldModule.validateMapWorld;
  resolveMapWorld = mapWorldModule.resolveMapWorld;
  normalizeOrigin = urlModule.normalizeAbsoluteOrigin;
  buildAllowedOrigins = urlModule.buildAllowedOrigins;
  getMatchingWwwOrigin = urlModule.getMatchingWwwOrigin;
  ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "");
  mapWorld = loadMapWorld();
  ensureMapWorldGrown();

  PROPS_BY_ID = new Map(scenePropsModule.PROPS.map((prop) => [prop.id, prop]));
  BIRD_PERCHES = birdPerchesModule.BIRD_PERCHES;
}

// Last-resort guards: log and keep running rather than letting an unexpected
// throw/rejection from a non-request code path take down every live connection.
// A request- or message-scoped error is already caught closer to its source.
process.on("uncaughtException", (error) => {
  console.error("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);

  // Persist the throttled visitor-stats buffer; systemd sends SIGTERM on
  // restart/stop and the counts recorded since the last flush would be lost.
  try {
    visitorStats.stop();
    visitorStats.flush();
  } catch (error) {
    console.error("Error flushing visitor stats on shutdown", error);
  }

  // Flush any pending registry write so a debounced save is not lost.
  try {
    flushSites();
  } catch (error) {
    console.error("Error flushing sites on shutdown", error);
  }

  // Stop accepting new sockets, then close the open ones cleanly.
  for (const ws of wss.clients) {
    try {
      ws.close(1001, "server shutting down");
    } catch {
      // already closing
    }
  }
  wss.close();
  server.close(() => process.exit(0));

  // Don't hang forever if a socket refuses to close.
  setTimeout(() => process.exit(0), 5000).unref?.();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch((error) => {
  console.error(`Failed to start TownSquare server: ${error.message}`);
  process.exit(1);
});
