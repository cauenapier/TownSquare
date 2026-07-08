"use strict";

// In-memory admin session store. A successful admin-token login mints a session
// whose id is handed to the browser in an HttpOnly cookie, so the raw admin
// token is never persisted in JS-readable storage nor resent in every request
// body. Sessions are ephemeral by design (lost on restart, like presence state).
//
// Pure and clock/RNG-injectable so the expiry + capacity logic is unit tested
// in isolation (see server/admin-sessions.test.js).

const crypto = require("crypto");

const COOKIE_NAME = "ts_admin";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h for a plain login
const DEFAULT_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d for "remember me"
const DEFAULT_MAX_SESSIONS = 50000; // bound memory; oldest are evicted past this

// Parse a Cookie request header into a name→value map (values URL-decoded).
function parseCookies(header) {
  const out = {};
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

function createAdminSessionStore({
  ttlMs = DEFAULT_TTL_MS,
  rememberTtlMs = DEFAULT_REMEMBER_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  now = () => Date.now(),
  generateId = () => crypto.randomBytes(24).toString("base64url"),
} = {}) {
  const sessions = new Map(); // id -> { siteKey, expiresAt }

  function prune() {
    const t = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= t) sessions.delete(id);
    }
    // Insertion order ≈ expiry order, so dropping from the front evicts the
    // longest-lived-but-oldest sessions first when over capacity.
    while (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  return {
    cookieName: COOKIE_NAME,

    // Create a session for siteKey and return its id + cookie lifetime.
    create(siteKey, { remember = false } = {}) {
      prune();
      const id = generateId();
      const maxAgeMs = remember ? rememberTtlMs : ttlMs;
      sessions.set(id, { siteKey, expiresAt: now() + maxAgeMs });
      return { id, maxAgeMs };
    },

    // Resolve a session id to its (still-valid) record, or null. Expired
    // sessions are dropped on access.
    get(id) {
      if (typeof id !== "string" || !id) return null;
      const session = sessions.get(id);
      if (!session) return null;
      if (session.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }
      return { siteKey: session.siteKey, expiresAt: session.expiresAt };
    },

    destroy(id) {
      return sessions.delete(id);
    },

    // Drop every session for a site (used when a site's token is reset/deleted).
    destroyForSite(siteKey) {
      for (const [id, session] of sessions) {
        if (session.siteKey === siteKey) sessions.delete(id);
      }
    },

    get size() {
      return sessions.size;
    },
  };
}

module.exports = { createAdminSessionStore, parseCookies, COOKIE_NAME };
