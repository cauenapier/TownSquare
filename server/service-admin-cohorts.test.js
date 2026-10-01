"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const NOW = Date.UTC(2026, 9, 15, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

async function buildCohorts(sites, options = {}) {
  const { buildVerifiedSiteCohorts } = await import("../public/admin/hosted/service-admin-cohorts.mjs");
  return buildVerifiedSiteCohorts(sites, { now: NOW, ...options });
}

test("groups enabled verified sites by verification month and current 30-day activity", async () => {
  const result = await buildCohorts([
    { verifiedAt: Date.UTC(2026, 8, 2), visitorStats: { monthly: 4 } },
    { verifiedAt: Date.UTC(2026, 8, 1), visitorStats: { monthly: 0 } },
    { verifiedAt: NOW - 10 * DAY_MS, visitorStats: { monthly: 0 } },
    { verifiedAt: Date.UTC(2025, 0, 1), visitorStats: { monthly: 2 } },
  ], { monthCount: 3 });

  assert.deepEqual(result.cohorts.map(({ key, active, inactive, new: recent, total }) => ({
    key, active, inactive, new: recent, total,
  })), [
    { key: "earlier", active: 1, inactive: 0, new: 0, total: 1 },
    { key: "2026-09", active: 1, inactive: 1, new: 0, total: 2 },
    { key: "2026-10", active: 0, inactive: 0, new: 1, total: 1 },
  ]);
  assert.deepEqual(result.totals, { active: 2, inactive: 1, new: 1, total: 4 });
  assert.equal(result.retentionRate, 2 / 3);
});

test("excludes disabled and unverified sites from retention", async () => {
  const result = await buildCohorts([
    { verifiedAt: NOW - 90 * DAY_MS, disabled: true, visitorStats: { monthly: 0 } },
    { verifiedAt: null, visitorStats: { monthly: 8 } },
  ]);

  assert.deepEqual(result.cohorts, []);
  assert.deepEqual(result.totals, { active: 0, inactive: 0, new: 0, total: 0 });
  assert.equal(result.retentionRate, null);
});

test("gives quiet sites the full 30-day opportunity window", async () => {
  const result = await buildCohorts([
    { verifiedAt: NOW - 30 * DAY_MS, visitorStats: { monthly: 0 } },
    { verifiedAt: NOW - 30 * DAY_MS - 1, visitorStats: { monthly: 0 } },
  ], { monthCount: 2 });

  assert.equal(result.totals.new, 1);
  assert.equal(result.totals.inactive, 1);
});
