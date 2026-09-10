const test = require("node:test");
const assert = require("node:assert/strict");

const { mapSiteLifecycle } = require("./map-site-lifecycle");

const NOW = Date.UTC(2026, 8, 10, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

function siteInactiveFor(days) {
  return { verifiedAt: NOW - 100 * DAY_MS, lastSeenAt: NOW - days * DAY_MS };
}

test("map sites remain fully visible through their first 30 inactive days", () => {
  assert.deepEqual(mapSiteLifecycle(siteInactiveFor(30), NOW), {
    inactiveDays: 30,
    inactiveFor30Days: false,
    hiddenForInactivity: false,
    fadeProgress: 0,
  });
});

test("map sites fade progressively between 30 and 60 inactive days", () => {
  assert.deepEqual(mapSiteLifecycle(siteInactiveFor(45), NOW), {
    inactiveDays: 45,
    inactiveFor30Days: true,
    hiddenForInactivity: false,
    fadeProgress: 0.5,
  });
});

test("map sites disappear at 60 inactive days", () => {
  assert.deepEqual(mapSiteLifecycle(siteInactiveFor(60), NOW), {
    inactiveDays: 60,
    inactiveFor30Days: true,
    hiddenForInactivity: true,
    fadeProgress: 1,
  });
});

test("legacy sites fall back to their verification date", () => {
  const lifecycle = mapSiteLifecycle({ verifiedAt: NOW - 40 * DAY_MS, lastSeenAt: null }, NOW);
  assert.equal(lifecycle.inactiveDays, 40);
  assert.equal(lifecycle.inactiveFor30Days, true);
  assert.equal(lifecycle.hiddenForInactivity, false);
});
