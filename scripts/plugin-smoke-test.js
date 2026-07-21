"use strict";

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { startManagedServer: createManagedServer } = require("./lib/managed-server");
const { handleSmokeSocketMessage, withTimeout } = require("./smoke-ws-helpers");

// `let` so the self-contained harness can repoint them at a spawned server.
let HTTP_ORIGIN = process.env.TOWNSQUARE_HTTP_ORIGIN || "http://127.0.0.1:8787";
let WS_URL = process.env.TOWNSQUARE_WS_URL || "ws://127.0.0.1:8787/live";
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", ".data");
const CONNECT_TIMEOUT_MS = Number(process.env.SMOKE_CONNECT_TIMEOUT_MS || 15000);

// Spawn a server with the test-feature contract fixture injected via
// TOWNSQUARE_EXTRA_PLUGINS, so the plugin contract is exercised end-to-end.
async function startManagedServer() {
  const fixture = path.join(__dirname, "..", "server", "fixtures", "feature-plugin.js");
  const managed = await createManagedServer({
    dataPrefix: "townsquare-plugin-smoke-",
    env: {
      MIN_HUMAN_SAY_MS: "0",
      POW_DIFFICULTY_BITS: process.env.POW_DIFFICULTY_BITS || "1",
      TOWNSQUARE_EXTRA_PLUGINS: fixture,
    },
  });

  HTTP_ORIGIN = managed.httpOrigin;
  WS_URL = `${managed.wsOrigin}/live`;
  DATA_DIR = managed.dataDir;
  return managed.cleanup;
}

