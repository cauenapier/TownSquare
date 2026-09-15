"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { selectRandomTown } = require("./discovery");

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

test("random town excludes the current site and invalid destinations", () => {
  const selected = selectRandomTown([
    { siteKey: "current", name: "Here", origin: "https://here.example", lastSeenAt: NOW },
    { siteKey: "invalid", name: "Nope", origin: "javascript:alert(1)", lastSeenAt: NOW },
    { siteKey: "other", name: "Elsewhere", origin: "https://elsewhere.example", lastSeenAt: NOW },
  ], { excludeSiteKey: "current", now: NOW, random: () => 0 });

  assert.deepEqual(selected, {
    siteKey: "other",
    name: "Elsewhere",
    url: "https://elsewhere.example/",
  });
});

test("random town returns null when no valid alternative exists", () => {
  assert.equal(selectRandomTown([
    { siteKey: "current", origin: "https://here.example" },
    { siteKey: "bad", origin: "mailto:hello@example.com" },
  ], { excludeSiteKey: "current" }), null);
});

test("weighted draw prefers recent and currently active towns", () => {
  const quiet = { siteKey: "quiet", origin: "https://quiet.example", lastSeenAt: NOW - 50 * DAY_MS };
  const lively = { siteKey: "lively", origin: "https://lively.example", lastSeenAt: NOW, activeVisitors: 1 };

  assert.equal(
    selectRandomTown([quiet, lively], { now: NOW, random: () => 0.2 }).siteKey,
    "lively",
  );
  assert.equal(
    selectRandomTown([quiet, lively], { now: NOW, random: () => 0 }).siteKey,
    "quiet",
    "every eligible town should retain a non-zero chance",
  );
});
