const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const SERVER_URL = process.env.TOWNSQUARE_WS_URL || "ws://127.0.0.1:8787/live";
const HTTP_ORIGIN = process.env.TOWNSQUARE_HTTP_ORIGIN || "http://127.0.0.1:8787";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", ".data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const SERVICE_ADMIN_PASSWORD = process.env.SERVICE_ADMIN_PASSWORD || "";
const AUTH_FAILURES_PER_HOUR = Number(process.env.AUTH_FAILURES_PER_HOUR || 30);

function siteSocketUrl(siteKey) {
  if (!siteKey) return SERVER_URL;
  const url = new URL(SERVER_URL);
  url.searchParams.set("siteKey", siteKey);
  return url.toString();
}

function connect({ x, browserId, siteKey = "", origin = "", displayName = "", color = "", readingLabel, readingUrl, readingActive, sceneConfig }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(siteSocketUrl(siteKey), origin ? { headers: { Origin: origin } } : undefined);
    const seen = [];

    ws.on("open", () => {
      const init = { type: "init", x, browserId, displayName, color };
      if (typeof readingLabel === "string") init.readingLabel = readingLabel;
      if (typeof readingUrl === "string") init.readingUrl = readingUrl;
      if (typeof readingActive === "boolean") init.readingActive = readingActive;
      if (sceneConfig) init.sceneConfig = sceneConfig;
      ws.send(JSON.stringify(init));
    });

    ws.on("message", (buffer) => {
      const message = JSON.parse(String(buffer));
      seen.push(message);
      if (message.type === "hello") {
        resolve({ ws, seen, id: message.id, hello: message });
      }
    });

    ws.on("error", reject);
  });
}

async function createSite(name) {
  const response = await fetch(`${HTTP_ORIGIN}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      origin: HTTP_ORIGIN,
      sceneConfig: {
        benches: 1,
        benchXs: [0.14],
        trees: 2,
        treeXs: [0.33, 0.81],
        lamps: 1,
        lampXs: [0.62],
        birds: 2,
      },
      styleConfig: {
        scene: "#e6dfd3",
        page: "#f5efe7",
        surface: "#fffaf6",
        ink: "#2d2926",
        accent: "#9d5c2f",
      },
    }),
  });
  const body = await response.json();
  assert(response.ok, body.error || "site registration failed");
  assert(body.site.siteKey, "registered site did not include a site key");
  assert(body.adminToken, "registered site did not include an admin token");
  assert(body.styleSnippet.includes("#townsquare-root"), "registered site did not include a style snippet");
  assert(body.site.sceneConfig?.birds === 2, "registered site did not persist scene config");
  assert(body.site.sceneConfig?.benchXs?.[0] === 0.14, "registered site did not persist bench placement");
  assert(body.site.sceneConfig?.treeXs?.[1] === 0.81, "registered site did not persist tree placement");
  assert(body.site.styleConfig?.accent === "#9d5c2f", "registered site did not persist style config");
  return body;
}

async function loginWithAdminToken(adminToken) {
  const response = await fetch(`${HTTP_ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminToken }),
  });
  const body = await response.json();
  assert(response.ok, body.error || "admin token login failed");
  assert(body.site.siteKey, "admin token login did not return a site");
  const adminUrl = new URL(body.adminUrl);
  assert(adminUrl.searchParams.get("adminToken") === null, "admin URL leaked the token in query params");
  assert(adminUrl.hash.includes("adminToken="), "admin token login did not return a fragment admin URL");
  return body;
}

async function adminSiteApi(siteKey, adminToken) {
  const { response, body } = await postJson("/api/admin/site", { siteKey, adminToken });
  assert(response.ok, body.error || "site admin request failed");
  assert(body.styleSnippet.includes("--you"), "site admin did not return style snippet");
  assert(typeof body.site.sceneConfig?.benches === "number", "site admin did not return scene config");
  return body;
}

async function adminActionApi(siteKey, adminToken, action, payload = {}) {
  const { response, body } = await postJson("/api/admin/action", {
    siteKey,
    adminToken,
    action,
    ...payload,
  });
  assert(response.ok, body.error || `site admin action failed: ${action}`);
  return body;
}

