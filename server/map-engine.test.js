const test = require("node:test");
const assert = require("node:assert/strict");

const modulePromise = import("../public/map/map-engine.mjs");

test("computeNetworkStats counts towns, recent activity, and live visitors", async () => {
  const { computeNetworkStats } = await modulePromise;
  const now = Date.parse("2024-06-15T00:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  const sites = [
    { lastSeenAt: now - 2 * DAY_MS, activeVisitors: 3 },
    { lastSeenAt: now - 29 * DAY_MS, activeVisitors: 0 },
    { lastSeenAt: now - 45 * DAY_MS, activeVisitors: 2 },
    { lastSeenAt: 0, activeVisitors: 1 },
  ];

  assert.deepEqual(computeNetworkStats(sites, now), {
    towns: 4,
    activeLast30d: 2,
    visitorsNow: 6,
  });
});

test("computeNetworkStats handles an empty or missing site list", async () => {
  const { computeNetworkStats } = await modulePromise;
  assert.deepEqual(computeNetworkStats([]), { towns: 0, activeLast30d: 0, visitorsNow: 0 });
  assert.deepEqual(computeNetworkStats(undefined), { towns: 0, activeLast30d: 0, visitorsNow: 0 });
});

test("fetchRandomTown rejects a town whose URL is not http(s)", async () => {
  const { fetchRandomTown } = await modulePromise;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ town: { siteKey: "x", name: "X", url: "javascript:alert(1)" } }),
  });
  try {
    const result = await fetchRandomTown("", "http://example.test");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRandomTown returns the town on a valid response", async () => {
  const { fetchRandomTown } = await modulePromise;
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ town: { siteKey: "abc", name: "Mossy Corner", url: "https://mossy.example/" } }),
    };
  };
  try {
    const result = await fetchRandomTown("current-key", "http://example.test");
    assert.deepEqual(result, { siteKey: "abc", name: "Mossy Corner", url: "https://mossy.example/" });
    assert.match(requestedUrl, /^http:\/\/example\.test\/api\/discovery\/random\?siteKey=current-key$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