async function post(pathname, body) {
  const response = await fetch(`${HTTP_ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function connect(siteKey, { browserId = "plugin-smoke", x = 0.5 } = {}) {
  const label = "connect plugin-smoke";
  const promise = new Promise((resolve, reject) => {
    const url = new URL(WS_URL);
    url.searchParams.set("siteKey", siteKey);
    const ws = new WebSocket(url, { headers: { Origin: HTTP_ORIGIN } });
    const seen = [];
    let joined = false;
    ws.on("open", () => ws.send(JSON.stringify({ type: "init", browserId, x })));
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch (error) {
        reject(error);
        return;
      }
      try {
        handleSmokeSocketMessage(ws, message, {
          seen,
          onHello: (hello) => {
            joined = true;
            resolve({ ws, seen, hello });
          },
        });
      } catch (error) {
        reject(error);
      }
    });
    ws.on("error", reject);
    ws.on("close", (code, reason) => {
      if (!joined) {
        reject(new Error(`${label} closed before hello (${code}: ${String(reason)})`));
      }
    });
  });
  return withTimeout(promise, CONNECT_TIMEOUT_MS, label);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForValue(read, predicate, message, { timeout = 2500, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(message);
}

async function main() {
  const registration = await post("/api/sites", { name: "Plugin smoke", origin: HTTP_ORIGIN });
  assert(registration.response.ok, registration.body.error || "site registration failed");
  const { siteKey } = registration.body.site;
  const { adminToken } = registration.body;

  const visitor = await connect(siteKey);
  assert(
    visitor.hello.pluginModules?.some((entry) => entry.name === "test-feature"),
    "hello did not include the widget module",
  );
  assert(visitor.hello.plugins?.["test-feature"]?.hat === "none", "hello did not include visitor plugin data");

  const before = await post("/api/admin/site", { siteKey, adminToken });
  assert(before.response.ok, before.body.error || "admin load failed");
  assert(
    before.body.pluginModules?.some((entry) => entry.name === "test-feature"),
    "admin response did not include the admin module",
  );
  assert(
    before.body.addons?.some((entry) => entry.name === "test-labelled" && entry.enabled === false),
    "admin response did not include the disabled add-on catalogue",
  );
  const labelledBeforeToggle = await post("/api/admin/action", {
    siteKey,
    adminToken,
    plugin: "test-labelled",
    action: "update",
    input: { value: "before-toggle" },
  });
  assert(labelledBeforeToggle.response.status === 400, "labelled plugin action should be rejected while disabled");

  const toggleLabelled = await post("/api/admin/action", {
    siteKey,
    adminToken,
    action: "setPluginEnabled",
    name: "test-labelled",
    enabled: true,
  });
  assert(toggleLabelled.response.ok, toggleLabelled.body.error || "labelled plugin toggle failed");

  const labelledAfterToggle = await post("/api/admin/action", {
    siteKey,
    adminToken,
    plugin: "test-labelled",
    action: "update",
    input: { value: "after-toggle" },
  });
  assert(labelledAfterToggle.response.ok, labelledAfterToggle.body.error || "labelled plugin action failed after toggle");
  assert(
    labelledAfterToggle.body.plugins?.["test-labelled"]?.value === "after-toggle",
    "labelled plugin action data was not returned after toggle",
  );
  assert(
    labelledAfterToggle.body.addons?.some((entry) => entry.name === "test-labelled" && entry.enabled === true),
    "enabled add-on disappeared from the catalogue",
  );

  const toggleEntity = await post("/api/admin/action", {
    siteKey,
    adminToken,
    action: "setPluginEnabled",
    name: "test-scene-entity",
    enabled: true,
  });
  assert(toggleEntity.response.ok, toggleEntity.body.error || "scene-entity toggle failed");
  await waitForValue(
    () => visitor.seen.find((message) => (
      message.type === "plugins"
      && message.pluginModules?.some((entry) => entry.name === "test-scene-entity")
      && message.pluginEntities?.["test-scene-entity"]?.moves === 0
    )),
    Boolean,
    "live toggle did not send the scene-entity module and snapshot",
  );

  visitor.ws.send(JSON.stringify({ type: "move", x: 0.6 }));
  await waitForValue(
    () => visitor.seen.find((message) => (
      message.type === "plugin"
      && message.plugin === "test-scene-entity"
      && message.moves === 1
    )),
    Boolean,
    "scene-entity move hook did not broadcast a frame",
  );

  const disableEntity = await post("/api/admin/action", {
    siteKey,
    adminToken,
    action: "setPluginEnabled",
    name: "test-scene-entity",
    enabled: false,
  });
  assert(disableEntity.response.ok, disableEntity.body.error || "scene-entity disable failed");
  await waitForValue(
    () => visitor.seen.find((message) => (
      message.type === "plugins"
      && !message.pluginModules?.some((entry) => entry.name === "test-scene-entity")
      && !Object.hasOwn(message.pluginEntities || {}, "test-scene-entity")
    )),
    Boolean,
    "live toggle did not remove the scene-entity module and state",
  );

  const updated = await post("/api/admin/action", {
    siteKey,
    adminToken,
    plugin: "test-feature",
    action: "update",
    input: { hat: "top-hat" },
  });
  assert(updated.response.ok, updated.body.error || "plugin action failed");
  assert(updated.body.plugins?.["test-feature"]?.hat === "top-hat", "admin extension did not update");

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(
    visitor.seen.some((message) => (
      message.type === "profile" && message.plugins?.["test-feature"]?.hat === "top-hat"
    )),
    "plugin action did not broadcast updated visitor data",
  );

  visitor.ws.send(JSON.stringify({
    type: "plugin",
    plugin: "test-feature",
    action: "store",
    value: "from-socket",
  }));
  await waitForValue(
    () => visitor.seen.find((message) => (
      message.type === "plugin"
      && message.plugin === "test-feature"
      && message.action === "stored"
      && message.value === "from-socket"
    )),
    Boolean,
    "socket plugin could not persist data and broadcast a scoped frame",
  );

  const mover = await connect(siteKey, { browserId: "plugin-smoke-mover", x: 0.25 });
  const joinForMover = await waitForValue(
    () => visitor.seen.find((message) => message.type === "join" && message.peer?.id === mover.hello.id),
    (message) => message?.peer?.plugins?.["test-feature"]?.hat === "top-hat",
    "join did not include plugin data for mover",
  );
  assert(joinForMover.peer.plugins?.["test-feature"]?.hat === "top-hat", "join did not include plugin data for mover");

  mover.ws.send(JSON.stringify({ type: "move", x: 0.75 }));
  const moveForMover = await waitForValue(
    () => visitor.seen.find((message) => message.type === "move" && message.id === mover.hello.id && message.x === 0.75),
    (message) => message && !Object.hasOwn(message, "plugins"),
    "move included plugin data or did not arrive",
  );
  assert(!Object.hasOwn(moveForMover, "plugins"), "move should not include plugin data");
  mover.ws.close();

  // Registry writes are debounced (~1s), so poll for the eventual persist
  // rather than reading the file immediately.
  const savedSite = await waitForValue(
    () => {
      try {
        const persisted = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sites.json"), "utf8"));
        return persisted.sites.find((site) => site.siteKey === siteKey);
      } catch {
        return null;
      }
    },
    (site) => (
      site?.plugins?.["test-feature"]?.hat === "top-hat"
      && site.plugins["test-feature"].socketValue === "from-socket"
    ),
    "plugin data was not persisted",
  );
  assert(savedSite?.plugins?.["test-feature"]?.hat === "top-hat", "plugin data was not persisted");
  assert(savedSite.plugins["test-feature"].socketValue === "from-socket", "socket plugin data was not persisted");

  visitor.ws.close();
  console.log("Plugin smoke test passed.");
}

async function run() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  if (!external && !process.env.POW_DIFFICULTY_BITS) process.env.POW_DIFFICULTY_BITS = "1";
  const cleanup = external ? null : await startManagedServer();
  try {
    await main();
  } finally {
    await cleanup?.();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
