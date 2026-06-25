"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createToken, hashAdminToken, tokensMatch, adminTokenMatches } = require("./auth-tokens");

test("createToken produces a prefixed, URL-safe, unique token", () => {
  const a = createToken("admin", 24);
  const b = createToken("admin", 24);
  assert.match(a, /^admin_[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, "tokens must be random");
});

test("hashAdminToken is deterministic for a fixed salt and varies by salt", () => {
  const fixed = hashAdminToken("secret", "salt123");
  assert.equal(fixed, hashAdminToken("secret", "salt123"));
  assert.equal(fixed, "sha256:salt123:" + fixed.split(":")[2]);
  assert.notEqual(fixed, hashAdminToken("secret", "salt124"));
  assert.notEqual(fixed, hashAdminToken("other", "salt123"));
});

test("hashAdminToken generates a random salt when none is supplied", () => {
  const one = hashAdminToken("secret");
  const two = hashAdminToken("secret");
  assert.notEqual(one, two, "independent salts must yield different hashes");
});

test("tokensMatch is true only for identical non-empty strings", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch("abc", "abcd"), false, "length mismatch must not throw");
  assert.equal(tokensMatch("", ""), false, "empty must never match");
  assert.equal(tokensMatch(null, undefined), false);
});

test("adminTokenMatches verifies a salted-hash site record", () => {
  const token = createToken("admin", 24);
  const site = { adminTokenHash: hashAdminToken(token) };
  assert.equal(adminTokenMatches(site, token), true);
  assert.equal(adminTokenMatches(site, token + "x"), false);
  assert.equal(adminTokenMatches(site, "  " + token + "  "), true, "trims whitespace");
});

test("adminTokenMatches falls back to legacy plaintext adminToken", () => {
  const site = { adminToken: "legacy-plain-token" };
  assert.equal(adminTokenMatches(site, "legacy-plain-token"), true);
  assert.equal(adminTokenMatches(site, "wrong"), false);
});

test("adminTokenMatches rejects malformed input and hashes", () => {
  assert.equal(adminTokenMatches(null, "x"), false);
  assert.equal(adminTokenMatches({ adminTokenHash: "sha256:" }, "x"), false, "missing salt");
  assert.equal(adminTokenMatches({ adminTokenHash: "md5:s:d" }, "x"), false, "wrong algorithm");
  assert.equal(adminTokenMatches({}, ""), false, "empty token");
  assert.equal(adminTokenMatches({ adminTokenHash: hashAdminToken("t") }, 123), false, "non-string token");
});