async function assertAdminCustomizationCanBeUpdated(hostedSite) {
  const updated = await adminActionApi(hostedSite.site.siteKey, hostedSite.adminToken, "updateCustomization", {
    sceneConfig: {
      benches: 4,
      benchXs: [0.12, 0.31, 0.68, 0.9],
      trees: 1,
      treeXs: [0.44],
      lamps: 2,
      lampXs: [0.2, 0.8],
      birds: 5,
    },
    styleConfig: {
      scene: "#d9d0c5",
      page: "#f6efe7",
      surface: "#fff8f1",
      ink: "#2f2925",
      accent: "#336699",
    },
  });

  assert(updated.site.sceneConfig?.benches === 4, "admin customization did not update scene config");
  assert(updated.site.sceneConfig?.birds === 5, "admin customization did not update bird count");
  assert(updated.site.sceneConfig?.benchXs?.[2] === 0.68, "admin customization did not update bench placement");
  assert(updated.site.sceneConfig?.lampXs?.[1] === 0.8, "admin customization did not update lamp placement");
  assert(updated.site.styleConfig?.accent === "#336699", "admin customization did not update accent color");

  const refreshed = await adminSiteApi(hostedSite.site.siteKey, hostedSite.adminToken);
  assert(refreshed.embedSnippet.includes('"benches":4'), "refreshed embed snippet did not include updated benches");
  assert(refreshed.embedSnippet.includes('"benchXs":[0.12,0.31,0.68,0.9]'), "refreshed embed snippet did not include updated bench positions");
  assert(refreshed.embedSnippet.includes('"birds":5'), "refreshed embed snippet did not include updated birds");
  assert(refreshed.styleSnippet.includes("#336699"), "refreshed style snippet did not include updated accent color");
}

