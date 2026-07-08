"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  clampPosition,
  sanitizeBrowserId,
  sanitizeBrowserSecret,
  sanitizeBlockedWords,
  parseOptionalEmail,
  MAX_BROWSER_ID_LEN,
  MAX_BLOCKED_WORDS,
} = require("./sanitize");

test("clampPosition accepts 0..1 and rejects everything else", () => {
  assert.equal(clampPosition(0), 0);
  assert.equal(clampPosition(1), 1);
  assert.equal(clampPosition(0.5), 0.5);
  assert.equal(clampPosition(-0.01), null);
  assert.equal(clampPosition(1.01), null);
  assert.equal(clampPosition(NaN), null);
  assert.equal(clampPosition("0.5"), null, "non-number rejected");
  assert.equal(clampPosition(undefined), null);
});

test("sanitizeBrowserId strips disallowed chars and caps length", () => {
  assert.equal(sanitizeBrowserId("abc_DEF-123"), "abc_DEF-123");
  assert.equal(sanitizeBrowserId("a b!c@d.e"), "abcde");
  assert.equal(sanitizeBrowserId(42), "");
  assert.equal(sanitizeBrowserId("x".repeat(200)).length, MAX_BROWSER_ID_LEN);
});

test("sanitizeBrowserSecret keeps hex only and caps length", () => {
  assert.equal(sanitizeBrowserSecret("DEADbeef00"), "DEADbeef00");
  assert.equal(sanitizeBrowserSecret("xyz123ghij"), "123");
  assert.equal(sanitizeBrowserSecret(null), "");
  assert.equal(sanitizeBrowserSecret("a".repeat(100)).length, 64);
});

test("sanitizeBlockedWords trims, lowercases, de-dupes, and caps", () => {
  assert.deepEqual(sanitizeBlockedWords([" Foo ", "foo", "BAR"]), ["foo", "bar"]);
  assert.deepEqual(sanitizeBlockedWords(["", "  ", 7, null]), []);
  assert.deepEqual(sanitizeBlockedWords("not an array"), []);
  const many = Array.from({ length: MAX_BLOCKED_WORDS + 20 }, (_, i) => `w${i}`);
  assert.equal(sanitizeBlockedWords(many).length, MAX_BLOCKED_WORDS);
});

test("parseOptionalEmail treats empty as valid-null and validates shape", () => {
  assert.deepEqual(parseOptionalEmail(""), { ok: true, email: null });
  assert.deepEqual(parseOptionalEmail("   "), { ok: true, email: null });
  assert.deepEqual(parseOptionalEmail(undefined), { ok: true, email: null });
  assert.deepEqual(parseOptionalEmail("a@b.co"), { ok: true, email: "a@b.co" });
  assert.deepEqual(parseOptionalEmail(" a@b.co "), { ok: true, email: "a@b.co" });
  assert.deepEqual(parseOptionalEmail("nope"), { ok: false, email: null });
  assert.deepEqual(parseOptionalEmail("a@b@c"), { ok: false, email: null });
});
