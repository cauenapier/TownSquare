"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { startManagedServer } = require("../scripts/lib/managed-server");
const { SITE_REGISTRY_VERSION } = require("./sites-store");

const DAY_MS = 24 * 60 * 60 * 1000;

function site(siteKey, overrides = {}) {
  const now = Date.now();
  const origin = `https://${siteKey}.example`;
  return {
    siteKey,
    name: siteKey,
    origin,
    allowedOrigins: [origin],
    verifiedAt: now,
    lastSeenAt: now,
    disabled: false,
    hiddenFromMap: false,
    ...overrides,
  };
}

async function serverWithSites(sites) {
  return startManagedServer({
    dataPrefix: "townsquare-discovery-http-",
    env: ({ dataDir }) => {
      fs.writeFileSync(
        path.join(dataDir, "sites.json"),
        JSON.stringify({ version: SITE_REGISTRY_VERSION, sites }),
        { mode: 0o600 },
      );
      return { SERVICE_ADMIN_PASSWORD: "discovery-test-password" };
    },
    captureOutput: true,
  });
}

test("random discovery uses public-map eligibility and excludes the current site", async () => {
  const managed = await serverWithSites([
    site("current"),
    site("eligible"),
    site("hidden", { hiddenFromMap: true }),
    site("disabled", { disabled: true }),
    site("inactive", { lastSeenAt: Date.now() - 61 * DAY_MS }),
  ]);

  try {
    const url = new URL("/api/discovery/random", managed.httpOrigin);
    url.searchParams.set("siteKey", "current");
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(body, {
      town: {
        siteKey: "eligible",
        name: "eligible",
        url: "https://eligible.example/",
      },
    });
  } finally {
    await managed.cleanup();
  }
});

test("random discovery returns a graceful empty state", async () => {
  const managed = await serverWithSites([site("only")]);
  try {
    const response = await fetch(`${managed.httpOrigin}/api/discovery/random?siteKey=only`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "No other public towns are available right now.",
    });
  } finally {
    await managed.cleanup();
  }
});

test("discovery analytics retain only allowed aggregate events", async () => {
  const managed = await serverWithSites([site("source")]);
  try {
    const report = (event) => fetch(`${managed.httpOrigin}/api/discovery/event`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ siteKey: "source", event, visitorId: "must-not-be-stored" }),
    });
    for (const event of [
      "discovery_menu_opened",
      "random_town_clicked",
      "build_townsquare_clicked",
      "map_clicked",
      "about_clicked",
      "not_allowed",
    ]) {
      assert.equal((await report(event)).status, 204);
    }

    const response = await fetch(`${managed.httpOrigin}/api/service-admin/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "discovery-test-password" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    const events = body.sites[0].discoveryEvents;
    assert.deepEqual(Object.keys(events).sort(), [
      "about_clicked",
      "build_townsquare_clicked",
      "discovery_menu_opened",
      "map_clicked",
      "random_town_clicked",
    ]);
    assert.ok(Object.values(events).every((entry) => entry.count === 1 && entry.lastAt > 0));
    assert.equal(JSON.stringify(events).includes("visitorId"), false);
  } finally {
    await managed.cleanup();
  }
});
