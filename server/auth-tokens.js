"use strict";

// Pure, dependency-free admin-token + credential helpers extracted from
// server.js so the security-sensitive comparison logic can be unit tested in
// isolation (see server/auth-tokens.test.js). Depends only on `crypto`.

const crypto = require("crypto");

// Generate a random, URL-safe opaque token with a human-readable prefix.
function createToken(prefix, bytes = 18) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

// Hash an admin token for storage: `sha256:<salt>:<digest>`. A random salt is
// generated unless one is supplied (re-supply the stored salt to verify).
function hashAdminToken(adminToken, salt = crypto.randomBytes(16).toString("base64url")) {
  const digest = crypto.createHash("sha256").update(`${salt}:${adminToken}`).digest("base64url");
  return `sha256:${salt}:${digest}`;
}

// Constant-time string comparison that also rejects empty/length-mismatched
// inputs (timingSafeEqual throws on unequal lengths, so guard first).
function tokensMatch(expected, provided) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(provided || ""));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Verify a presented admin token against a site record. Prefers the salted
// hash; falls back to a legacy plaintext `adminToken` for un-migrated records.
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

module.exports = { createToken, hashAdminToken, tokensMatch, adminTokenMatches };
