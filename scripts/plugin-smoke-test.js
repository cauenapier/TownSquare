"use strict";

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { handleSmokeSocketMessage, withTimeout } = require("./smoke-ws-helpers");

// `let` so the self-contained harness can repoint them at a spawned server.
let HTTP_ORIGIN = process.env.TOWNSQUARE_HTTP_ORIGIN || "http://127.0.0.1:8787";
let WS_URL = process.env.TOWNSQUARE_WS_URL || "ws://127.0.0.1:8787/live";
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", ".data");
const CONNECT_TIMEOUT_MS = Number(process.env.SMOKE_CONNECT_TIMEOUT_MS || 15000);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(origin, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("managed server did not become healthy in time");
}

// Spawn a server with the test-feature contract fixture injected via
// TOWNSQUARE_EXTRA_PLUGINS, so the plugin contract is exercised end-to-end.
async function startManagedServer() {
  const port = await findFreePort();
  const host = "127.0.0.1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "townsquare-plugin-smoke-"));
  const httpOrigin = `http://${host}:${port}`;
  const fixture = path.join(__dirname, "..", "server", "fixtures", "feature-plugin.js");

  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      DATA_DIR: dataDir,
      ALLOWED_ORIGINS: httpOrigin,
      MIN_HUMAN_SAY_MS: "0",
      POW_DIFFICULTY_BITS: process.env.POW_DIFFICULTY_BITS || "1",
      TOWNSQUARE_EXTRA_PLUGINS: fixture,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  HTTP_ORIGIN = httpOrigin;
  WS_URL = `ws://${host}:${port}/live`;
  DATA_DIR = dataDir;

  try {
    await waitForHealth(httpOrigin);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  return () => {
    child.kill("SIGTERM");
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
}

async function post(pathname, body) {
  const response = await fetch(`${HTTP_ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function connect(siteKey) {
  const label = "connect plugin-smoke";
  const promise = new Promise((resolve, reject) => {
    const url = new URL(WS_URL);
    url.searchParams.set("siteKey", siteKey);
    const ws = new WebSocket(url, { headers: { Origin: HTTP_ORIGIN } });
    const seen = [];
    let joined = false;
    ws.on("open", () => ws.send(JSON.stringify({ type: "init", browserId: "plugin-smoke", x: 0.5 })));
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
    (site) => site?.plugins?.["test-feature"]?.hat === "top-hat",
    "plugin data was not persisted",
  );
  assert(savedSite?.plugins?.["test-feature"]?.hat === "top-hat", "plugin data was not persisted");

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
    cleanup?.();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
