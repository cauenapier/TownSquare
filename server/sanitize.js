"use strict";

// Pure input sanitizers/validators extracted from server.js so the untrusted-
// input handling can be unit tested in isolation (see server/sanitize.test.js).
// Only functions whose limits are static constants live here; sanitizers that
// depend on runtime-loaded shared constants stay in server.js.

const MAX_BROWSER_ID_LEN = 80;
const MAX_BROWSER_SECRET_LEN = 64;
const MAX_EMAIL_LEN = 254;
const MAX_BLOCKED_WORD_LEN = 40;
const MAX_BLOCKED_WORDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A normalized 0..1 position, or null if out of range / not a finite number.
function clampPosition(x) {
  if (typeof x !== "number" || Number.isNaN(x)) return null;
  if (x < 0 || x > 1) return null;
  return x;
}

// Opaque browser identifier: capped length, restricted to URL-safe id chars.
function sanitizeBrowserId(browserId) {
  if (typeof browserId !== "string") return "";
  return browserId.slice(0, MAX_BROWSER_ID_LEN).replace(/[^a-zA-Z0-9_-]/g, "");
}

// Browser reconnect secret: capped length, hex only.
function sanitizeBrowserSecret(browserSecret) {
  if (typeof browserSecret !== "string") return "";
  return browserSecret.slice(0, MAX_BROWSER_SECRET_LEN).replace(/[^a-f0-9]/gi, "");
}

/** A site's forbidden-word list: trimmed, lowercased, de-duped, capped. */
function sanitizeBlockedWords(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const words = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const word = raw.trim().toLowerCase().slice(0, MAX_BLOCKED_WORD_LEN);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length >= MAX_BLOCKED_WORDS) break;
  }
  return words;
}

// Optional email: empty is valid (null), otherwise must match a basic shape.
function parseOptionalEmail(email) {
  const clean = typeof email === "string" ? email.trim().slice(0, MAX_EMAIL_LEN) : "";
  if (!clean) return { ok: true, email: null };
  if (!EMAIL_RE.test(clean)) return { ok: false, email: null };
  return { ok: true, email: clean };
}

module.exports = {
  clampPosition,
  sanitizeBrowserId,
  sanitizeBrowserSecret,
  sanitizeBlockedWords,
  parseOptionalEmail,
  MAX_BROWSER_ID_LEN,
  MAX_BROWSER_SECRET_LEN,
  MAX_EMAIL_LEN,
  MAX_BLOCKED_WORD_LEN,
  MAX_BLOCKED_WORDS,
};