async function loginShouldFailWithAdminToken(adminToken) {
  const response = await fetch(`${HTTP_ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminToken }),
  });
  assert(response.status === 403, "old admin token still worked after reset");
}

async function postJson(pathname, payload = {}) {
  const response = await fetch(`${HTTP_ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

async function serviceAdminApi(pathname, payload = {}) {
  const { response, body } = await postJson(pathname, { password: SERVICE_ADMIN_PASSWORD, ...payload });
  assert(response.ok, body.error || "service admin request failed");
  return body;
}

async function assertAuthFailuresAreThrottled(hostedSite) {
  if (AUTH_FAILURES_PER_HOUR <= 0) return;

  for (let attempt = 0; attempt < AUTH_FAILURES_PER_HOUR; attempt += 1) {
    const { response } = await postJson("/api/admin/login", { adminToken: `bad-token-${attempt}` });
    assert(response.status === 403, "admin auth failure throttled too early");
  }

  const blockedAdmin = await postJson("/api/admin/login", { adminToken: "bad-token-blocked" });
  assert(blockedAdmin.response.status === 429, "admin auth failures did not throttle by IP");

  const blockedValidAdmin = await postJson("/api/admin/login", { adminToken: hostedSite.adminToken });
  assert(blockedValidAdmin.response.status === 429, "admin auth throttle did not block the IP");
}

async function assertServiceAdminFailuresAreThrottled() {
  if (!SERVICE_ADMIN_PASSWORD || AUTH_FAILURES_PER_HOUR <= 0) return;

  for (let attempt = 0; attempt < AUTH_FAILURES_PER_HOUR; attempt += 1) {
    const { response } = await postJson("/api/service-admin/sites", { password: SERVICE_ADMIN_PASSWORD });
    assert(response.ok, "valid service admin auth did not clear prior auth failures");
  }

  for (let attempt = 0; attempt < AUTH_FAILURES_PER_HOUR; attempt += 1) {
    const { response } = await postJson("/api/service-admin/sites", { password: `bad-password-${attempt}` });
    assert(response.status === 403, "service admin auth failure throttled too early");
  }

  const blockedServiceAdmin = await postJson("/api/service-admin/sites", { password: "bad-password-blocked" });
  assert(blockedServiceAdmin.response.status === 429, "service admin auth failures did not throttle by IP");
}

function assertAdminTokenStoredAsHash(siteKey, adminToken) {
  const raw = fs.readFileSync(SITES_FILE, "utf8");
  assert(!raw.includes(adminToken), "site registry persisted the plaintext admin token");

  const parsed = JSON.parse(raw);
  const site = parsed.sites.find((record) => record.siteKey === siteKey);
  assert(site, "site registry did not include the registered site");
  assert(!Object.hasOwn(site, "adminToken"), "site registry kept a plaintext admin token field");
  assert(
    typeof site.adminTokenHash === "string" && site.adminTokenHash.startsWith("sha256:"),
    "site registry did not store an admin token hash",
  );
}

async function assertServiceAdminCanManageSites(hostedA, hostedB) {
  if (!SERVICE_ADMIN_PASSWORD) return;

  const listed = await serviceAdminApi("/api/service-admin/sites");
  assert(
    listed.sites.some((site) => site.siteKey === hostedA.site.siteKey),
    "service admin did not list hosted site A",
  );
  assert(
    listed.sites.some((site) => site.siteKey === hostedB.site.siteKey),
    "service admin did not list hosted site B",
  );

  const reset = await serviceAdminApi("/api/service-admin/action", {
    action: "resetAdminToken",
    siteKey: hostedB.site.siteKey,
  });
  assert(reset.adminToken && reset.adminToken !== hostedB.adminToken, "service admin did not issue a new token");
  assert(reset.adminUrl.includes("#adminToken="), "service admin reset did not return a fragment admin URL");
  await loginShouldFailWithAdminToken(hostedB.adminToken);
  const resetLogin = await loginWithAdminToken(reset.adminToken);
  assert(resetLogin.site.siteKey === hostedB.site.siteKey, "service admin reset token opened the wrong site");
  assertAdminTokenStoredAsHash(hostedB.site.siteKey, reset.adminToken);

  await serviceAdminApi("/api/service-admin/action", {
    action: "deleteSite",
    siteKey: hostedB.site.siteKey,
  });
  const afterDelete = await serviceAdminApi("/api/service-admin/sites");
  assert(
    !afterDelete.sites.some((site) => site.siteKey === hostedB.site.siteKey),
    "service admin did not delete hosted site B",
  );
}

async function assertServiceAdminShowsActiveVisitors(hostedA, hostedB) {
  if (!SERVICE_ADMIN_PASSWORD) return;

  const siteAdminA = await adminSiteApi(hostedA.site.siteKey, hostedA.adminToken);
  assert(siteAdminA.scene.activeVisitors === 1, "site admin did not show hosted site A's active visitor");
  assert(
    siteAdminA.scene.visitors[0]?.displayName === "Named Visitor",
    "site admin active visitor did not include display name",
  );

  const listed = await serviceAdminApi("/api/service-admin/sites");
  const listedA = listed.sites.find((site) => site.siteKey === hostedA.site.siteKey);
  const listedB = listed.sites.find((site) => site.siteKey === hostedB.site.siteKey);
  assert(listedA?.activeVisitors === 1, "service admin did not show hosted site A's active visitor");
  assert(listedB?.activeVisitors === 1, "service admin did not show hosted site B's active visitor");
}

async function assertEmbeddableAssetsAreCrossOriginLoadable() {
  const response = await fetch(`${HTTP_ORIGIN}/townsquare.mjs`);
  assert(response.ok, "townsquare module was not served");
  assert(
    response.headers.get("access-control-allow-origin") === "*",
    "townsquare module is missing cross-origin embed headers",
  );
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, message, { timeout = 2500, interval = 25 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = check();
    if (value) return value;
    await delay(interval);
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findLast(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) {
      return messages[index];
    }
  }
  return null;
}

async function assertInactiveDisconnect() {
  const inactiveMs = Number(process.env.INACTIVE_DISCONNECT_MS || 0);
  if (inactiveMs <= 0 || inactiveMs > 5000) return;

  const observer = await connect({ x: 0.15, browserId: "inactive-observer" });
  const keepalive = setInterval(() => {
    if (observer.ws.readyState === observer.ws.OPEN) {
      observer.ws.send(JSON.stringify({ type: "move", x: 0.15 }));
    }
  }, Math.max(100, Math.floor(inactiveMs / 3)));

  try {
    const idle = await connect({
      x: 0.25,
      browserId: "inactive-idle",
      readingActive: false,
      readingLabel: "Away page",
    });
    await delay(100);

    const idleId = idle.id;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("inactive visitor was not disconnected")),
        inactiveMs + 3000,
      );
      idle.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        assert(String(reason) === "inactive", `expected inactive close reason, got ${reason}`);
        resolve();
      });
    });

    await delay(200);
    assert(
      observer.seen.some((message) => message.type === "leave" && message.id === idleId),
      "observer did not see inactive leave",
    );

    const rejoined = await connect({ x: 0.25, browserId: "inactive-idle" });
    assert(rejoined.hello.id !== idleId, "expected a fresh visitor id after refresh-style reconnect");
    rejoined.ws.close();
  } finally {
    clearInterval(keepalive);
    observer.ws.close();
  }
}

async function main() {
  const inactiveMs = Number(process.env.INACTIVE_DISCONNECT_MS || 0);
  if (inactiveMs > 0 && inactiveMs <= 5000) {
    await assertInactiveDisconnect();
    console.log("Inactive disconnect smoke test passed.");
    return;
  }

  await assertEmbeddableAssetsAreCrossOriginLoadable();

  const first = await connect({
    x: 0.25,
    browserId: "browser-a",
    displayName: "  Ada    Lovelace  ",
    color: "#3f7f63",
    readingLabel: "  Launch    notes  ",
    readingUrl: `${HTTP_ORIGIN}/notes/launch`,
  });
  const secondSameBrowser = await connect({ x: 0.75, browserId: "browser-a" });

  await delay(100);

  assert(first.id === secondSameBrowser.id, "same-browser tabs did not reuse one shared identity");
  assert(first.hello.displayName === "Ada Lovelace", "display name was not normalized on init");
  assert(first.hello.color === "#3f7f63", "character color was not accepted on init");
  assert(first.hello.readingLabel === "launch", "reading label was not derived from the URL on init");
  assert(first.hello.readingUrl === `${HTTP_ORIGIN}/notes/launch`, "reading URL was not accepted on init");
  assert(first.hello.readingActive === true, "reading should default to active on init");
  assert(secondSameBrowser.hello.displayName === "Ada Lovelace", "same-browser tab did not inherit display name");
  assert(secondSameBrowser.hello.color === "#3f7f63", "same-browser tab did not inherit character color");
  assert(secondSameBrowser.hello.readingLabel === "launch", "same-browser tab did not inherit reading label");
  assert(secondSameBrowser.hello.readingUrl === `${HTTP_ORIGIN}/notes/launch`, "same-browser tab did not inherit reading URL");
  assert(secondSameBrowser.hello.readingActive === true, "same-browser tab did not inherit active reading state");
  assert(secondSameBrowser.hello.peers.length === 0, "same-browser tab should not see itself as a peer");
  assert(!first.seen.some((message) => message.type === "join"), "same-browser tab incorrectly triggered a join event");

  const third = await connect({ x: 0.62, browserId: "browser-b" });

  await delay(100);

  assert(third.hello.peers.length === 1, "third client should see one existing visitor, not one per tab");
  assert(third.hello.peers[0].displayName === "Ada Lovelace", "peer snapshot did not include display name");
  assert(third.hello.peers[0].color === "#3f7f63", "peer snapshot did not include character color");
  assert(third.hello.peers[0].readingLabel === "launch", "peer snapshot did not include reading label");
  assert(third.hello.peers[0].readingUrl === `${HTTP_ORIGIN}/notes/launch`, "peer snapshot did not include reading URL");
  assert(third.hello.peers[0].readingActive === true, "peer snapshot did not include active reading state");
  assert(first.seen.some((message) => message.type === "join" && message.peer.id === third.id), "first client did not observe different-browser join");

  const birdSpawn = await waitFor(
    () => findLast(first.seen, (message) => message.type === "bird" && message.action === "spawn")
      || first.hello.birds?.[0]
      || third.hello.birds?.[0],
    "ambient bird was never available in the scene",
    { timeout: 4000 },
  );
  assert(typeof birdSpawn.x === "number", "bird spawn did not include x");

  const birdJoiner = await connect({ x: 0.4, browserId: "browser-bird-sync" });
  assert(Array.isArray(birdJoiner.hello.birds), "hello did not include birds snapshot");
  assert(
    birdJoiner.hello.birds.some((bird) => bird.id === birdSpawn.id && bird.perchId === birdSpawn.perchId),
    "hello birds snapshot did not match spawned bird",
  );

  third.ws.send(JSON.stringify({ type: "move", x: birdSpawn.x }));
  await waitFor(
    () => first.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "first client did not receive bird flee broadcast",
  );
  await waitFor(
    () => third.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "approaching visitor did not receive bird flee event",
  );
  await waitFor(
    () => birdJoiner.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "other visitor did not receive bird flee broadcast",
  );

  birdJoiner.ws.close();
  await delay(100);

  secondSameBrowser.ws.send(JSON.stringify({
    type: "reading",
    readingLabel: "API reference",
    readingUrl: `${HTTP_ORIGIN}/docs/api`,
  }));
  await waitFor(
    () => first.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingLabel === "api"
      && message.readingUrl === `${HTTP_ORIGIN}/docs/api`
    )),
    "reading update did not propagate to same-browser sibling",
  );
  await waitFor(
    () => third.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingLabel === "api"
      && message.readingUrl === `${HTTP_ORIGIN}/docs/api`
    )),
    "reading update did not propagate to other visitors",
  );

  assert(
    !third.seen.some((message) => message.type === "reading" && message.readingLabel === "API reference"),
    "server accepted a client-controlled reading label",
  );

  secondSameBrowser.ws.send(JSON.stringify({
    type: "reading",
    readingLabel: "API reference",
    readingUrl: `${HTTP_ORIGIN}/docs/api`,
    readingActive: false,
  }));
  await delay(100);

  assert(
    !third.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingActive === false
    )),
    "one inactive same-browser tab should not mark the shared visitor away",
  );

  first.ws.send(JSON.stringify({
    type: "reading",
    readingLabel: "API reference",
    readingUrl: `${HTTP_ORIGIN}/docs/api`,
    readingActive: false,
  }));
  await waitFor(
    () => third.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingActive === false
    )),
    "reading inactive state did not propagate when every same-browser tab was inactive",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "profile", displayName: "Ada", color: "#3f6fb5" }));
  await waitFor(
    () => first.seen.some((message) => (
      message.type === "profile"
      && message.id === first.id
      && message.displayName === "Ada"
      && message.color === "#3f6fb5"
    )),
    "profile update did not propagate to same-browser sibling",
  );
  await waitFor(
    () => third.seen.some((message) => (
      message.type === "profile"
      && message.id === first.id
      && message.displayName === "Ada"
      && message.color === "#3f6fb5"
    )),
    "profile update did not propagate to other visitors",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.58 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: "hello from shared browser" }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: "this should be rate-limited away" }));
  await waitFor(() => first.seen.some((message) => message.type === "move" && message.id === first.id), "same-browser move did not propagate to sibling tab");
  await waitFor(() => first.seen.some((message) => message.type === "say" && message.id === first.id), "same-browser chat did not propagate to sibling tab");
  await waitFor(() => third.seen.some((message) => message.type === "move" && message.id === first.id), "different browser did not observe shared visitor movement");
  await waitFor(() => third.seen.some((message) => message.type === "say" && message.id === first.id), "different browser did not observe shared visitor chat");
  assert(
    !third.seen.some((message) => message.type === "say" && message.id === first.id && message.text === "this should be rate-limited away"),
    "chat rate limit did not suppress a rapid second message",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "action", action: "jump" }));
  await waitFor(() => first.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "jump"), "same-browser jump did not propagate to sibling tab");
  await waitFor(() => third.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "jump"), "different browser did not observe shared visitor jump");

  await delay(1600);
  const longText = "x".repeat(200);
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: longText }));
  await delay(100);

  const truncatedChat = findLast(third.seen, (message) => message.type === "say" && message.id === first.id);
  assert(truncatedChat, "expected to observe the post-rate-limit chat message");
  assert(truncatedChat.text.length === 140, "chat text was not capped to 140 characters");

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.2 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "settle", propId: "bench" }));
  const firstBenchState = await waitFor(
    () => findLast(first.seen, (message) => message.type === "move" && message.id === first.id && message.pose === "sitting" && message.propId === "bench"),
    "same-browser bench settle did not propagate to sibling tab",
  );
  await waitFor(
    () => findLast(third.seen, (message) => message.type === "move" && message.id === first.id && message.pose === "sitting" && message.propId === "bench"),
    "bench settle did not propagate to other visitors",
  );

  third.ws.send(JSON.stringify({ type: "move", x: 0.2 }));
  await delay(100);
  third.ws.send(JSON.stringify({ type: "settle", propId: "bench" }));
  const thirdSeatState = await waitFor(
    () => findLast(first.seen, (message) => message.type === "move" && message.id === third.id && message.pose === "sitting" && message.propId === "bench"),
    "second visitor did not settle onto the bench",
  );
  assert(Math.abs(thirdSeatState.x - firstBenchState.x) > 0.005, "bench seat allocation reused an occupied seat");

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.8 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "settle", propId: "tree" }));
  const firstTreeState = await waitFor(
    () => findLast(first.seen, (message) => (
      message.type === "move"
      && message.id === first.id
      && message.pose === "resting"
      && message.propId === "tree"
    )),
    "same-browser tree settle did not propagate to sibling tab",
  );
  await waitFor(
    () => findLast(third.seen, (message) => (
      message.type === "move"
      && message.id === first.id
      && message.pose === "resting"
      && message.propId === "tree"
    )),
    "tree settle did not propagate to other visitors",
  );

  third.ws.send(JSON.stringify({ type: "move", x: 0.8 }));
  await delay(100);
  third.ws.send(JSON.stringify({ type: "settle", propId: "tree" }));
  const thirdTreeSeatState = await waitFor(
    () => findLast(first.seen, (message) => (
      message.type === "move"
      && message.id === third.id
      && message.pose === "resting"
      && message.propId === "tree"
    )),
    "second visitor did not settle under the tree",
  );
  assert(Math.abs(thirdTreeSeatState.x - firstTreeState.x) > 0.005, "tree seat allocation reused an occupied seat");

  secondSameBrowser.ws.close();
  await delay(100);

  assert(!first.seen.some((message) => message.type === "leave" && message.id === first.id), "closing one same-browser tab incorrectly removed the shared visitor");

  third.ws.close();
  await waitFor(
    () => first.seen.some((message) => message.type === "leave" && message.id === third.id),
    "first client did not observe different-browser leave",
    { timeout: 2500 },
  );

  const previewBenchX = 0.31;
  const preview = await connect({
    x: previewBenchX,
    browserId: "preview-custom-scene",
    sceneConfig: {
      benches: 1,
      trees: 0,
      lamps: 0,
      birds: 0,
      benchXs: [previewBenchX],
    },
  });
  preview.ws.send(JSON.stringify({ type: "settle", propId: "bench" }));
  const previewSeat = await waitFor(
    () => findLast(preview.seen, (message) => (
      message.type === "move"
      && message.id === preview.id
      && message.pose === "sitting"
      && message.propId === "bench"
    )),
    "preview settle did not use the client scene config bench position",
  );
  assert(Math.abs(previewSeat.x - (previewBenchX - 0.01)) < 0.005, "preview bench seat was not snapped to the custom bench");

  const defaultSceneWithoutConfig = await connect({
    x: previewBenchX,
    browserId: "preview-default-scene",
  });
  defaultSceneWithoutConfig.ws.send(JSON.stringify({ type: "settle", propId: "bench" }));
  await delay(200);
  assert(
    !defaultSceneWithoutConfig.seen.some((message) => (
      message.type === "move"
      && message.id === defaultSceneWithoutConfig.id
      && message.pose === "sitting"
    )),
    "default-scene preview should not settle onto a bench placed outside the shared default layout",
  );
  defaultSceneWithoutConfig.ws.close();
  preview.ws.close();

  const hostedA = await createSite("Smoke A");
  const hostedB = await createSite("Smoke B");
  assertAdminTokenStoredAsHash(hostedA.site.siteKey, hostedA.adminToken);
  assertAdminTokenStoredAsHash(hostedB.site.siteKey, hostedB.adminToken);
  await assertAdminCustomizationCanBeUpdated(hostedA);
  const hostedALogin = await loginWithAdminToken(hostedA.adminToken);
  assert(hostedALogin.site.siteKey === hostedA.site.siteKey, "admin token login returned the wrong site");

  const siteAVisitor = await connect({
    x: 0.3,
    browserId: "hosted-a",
    siteKey: hostedA.site.siteKey,
    origin: HTTP_ORIGIN,
    displayName: "Named Visitor",
    readingLabel: "visiting your mom",
    readingUrl: `${HTTP_ORIGIN}/docs/real-page`,
  });
  const siteBVisitor = await connect({
    x: 0.7,
    browserId: "hosted-b",
    siteKey: hostedB.site.siteKey,
    origin: HTTP_ORIGIN,
  });

  await delay(100);

  assert(siteAVisitor.hello.peers.length === 0, "hosted site A saw visitors from another site");
  assert(siteAVisitor.hello.readingLabel === "real page", "hosted site accepted a custom reading label");
  assert(siteAVisitor.hello.readingUrl === `${HTTP_ORIGIN}/docs/real-page`, "hosted site did not keep a same-origin reading URL");
  assert(siteBVisitor.hello.peers.length === 0, "hosted site B saw visitors from another site");

  const cleanSiteAStats = await adminSiteApi(hostedA.site.siteKey, hostedA.adminToken);
  assert(cleanSiteAStats.scene.visitors[0]?.color === "#5f6b73", "admin visitor stats did not include character color");
  assert(cleanSiteAStats.scene.visitors[0]?.readingLabel === "real page", "admin visitor stats did not include reading label");
  assert(cleanSiteAStats.scene.visitors[0]?.readingUrl === `${HTTP_ORIGIN}/docs/real-page`, "admin visitor stats did not include reading URL");
  assert(cleanSiteAStats.scene.visitors[0]?.readingActive === true, "admin visitor stats did not include reading active state");
  assert(cleanSiteAStats.scene.visitors[0]?.suspicious === false, "valid hosted visitor was marked suspicious");

  siteAVisitor.ws.send(JSON.stringify({
    type: "reading",
    readingLabel: "visiting your mom",
    readingUrl: "https://attacker.example/status",
  }));
  await waitFor(
    () => siteAVisitor.seen.some((message) => (
      message.type === "reading"
      && message.id === siteAVisitor.id
      && message.readingLabel === ""
      && message.readingUrl === ""
    )),
    "hosted site did not reject an off-site reading URL",
  );
  const suspiciousSiteAStats = await adminSiteApi(hostedA.site.siteKey, hostedA.adminToken);
  const suspiciousSiteAVisitor = suspiciousSiteAStats.scene.visitors[0];
  assert(suspiciousSiteAVisitor?.suspicious === true, "rejected reading URL did not mark visitor suspicious");
  assert(
    suspiciousSiteAVisitor.suspiciousReasons.includes("off_origin_reading_url"),
    "off-origin reading URL reason was not exposed to admin stats",
  );
  assert(suspiciousSiteAVisitor.lastOrigin === HTTP_ORIGIN, "visitor origin was not exposed to admin stats");

  const suspiciousSiteBStats = await adminSiteApi(hostedB.site.siteKey, hostedB.adminToken);
  const suspiciousSiteBVisitor = suspiciousSiteBStats.scene.visitors[0];
  assert(suspiciousSiteBVisitor?.suspicious === true, "missing reading URL did not mark hosted visitor suspicious");
  assert(
    suspiciousSiteBVisitor.suspiciousReasons.includes("missing_reading_url"),
    "missing reading URL reason was not exposed to admin stats",
  );

  await assertServiceAdminShowsActiveVisitors(hostedA, hostedB);

  siteAVisitor.ws.close();
  siteBVisitor.ws.close();
  await assertServiceAdminCanManageSites(hostedA, hostedB);
  await assertAuthFailuresAreThrottled(hostedA);
  await assertServiceAdminFailuresAreThrottled();

  console.log("Smoke test passed.");
  first.ws.close();
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
