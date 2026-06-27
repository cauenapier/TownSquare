const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

// These are `let` so the self-contained harness (startManagedServer) can point
// them at a server it spawns on a free port. When TOWNSQUARE_HTTP_ORIGIN is set,
// they keep their external-server defaults and the harness is skipped.
let SERVER_URL = process.env.TOWNSQUARE_WS_URL || "ws://127.0.0.1:8787/live";
let HTTP_ORIGIN = process.env.TOWNSQUARE_HTTP_ORIGIN || "http://127.0.0.1:8787";
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", ".data");
let SITES_FILE = path.join(DATA_DIR, "sites.json");
let MAP_WORLD_FILE = path.join(DATA_DIR, "map-world.json");
let SERVICE_ADMIN_PASSWORD = process.env.SERVICE_ADMIN_PASSWORD || "";
const AUTH_FAILURES_PER_HOUR = Number(process.env.AUTH_FAILURES_PER_HOUR || 30);

// Ask the OS for an unused TCP port so concurrent runs don't collide (and so we
// never accidentally talk to an unrelated server bound to a fixed port).
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
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("managed server did not become healthy in time");
}

// Spawn our own server on a free port with an isolated data dir, point the
// module globals at it, and return a cleanup function. This makes
// `node scripts/smoke-test.js` self-contained and CI-runnable.
async function startManagedServer() {
  const port = await findFreePort();
  const host = "127.0.0.1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "townsquare-smoke-"));
  const password = SERVICE_ADMIN_PASSWORD || "smoke-service-admin";
  const httpOrigin = `http://${host}:${port}`;

  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      DATA_DIR: dataDir,
      SERVICE_ADMIN_PASSWORD: password,
      ALLOWED_ORIGINS: httpOrigin,
      // The functional chat assertions send a message moments after joining;
      // disable the anti-bot "typed too fast after joining" guard so it doesn't
      // drop them (its behavior has dedicated TEST_IP_* coverage instead).
      MIN_HUMAN_SAY_MS: "0",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  SERVER_URL = `ws://${host}:${port}/live`;
  HTTP_ORIGIN = httpOrigin;
  DATA_DIR = dataDir;
  SITES_FILE = path.join(dataDir, "sites.json");
  MAP_WORLD_FILE = path.join(dataDir, "map-world.json");
  SERVICE_ADMIN_PASSWORD = password;

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
      // best-effort cleanup
    }
  };
}

function siteSocketUrl(siteKey) {
  if (!siteKey) return SERVER_URL;
  const url = new URL(SERVER_URL);
  url.searchParams.set("siteKey", siteKey);
  return url.toString();
}

function socketOptions(origin, ip) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (ip) headers["X-Real-IP"] = ip;
  return Object.keys(headers).length > 0 ? { headers } : undefined;
}

function connect({ x, browserId, browserSecret = "", siteKey = "", origin = "", ip = "", displayName = "", color = "", readingLabel, readingUrl, readingActive }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(siteSocketUrl(siteKey), socketOptions(origin, ip));
    const seen = [];
    let joined = false;

    ws.on("open", () => {
      const init = { type: "init", x, browserId, displayName, color };
      if (browserSecret) init.browserSecret = browserSecret;
      if (typeof readingLabel === "string") init.readingLabel = readingLabel;
      if (typeof readingUrl === "string") init.readingUrl = readingUrl;
      if (typeof readingActive === "boolean") init.readingActive = readingActive;
      ws.send(JSON.stringify(init));
    });

    ws.on("message", (buffer) => {
      const message = JSON.parse(String(buffer));
      seen.push(message);
      if (message.type === "hello") {
        joined = true;
        resolve({ ws, seen, id: message.id, hello: message });
      }
    });

    ws.on("error", reject);
    ws.on("close", (code, reason) => {
      if (!joined) {
        reject(new Error(`connection ${browserId || "(ephemeral)"} closed before hello (${code}: ${String(reason)})`));
      }
    });
  });
}

function connectUntilClose({ x, browserId, siteKey = "", origin = "", ip = "" }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(siteSocketUrl(siteKey), socketOptions(origin, ip));
    ws.on("open", () => ws.send(JSON.stringify({ type: "init", x, browserId })));
    ws.on("message", (buffer) => {
      const message = JSON.parse(String(buffer));
      if (message.type === "hello") reject(new Error("rate-limited connection unexpectedly joined"));
    });
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
    ws.on("error", reject);
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
  });
}

async function createSite(name, options = {}) {
  const { origin = HTTP_ORIGIN, includeMatchingWww = false } = options;
  const response = await fetch(`${HTTP_ORIGIN}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, origin, includeMatchingWww }),
  });
  const body = await response.json();
  assert(response.ok, body.error || "site registration failed");
  assert(body.site.siteKey, "registered site did not include a site key");
  assert(body.adminToken, "registered site did not include an admin token");
  return body;
}

async function assertCustomizationPersists() {
  const response = await fetch(`${HTTP_ORIGIN}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Custom Scene",
      origin: HTTP_ORIGIN,
      email: "owner@example.com",
      sceneConfig: { benches: 3, trees: 2, lamps: 1, birds: 6, benchXs: [0.14, 0.5, 0.82] },
      styleConfig: { light: { accent: "#9d5c2f" }, dark: { accent: "#ffcc00" } },
    }),
  });
  const body = await response.json();
  assert(response.ok, body.error || "customized site registration failed");
  assert(body.site.email === "owner@example.com", "registered site did not persist email");
  assert(body.site.sceneConfig?.benches === 3, "registered site did not persist scene config");
  assert(body.site.sceneConfig?.birds === 6, "registered site did not persist bird count");
  assert(body.site.sceneConfig?.benchXs?.[0] === 0.14, "registered site did not persist bench placement");
  assert(body.site.styleConfig?.light?.accent === "#9d5c2f", "registered site did not persist light accent");
  assert(body.site.styleConfig?.dark?.accent === "#ffcc00", "registered site did not persist dark accent");
  // The snippet is install-once identity; scene/connections/messageBoard are
  // delivered live over the socket (see the hello payload), not baked here.
  assert(body.embedSnippet.includes(body.site.siteKey), "embed snippet did not include the site key");
  assert(!body.embedSnippet.includes("scene:"), "embed snippet should no longer bake the scene config");
  assert(
    typeof body.styleSnippet === "string"
      && body.styleSnippet.includes("#townsquare-root#townsquare-root")
      && body.styleSnippet.includes('[data-townsquare-theme="dark"]')
      && body.styleSnippet.includes("#ffcc00")
      && body.styleSnippet.includes(".townsquare__stage"),
    "style snippet missing the doubled-specificity selector, dark palette, or stage surface rules",
  );

  // Legacy flat styleConfig normalizes: flat becomes light, dark falls back to defaults.
  const legacy = await postJson("/api/sites", {
    name: "Legacy Style",
    origin: HTTP_ORIGIN,
    styleConfig: { accent: "#112233" },
  });
  assert(legacy.response.ok, legacy.body.error || "legacy-style site registration failed");
  assert(legacy.body.site.styleConfig?.light?.accent === "#112233", "legacy flat style did not become the light palette");
  assert(legacy.body.site.styleConfig?.dark?.accent === "#df8a43", "legacy flat style did not default the dark palette");

  const updated = await postJson("/api/admin/action", {
    siteKey: body.site.siteKey,
    adminToken: body.adminToken,
    action: "updateCustomization",
    sceneConfig: { benches: 4, trees: 1, lamps: 2, birds: 2 },
    styleConfig: { light: { accent: "#336699" }, dark: { accent: "#aabbcc" } },
  });
  assert(updated.response.ok, updated.body.error || "admin customization update failed");
  assert(updated.body.site.sceneConfig?.benches === 4, "admin customization did not update scene config");
  assert(updated.body.site.styleConfig?.light?.accent === "#336699", "admin customization did not update light accent");
  assert(updated.body.site.styleConfig?.dark?.accent === "#aabbcc", "admin customization did not update dark accent");

  const details = await postJson("/api/admin/action", {
    siteKey: body.site.siteKey,
    adminToken: body.adminToken,
    action: "updateSiteDetails",
    origin: HTTP_ORIGIN,
    name: "Renamed Site",
    email: "new-owner@example.com",
    includeMatchingWww: false,
  });
  assert(details.response.ok, details.body.error || "admin site details update failed");
  assert(details.body.site.name === "Renamed Site", "admin did not update the site name");
  assert(details.body.site.email === "new-owner@example.com", "admin did not update the site email");

  const invalidDetails = await postJson("/api/admin/action", {
    siteKey: body.site.siteKey,
    adminToken: body.adminToken,
    action: "updateSiteDetails",
    origin: HTTP_ORIGIN,
    name: "Should Not Save",
    email: "not-an-email",
    includeMatchingWww: false,
  });
  assert(invalidDetails.response.status === 400, "admin accepted an invalid site email");

  const persisted = await postJson("/api/admin/site", {
    siteKey: body.site.siteKey,
    adminToken: body.adminToken,
  });
  assert(persisted.body.site.name === "Renamed Site", "invalid details update changed the site name");
  assert(persisted.body.site.email === "new-owner@example.com", "admin site details did not persist");
}

async function assertMatchingWwwOriginsWork() {
  const hosted = await createSite("WWW Pair", { origin: "https://example.com", includeMatchingWww: true });
  assert(hosted.site.includeMatchingWww === true, "registered site did not report matching-www support");
  assert(
    JSON.stringify(hosted.site.allowedOrigins) === JSON.stringify(["https://example.com", "https://www.example.com"]),
    "registered site did not persist both allowed origins",
  );

  const apex = await connect({
    x: 0.25,
    browserId: "pair-apex",
    siteKey: hosted.site.siteKey,
    origin: "https://example.com",
  });
  const www = await connect({
    x: 0.75,
    browserId: "pair-www",
    siteKey: hosted.site.siteKey,
    origin: "https://www.example.com",
  });
  await delay(100);
  assert(www.hello.peers.some((peer) => peer.id === apex.id), "www origin did not join the same hosted scene");

  const narrowed = await postJson("/api/admin/action", {
    siteKey: hosted.site.siteKey,
    adminToken: hosted.adminToken,
    action: "updateSiteDetails",
    origin: "https://www.example.com",
    includeMatchingWww: false,
    name: hosted.site.name,
    email: "",
  });
  assert(narrowed.response.ok, narrowed.body.error || "admin site details update for www pair failed");
  assert(narrowed.body.site.origin === "https://www.example.com", "admin did not update the canonical website URL");
  assert(
    JSON.stringify(narrowed.body.site.allowedOrigins) === JSON.stringify(["https://www.example.com"]),
    "admin did not narrow the allowed origins back to one URL",
  );

  apex.ws.close();
  www.ws.close();
}

async function assertOwnerProfilePersists() {
  const hosted = await createSite("Owner Profile");
  const { siteKey } = hosted.site;
  const { adminToken } = hosted;

  const ownerVisitor = await connect({
    x: 0.3,
    browserId: "owner-profile-browser",
    siteKey,
    origin: HTTP_ORIGIN,
    displayName: "Visitor",
    color: "#5f6b73",
  });
  const peer = await connect({ x: 0.7, browserId: "owner-profile-peer", siteKey, origin: HTTP_ORIGIN });
  await delay(80);

  const promoted = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "setOwnerVisitor", visitorId: ownerVisitor.id, owner: true,
  });
  assert(promoted.response.ok, promoted.body.error || "owner promotion failed");
  assert(
    promoted.body.scene.visitors.find((v) => v.id === ownerVisitor.id)?.isOwner,
    "visitor was not promoted to owner",
  );
  // The dedicated "Site owner" section drives off the owners payload, keyed by
  // an opaque handle (no raw browserId), and lists the owner whether online or not.
  assert(Array.isArray(promoted.body.owners) && promoted.body.owners.length === 1, "owners payload missing after promotion");
  const ownerHandle = promoted.body.owners[0].handle;
  assert(typeof ownerHandle === "string" && ownerHandle.length > 0, "owner payload did not include a handle");
  assert(promoted.body.owners[0].online === true, "promoted owner should be reported online");

  const customized = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "updateOwnerProfile", handle: ownerHandle, displayName: "kev", color: "#c8641f",
  });
  assert(customized.response.ok, customized.body.error || "owner profile customization failed");
  assert(
    customized.body.owners[0].displayName === "kev" && customized.body.owners[0].color === "#c8641f",
    "owners payload did not reflect the customized name/color",
  );
  await delay(80);

  assert(
    peer.seen.some((m) => m.type === "profile" && m.id === ownerVisitor.id && m.displayName === "kev" && m.color === "#c8641f"),
    "peers did not see the owner's customized name/color",
  );

  // Reset: evict the identity (grace window) then reconnect with no stored
  // profile, as a server restart or cleared widget storage would. Ownership
  // persists via ownerBrowserIds and the look via ownerProfiles.
  ownerVisitor.ws.close();
  await delay(1700);
  const rejoined = await connect({ x: 0.3, browserId: "owner-profile-browser", siteKey, origin: HTTP_ORIGIN, displayName: "", color: "" });
  assert(rejoined.hello.isOwner, "owner lost ownership across a reset");
  assert(rejoined.hello.displayName === "kev", "owner name did not persist across a reset");
  assert(rejoined.hello.color === "#c8641f", "owner color did not persist across a reset");

  // The dedicated section can customize an owner who is fully offline.
  rejoined.ws.close();
  await delay(1700);
  const offlineView = await postJson("/api/admin/site", { siteKey, adminToken });
  assert(offlineView.body.owners[0].online === false, "offline owner should be reported offline");
  const offlineEdit = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "updateOwnerProfile", handle: ownerHandle, displayName: "Kevin", color: "#3f7f63",
  });
  assert(offlineEdit.response.ok, offlineEdit.body.error || "offline owner edit failed");

  const reconnected = await connect({ x: 0.3, browserId: "owner-profile-browser", siteKey, origin: HTTP_ORIGIN, displayName: "", color: "" });
  assert(
    reconnected.hello.displayName === "Kevin" && reconnected.hello.color === "#3f7f63",
    "offline owner customization did not apply on reconnect",
  );

  // Un-owning drops the saved profile so a future visitor on that browser is plain.
  const demoted = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "setOwnerVisitor", visitorId: reconnected.id, owner: false,
  });
  assert(demoted.response.ok, demoted.body.error || "owner demotion failed");
  assert(Array.isArray(demoted.body.owners) && demoted.body.owners.length === 0, "demotion did not clear the owners list");

  peer.ws.close();
  reconnected.ws.close();
}

async function assertModerationTools() {
  const hosted = await createSite("Moderation");
  const { siteKey } = hosted.site;
  const { adminToken } = hosted;

  const sender = await connect({ x: 0.3, browserId: "mod-sender", siteKey, origin: HTTP_ORIGIN, displayName: "Talker" });
  const observer = await connect({ x: 0.7, browserId: "mod-observer", siteKey, origin: HTTP_ORIGIN });
  await delay(80);

  // The widget enforces slow mode client-side (to show a "wait" hint), so the
  // server hands it the live cooldown on connect.
  assert(sender.hello.chatThrottleMs === 500, "hello did not carry the default chat cooldown");

  // --- Forbidden-word filter: matched words are masked for peers; the list is
  // lowercased and de-duped server-side. ---
  const filtered = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "updateModeration", blockedWords: ["Badword", "badword", "secret"], chatThrottleMs: 1500,
  });
  assert(filtered.response.ok, filtered.body.error || "updateModeration failed");
  assert(
    JSON.stringify(filtered.body.site.blockedWords) === JSON.stringify(["badword", "secret"]),
    "blocked words were not lowercased/de-duped",
  );

  sender.ws.send(JSON.stringify({ type: "say", text: "this is a badword and a Secret" }));
  await waitFor(
    () => observer.seen.some((m) => m.type === "say" && m.id === sender.id),
    "filtered chat message did not reach the observer",
  );
  const filteredSay = findLast(observer.seen, (m) => m.type === "say" && m.id === sender.id);
  assert(
    filteredSay.text === "this is a ******* and a ******",
    `forbidden words were not masked (got: ${filteredSay.text})`,
  );

  // --- Mute: a muted visitor stays present but their messages are dropped. ---
  const muted = await postJson("/api/admin/action", { siteKey, adminToken, action: "muteVisitor", visitorId: sender.id });
  assert(muted.response.ok, muted.body.error || "muteVisitor failed");
  assert(
    muted.body.scene.visitors.find((v) => v.id === sender.id)?.muted === true,
    "muted visitor was not flagged in scene stats",
  );

  await delay(1600); // clear the default chat throttle from the previous message
  sender.ws.send(JSON.stringify({ type: "say", text: "you should not hear this" }));
  await delay(200);
  assert(
    !observer.seen.some((m) => m.type === "say" && m.id === sender.id && m.text.includes("not hear")),
    "a muted visitor's message reached the observer",
  );

  // --- Unmute restores chat. ---
  const unmuted = await postJson("/api/admin/action", { siteKey, adminToken, action: "unmuteVisitor", visitorId: sender.id });
  assert(unmuted.response.ok, unmuted.body.error || "unmuteVisitor failed");
  assert(
    unmuted.body.scene.visitors.find((v) => v.id === sender.id)?.muted === false,
    "unmuted visitor was still flagged as muted",
  );
  sender.ws.send(JSON.stringify({ type: "say", text: "back online" }));
  await waitFor(
    () => observer.seen.some((m) => m.type === "say" && m.id === sender.id && m.text === "back online"),
    "unmuted visitor's message did not reach the observer",
  );

  // --- Slow mode: a custom cooldown suppresses an otherwise-allowed message. ---
  const slowed = await postJson("/api/admin/action", {
    siteKey, adminToken, action: "updateModeration", blockedWords: [], chatThrottleMs: 5000,
  });
  assert(slowed.response.ok, slowed.body.error || "slow-mode update failed");
  assert(slowed.body.site.chatThrottleMs === 5000, "slow-mode cooldown did not persist");
  await delay(80);
  assert(
    observer.seen.some((m) => m.type === "chatThrottle" && m.ms === 5000),
    "connected widget was not told about the new slow-mode cooldown",
  );

  await delay(1600); // well under the new 5s cooldown, so the message is dropped
  sender.ws.send(JSON.stringify({ type: "say", text: "too fast for slow mode" }));
  await delay(200);
  assert(
    !observer.seen.some((m) => m.type === "say" && m.id === sender.id && m.text.includes("too fast")),
    "slow mode did not suppress a message sent within the custom cooldown",
  );

  // --- Moderation log records enforcement actions, newest first. ---
  const logView = await postJson("/api/admin/site", { siteKey, adminToken });
  const actions = (logView.body.site.moderationLog || []).map((entry) => entry.action);
  assert(actions.includes("mute") && actions.includes("unmute"), "moderation log did not record mute/unmute");
  assert(actions.indexOf("unmute") < actions.indexOf("mute"), "moderation log is not newest-first");

  sender.ws.close();
  observer.ws.close();
}

async function assertHideVisitor() {
  const hosted = await createSite("Hide");
  const { siteKey } = hosted.site;
  const { adminToken } = hosted;

  const target = await connect({ x: 0.3, browserId: "hide-target", siteKey, origin: HTTP_ORIGIN, displayName: "Ghost" });
  const observer = await connect({ x: 0.7, browserId: "hide-observer", siteKey, origin: HTTP_ORIGIN });
  await delay(80);

  assert(
    (observer.hello.peers || []).some((peer) => peer.id === target.id),
    "observer did not receive the target visitor in hello peers before hide",
  );

  const hid = await postJson("/api/admin/action", { siteKey, adminToken, action: "hideVisitor", visitorId: target.id });
  assert(hid.response.ok, hid.body.error || "hideVisitor failed");
  assert(
    hid.body.scene.visitors.find((v) => v.id === target.id)?.hidden === true,
    "hidden visitor was not flagged in scene stats",
  );
  await delay(80);
  assert(
    observer.seen.some((m) => m.type === "leave" && m.id === target.id),
    "hiding a visitor did not send leave to visible peers",
  );

  await delay(1600);
  target.ws.send(JSON.stringify({ type: "say", text: "you should not see or hear this" }));
  await delay(200);
  assert(
    !observer.seen.some((m) => m.type === "say" && m.id === target.id),
    "a hidden visitor's chat reached the observer",
  );

  const newcomer = await connect({ x: 0.5, browserId: "hide-newcomer", siteKey, origin: HTTP_ORIGIN, ip: "192.0.2.60" });
  await delay(80);
  assert(
    !(newcomer.hello.peers || []).some((peer) => peer.id === target.id),
    "a newcomer received a hidden visitor in hello peers",
  );
  await waitFor(
    () => target.seen.some((m) => m.type === "join" && m.peer?.id === newcomer.id),
    "a hidden visitor did not receive join events for visible newcomers",
  );

  const unhid = await postJson("/api/admin/action", { siteKey, adminToken, action: "unhideVisitor", visitorId: target.id });
  assert(unhid.response.ok, unhid.body.error || "unhideVisitor failed");
  assert(
    unhid.body.scene.visitors.find((v) => v.id === target.id)?.hidden === false,
    "unhidden visitor was still flagged as hidden",
  );
  await delay(80);
  assert(
    observer.seen.some((m) => m.type === "join" && m.peer?.id === target.id)
      || newcomer.seen.some((m) => m.type === "join" && m.peer?.id === target.id),
    "unhiding a visitor did not send join to visible peers",
  );

  await delay(1600);
  target.ws.send(JSON.stringify({ type: "say", text: "visible again" }));
  await waitFor(
    () => observer.seen.some((m) => m.type === "say" && m.id === target.id && m.text === "visible again"),
    "unhidden visitor's message did not reach the observer",
  );

  const logView = await postJson("/api/admin/site", { siteKey, adminToken });
  const actions = (logView.body.site.moderationLog || []).map((entry) => entry.action);
  assert(actions.includes("hide") && actions.includes("unhide"), "moderation log did not record hide/unhide");

  target.ws.close();
  observer.ws.close();
  newcomer.ws.close();
}

async function assertPerSiteConnectionLimit() {
  const hosted = await createSite("Connection Limit");
  const { siteKey, origin } = hosted.site;
  const { adminToken } = hosted;
  assert(hosted.site.connectionLimit === 100, "new site did not default to a 100-person limit");

  const limited = await postJson("/api/admin/action", {
    siteKey,
    adminToken,
    action: "updateSiteDetails",
    origin,
    name: hosted.site.name,
    email: hosted.site.email || "",
    includeMatchingWww: hosted.site.includeMatchingWww,
    connectionLimit: 1,
  });
  assert(limited.response.ok, limited.body.error || "connection-limit update failed");
  assert(limited.body.site.connectionLimit === 1, "admin did not persist the connection limit");

  const first = await connect({ x: 0.25, browserId: "limit-first", siteKey, origin });
  const rejected = await connectUntilClose({ x: 0.75, browserId: "limit-second", siteKey, origin });
  assert(rejected.code === 1013, `expected full close code 1013, got ${rejected.code}`);
  assert(rejected.reason === "full", `expected full close reason, got ${rejected.reason}`);

  const firstClosed = waitForClose(first.ws);
  first.ws.close();
  await firstClosed;
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
  return body;
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

async function assertMapWorldSizingPolicy() {
  const {
    MAP_WORLD_MIN_HEIGHT,
    MAP_WORLD_MIN_WIDTH,
    computeMapWorldDimensions,
    resolveMapWorld,
    validateMapWorld,
  } = await import("../public/shared/map-world.mjs");

  const min = computeMapWorldDimensions(0);
  assert(
    min.width === MAP_WORLD_MIN_WIDTH && min.height === MAP_WORLD_MIN_HEIGHT,
    "0 sites should use the minimum map dimensions",
  );

  const grown = computeMapWorldDimensions(100);
  assert(
    grown.width > MAP_WORLD_MIN_WIDTH && grown.height > MAP_WORLD_MIN_HEIGHT,
    "100 sites should grow the map world",
  );

  const stored = {
    width: MAP_WORLD_MIN_WIDTH,
    height: MAP_WORLD_MIN_HEIGHT,
    props: [{ type: "tree", x: 900, y: 600 }],
    water: [],
  };
  const resolved = resolveMapWorld(stored, 100);
  assert(resolved.width >= grown.width, "resolveMapWorld should meet the computed width");
  assert(resolved.height >= grown.height, "resolveMapWorld should meet the computed height");
  assert(
    resolved.props[0].x === 900 && resolved.props[0].y === 600,
    "resolveMapWorld should keep scenery anchored",
  );

  const oversized = resolveMapWorld({ ...stored, width: 4000, height: 2800 }, 0);
  assert(
    oversized.width === 4000 && oversized.height === 2800,
    "resolveMapWorld should keep stored dimensions when they are already larger",
  );

  const valid = validateMapWorld({ ...stored, width: 2000, height: 1400 });
  assert(valid.ok, "a world within the allowed size range should validate");

  const tooSmall = validateMapWorld({ ...stored, width: 1000, height: MAP_WORLD_MIN_HEIGHT });
  assert(!tooSmall.ok, "a world below the minimum width should be rejected");

  const tooLarge = validateMapWorld({ ...stored, width: 99999, height: MAP_WORLD_MIN_HEIGHT });
  assert(!tooLarge.ok, "a world above the maximum width should be rejected");
}

async function assertServiceAdminCanEditMap() {
  if (!SERVICE_ADMIN_PASSWORD) return;

  const { computeMapWorldDimensions, MAP_WORLD_MIN_WIDTH } = await import("../public/shared/map-world.mjs");
  const publicBefore = await fetch(`${HTTP_ORIGIN}/api/map`).then((response) => response.json());
  const expected = computeMapWorldDimensions(publicBefore.sites.length);
  assert(publicBefore.world?.width >= MAP_WORLD_MIN_WIDTH, "public map did not include the world");
  assert(
    publicBefore.world?.width >= expected.width,
    "public map world width is smaller than site count requires",
  );
  assert(
    publicBefore.world?.height >= expected.height,
    "public map world height is smaller than site count requires",
  );
  assert(
    publicBefore.sites.every((site) => Number.isFinite(site.messageCount)),
    "public map sites did not include total message counts",
  );
  assert(
    publicBefore.sites.every((site) => Number.isFinite(site.activeVisitors)),
    "public map sites did not include active visitor counts",
  );
  assert(Array.isArray(publicBefore.world?.props), "public map world did not include props");
  assert(Array.isArray(publicBefore.world?.water), "public map world did not include water strokes");

  const unauthorized = await postJson("/api/service-admin/map", { password: "wrong-map-password" });
  assert(unauthorized.response.status === 403, "map editor accepted an invalid service password");

  const loaded = await serviceAdminApi("/api/service-admin/map");
  assert(Array.isArray(loaded.world?.props), "service admin did not load the map world");
  const original = loaded.world;
  const edited = {
    ...original,
    water: [
      ...original.water.slice(0, 198),
      { type: "lake", width: 90, points: [{ x: 900, y: 600 }, { x: 940, y: 620 }] },
      { type: "river", width: 24, points: [{ x: 300, y: 200 }, { x: 500, y: 260 }, { x: 700, y: 210 }] },
    ],
  };

  try {
    const saved = await serviceAdminApi("/api/service-admin/map/save", { world: edited });
    assert(saved.world.water.some((stroke) => stroke.type === "lake"), "service admin did not save a lake");
    assert(saved.world.water.some((stroke) => stroke.type === "river"), "service admin did not save a river");
    const persisted = JSON.parse(fs.readFileSync(MAP_WORLD_FILE, "utf8"));
    assert(persisted.water.some((stroke) => stroke.type === "lake"), "map world was not persisted to DATA_DIR");

    const publicAfter = await fetch(`${HTTP_ORIGIN}/api/map`).then((response) => response.json());
    assert(publicAfter.world.water.some((stroke) => stroke.type === "lake"), "saved world was not public");

    for (const world of [
      { ...edited, props: [{ type: "castle", x: 10, y: 10 }] },
      { ...edited, props: [{ type: "tree", x: -1, y: 10 }] },
      { ...edited, props: Array.from({ length: 1001 }, () => ({ type: "tree", x: 10, y: 10 })) },
      { ...edited, water: [{ type: "ocean", width: 50, points: [{ x: 10, y: 10 }] }] },
    ]) {
      const invalid = await postJson("/api/service-admin/map/save", {
        password: SERVICE_ADMIN_PASSWORD,
        world,
      });
      assert(invalid.response.status === 400, "service admin accepted an invalid map world");
    }

    const afterInvalid = await fetch(`${HTTP_ORIGIN}/api/map`).then((response) => response.json());
    assert(
      JSON.stringify(afterInvalid.world) === JSON.stringify(edited),
      "an invalid save changed the public map world",
    );
  } finally {
    await serviceAdminApi("/api/service-admin/map/save", { world: original });
  }
}

async function assertServiceAdminShowsActiveVisitors(hostedA, hostedB) {
  if (!SERVICE_ADMIN_PASSWORD) return;

  const siteAdminA = await adminSiteApi(hostedA.site.siteKey, hostedA.adminToken);
  assert(siteAdminA.scene.activeVisitors === 1, "site admin did not show hosted site A's active visitor");
  assert(
    siteAdminA.scene.visitors[0]?.displayName === "Named Visitor",
    "site admin active visitor did not include display name",
  );
  assert(
    !Object.hasOwn(siteAdminA.scene.visitors[0] || {}, "browserId"),
    "site admin visitor payload leaked browserId",
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

async function assertPublicStatsEndpoint({ minRegistered = 0, minVerified = 0, minMessages = 0 } = {}) {
  const response = await fetch(`${HTTP_ORIGIN}/api/stats`);
  assert(response.ok, "stats endpoint failed");
  assert(
    response.headers.get("access-control-allow-origin") === "*",
    "stats endpoint is missing cross-origin headers",
  );

  const body = await response.json();
  assert(typeof body.registered === "number", "stats.registered is missing");
  assert(typeof body.verified === "number", "stats.verified is missing");
  assert(typeof body.messages === "number", "stats.messages is missing");
  assert(body.registered >= minRegistered, "stats.registered was too low");
  assert(body.verified >= minVerified, "stats.verified was too low");
  assert(body.messages >= minMessages, "stats.messages was too low");
  assert(body.verified <= body.registered, "stats.verified exceeded stats.registered");
  return body;
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

function assertRateLimited(close) {
  assert(close.code === 1008, `expected rate-limit close code 1008, got ${close.code}`);
  assert(close.reason === "rate limited", `expected rate-limit reason, got ${close.reason}`);
}

async function assertIpLimits() {
  assert(process.env.IP_MAX_IDENTITIES === "2", "IP limit smoke test requires IP_MAX_IDENTITIES=2");
  assert(process.env.IP_JOIN_LIMIT === "2", "IP limit smoke test requires IP_JOIN_LIMIT=2");
  assert(process.env.IP_STATE_EVENT_LIMIT === "3", "IP limit smoke test requires IP_STATE_EVENT_LIMIT=3");
  assert(process.env.IP_CHAT_EVENT_LIMIT === "2", "IP limit smoke test requires IP_CHAT_EVENT_LIMIT=2");

  const identitySite = await createSite("IP identity limits");
  const identityArgs = { siteKey: identitySite.site.siteKey, origin: HTTP_ORIGIN, ip: "192.0.2.10" };
  const first = await connect({ ...identityArgs, x: 0.2, browserId: "ip-first" });
  const sameIdentity = await connect({
    ...identityArgs,
    x: 0.3,
    browserId: "ip-first",
    browserSecret: first.hello.browserSecret,
  });
  const second = await connect({ ...identityArgs, x: 0.5, browserId: "ip-second" });
  assert(first.id === sameIdentity.id, "same identity should not consume another IP identity slot");
  assertRateLimited(await connectUntilClose({ ...identityArgs, x: 0.7, browserId: "ip-third" }));
  const otherIp = await connect({ ...identityArgs, ip: "192.0.2.11", x: 0.8, browserId: "other-ip" });
  first.ws.close();
  sameIdentity.ws.close();
  second.ws.close();
  otherIp.ws.close();

  const joinSite = await createSite("IP join limits");
  const joinArgs = { siteKey: joinSite.site.siteKey, origin: HTTP_ORIGIN, ip: "192.0.2.20" };
  for (const browserId of ["join-one", "join-two"]) {
    const visitor = await connect({ ...joinArgs, x: 0.4, browserId });
    visitor.ws.close();
    await delay(1700);
  }
  assertRateLimited(await connectUntilClose({ ...joinArgs, x: 0.4, browserId: "join-three" }));

  const stateSite = await createSite("IP state limits");
  const stateObserver = await connect({
    siteKey: stateSite.site.siteKey,
    origin: HTTP_ORIGIN,
    ip: "192.0.2.31",
    x: 0.1,
    browserId: "state-observer",
  });
  const stateSender = await connect({
    siteKey: stateSite.site.siteKey,
    origin: HTTP_ORIGIN,
    ip: "192.0.2.30",
    x: 0.2,
    browserId: "state-sender",
  });
  for (const x of [0.3, 0.4, 0.5]) {
    stateSender.ws.send(JSON.stringify({ type: "move", x }));
    await delay(50);
  }
  const stateClose = waitForClose(stateSender.ws);
  stateSender.ws.send(JSON.stringify({ type: "move", x: 0.6 }));
  assertRateLimited(await stateClose);
  assert(
    stateObserver.seen.filter((message) => message.type === "move" && message.id === stateSender.id).length === 3,
    "state-event IP limit did not stop the fourth movement",
  );
  stateObserver.ws.close();

  const chatSite = await createSite("IP chat limits");
  await postJson("/api/admin/action", {
    siteKey: chatSite.site.siteKey,
    adminToken: chatSite.adminToken,
    action: "updateModeration",
    blockedWords: [],
    chatThrottleMs: 0,
  });
  const chatObserver = await connect({
    siteKey: chatSite.site.siteKey,
    origin: HTTP_ORIGIN,
    ip: "192.0.2.41",
    x: 0.1,
    browserId: "chat-observer",
  });
  const chatSender = await connect({
    siteKey: chatSite.site.siteKey,
    origin: HTTP_ORIGIN,
    ip: "192.0.2.40",
    x: 0.2,
    browserId: "chat-sender",
  });
  for (const text of ["one", "two"]) {
    chatSender.ws.send(JSON.stringify({ type: "say", text }));
    await delay(25);
  }
  const chatClose = waitForClose(chatSender.ws);
  chatSender.ws.send(JSON.stringify({ type: "say", text: "three" }));
  assertRateLimited(await chatClose);
  assert(
    chatObserver.seen.filter((message) => message.type === "say" && message.id === chatSender.id).length === 2,
    "chat-event IP limit did not stop the third message",
  );
  chatObserver.ws.close();
}

async function assertIpActionQuarantine() {
  assert(process.env.IP_MAX_IDENTITIES === "2", "IP quarantine smoke test requires IP_MAX_IDENTITIES=2");
  assert(process.env.IP_SYNC_ACTION_ROUNDS === "2", "IP quarantine smoke test requires IP_SYNC_ACTION_ROUNDS=2");

  const site = await createSite("IP action quarantine");
  const normal = await connect({
    siteKey: site.site.siteKey,
    origin: HTTP_ORIGIN,
    ip: "192.0.2.50",
    x: 0.2,
    browserId: "normal-jumper",
  });
  for (let index = 0; index < 3; index += 1) {
    normal.ws.send(JSON.stringify({ type: "action", action: "jump" }));
    await delay(600);
  }
  assert(normal.ws.readyState === WebSocket.OPEN, "one repetitive visitor should not be quarantined");

  const actionArgs = { siteKey: site.site.siteKey, origin: HTTP_ORIGIN, ip: "192.0.2.51" };
  const first = await connect({ ...actionArgs, x: 0.4, browserId: "sync-first" });
  const second = await connect({ ...actionArgs, x: 0.6, browserId: "sync-second" });
  const firstClose = waitForClose(first.ws);
  const secondClose = waitForClose(second.ws);

  for (let round = 0; round < 2; round += 1) {
    first.ws.send(JSON.stringify({ type: "action", action: "jump" }));
    second.ws.send(JSON.stringify({ type: "action", action: "jump" }));
    if (round === 0) await delay(600);
  }

  const closes = await Promise.all([firstClose, secondClose]);
  closes.forEach(assertRateLimited);
  assertRateLimited(await connectUntilClose({ ...actionArgs, x: 0.5, browserId: "sync-rejoin" }));

  const otherIp = await connect({ ...actionArgs, ip: "192.0.2.52", x: 0.8, browserId: "quarantine-other-ip" });
  normal.ws.close();
  otherIp.ws.close();
}

async function main() {
  const inactiveMs = Number(process.env.INACTIVE_DISCONNECT_MS || 0);
  if (inactiveMs > 0 && inactiveMs <= 5000) {
    await assertInactiveDisconnect();
    console.log("Inactive disconnect smoke test passed.");
    return;
  }
  if (process.env.TEST_IP_LIMITS === "1") {
    await assertIpLimits();
    console.log("IP limit smoke test passed.");
    return;
  }
  if (process.env.TEST_IP_QUARANTINE === "1") {
    await assertIpActionQuarantine();
    console.log("IP action quarantine smoke test passed.");
    return;
  }

  await assertEmbeddableAssetsAreCrossOriginLoadable();
  await assertMapWorldSizingPolicy();
  await assertServiceAdminCanEditMap();

  const first = await connect({
    x: 0.25,
    browserId: "browser-a",
    displayName: "  Ada    Lovelace  ",
    color: "#3f7f63",
    readingLabel: "  Launch    notes  ",
    readingUrl: `${HTTP_ORIGIN}/notes/launch`,
  });
  const secondSameBrowser = await connect({
    x: 0.75,
    browserId: "browser-a",
    browserSecret: first.hello.browserSecret,
  });

  await delay(100);

  assert(first.id === secondSameBrowser.id, "same-browser tabs did not reuse one shared identity");
  assert(first.hello.displayName === "Ada Lovelace", "display name was not normalized on init");
  assert(first.hello.color === "#3f7f63", "character color was not accepted on init");
  assert(first.hello.readingLabel === "launch", "reading label was not derived from the URL on init");
  assert(first.hello.readingUrl === `${HTTP_ORIGIN}/notes/launch`, "reading URL was not accepted on init");
  assert(first.hello.readingActive === true, "reading should default to active on init");
  assert(typeof first.hello.browserSecret === "string" && first.hello.browserSecret.length > 0, "hello did not include browser secret");
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
  assert(!Object.hasOwn(third.hello.peers[0], "browserId"), "peer snapshot leaked browserId");
  assert(first.seen.some((message) => message.type === "join" && message.peer.id === third.id), "first client did not observe different-browser join");
  const joinBroadcast = first.seen.find((message) => message.type === "join" && message.peer?.id === third.id);
  assert(joinBroadcast && !Object.hasOwn(joinBroadcast.peer, "browserId"), "join broadcast leaked browserId");

  const impersonator = await connect({ x: 0.8, browserId: "browser-a", ip: "192.0.2.60" });
  assert(impersonator.id !== first.id, "stolen browserId reused victim visitor id");
  assert(impersonator.hello.displayName !== "Ada Lovelace", "stolen browserId hijacked victim profile");

  const birdSpawn = await waitFor(
    () => findLast(first.seen, (message) => message.type === "bird" && message.action === "spawn")
      || first.hello.birds?.[0]
      || third.hello.birds?.[0],
    "ambient bird was never available in the scene",
    { timeout: 4000 },
  );
  assert(typeof birdSpawn.x === "number", "bird spawn did not include x");

  const birdJoiner = await connect({ x: 0.4, browserId: "browser-bird-sync", ip: "192.0.2.61" });
  await delay(100);

  assert(Array.isArray(birdJoiner.hello.birds), "hello did not include birds snapshot");
  assert(
    birdJoiner.hello.birds.some((bird) => bird.id === birdSpawn.id && bird.perchId === birdSpawn.perchId),
    "hello birds snapshot did not match spawned bird",
  );

  third.ws.send(JSON.stringify({ type: "move", x: birdSpawn.x }));
  await delay(100);

  assert(
    first.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "first client did not receive bird flee broadcast",
  );
  assert(
    third.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "approaching visitor did not receive bird flee event",
  );
  assert(
    birdJoiner.seen.some((message) => message.type === "bird" && message.action === "flee" && message.id === birdSpawn.id),
    "other visitor did not receive bird flee broadcast",
  );

  birdJoiner.ws.close();
  await delay(100);

  secondSameBrowser.ws.send(JSON.stringify({
    type: "reading",
    readingLabel: "API reference",
    readingUrl: `${HTTP_ORIGIN}/docs/api`,
  }));
  await delay(100);

  assert(
    first.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingLabel === "api"
      && message.readingUrl === `${HTTP_ORIGIN}/docs/api`
    )),
    "reading update did not propagate to same-browser sibling",
  );
  assert(
    third.seen.some((message) => (
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
  await delay(100);

  assert(
    third.seen.some((message) => (
      message.type === "reading"
      && message.id === first.id
      && message.readingActive === false
    )),
    "reading inactive state did not propagate when every same-browser tab was inactive",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "profile", displayName: "Ada", color: "#3f6fb5" }));
  await delay(100);

  assert(
    first.seen.some((message) => (
      message.type === "profile"
      && message.id === first.id
      && message.displayName === "Ada"
      && message.color === "#3f6fb5"
    )),
    "profile update did not propagate to same-browser sibling",
  );
  assert(
    third.seen.some((message) => (
      message.type === "profile"
      && message.id === first.id
      && message.displayName === "Ada"
      && message.color === "#3f6fb5"
    )),
    "profile update did not propagate to other visitors",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.58 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "typing", typing: true }));
  await delay(100);
  assert(third.seen.some((message) => message.type === "typing" && message.id === first.id && message.typing === true), "different browser did not observe typing start");
  secondSameBrowser.ws.send(JSON.stringify({ type: "typing", typing: false }));
  await delay(100);
  assert(third.seen.some((message) => message.type === "typing" && message.id === first.id && message.typing === false), "different browser did not observe typing stop");
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: "hello from shared browser" }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: "this should be rate-limited away" }));
  await delay(100);

  assert(first.seen.some((message) => message.type === "move" && message.id === first.id), "same-browser move did not propagate to sibling tab");
  assert(first.seen.some((message) => message.type === "say" && message.id === first.id), "same-browser chat did not propagate to sibling tab");
  assert(third.seen.some((message) => message.type === "move" && message.id === first.id), "different browser did not observe shared visitor movement");
  assert(third.seen.some((message) => message.type === "say" && message.id === first.id), "different browser did not observe shared visitor chat");
  assert(
    !third.seen.some((message) => message.type === "say" && message.id === first.id && message.text === "this should be rate-limited away"),
    "chat rate limit did not suppress a rapid second message",
  );

  secondSameBrowser.ws.send(JSON.stringify({ type: "action", action: "jump" }));
  await delay(100);

  assert(first.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "jump"), "same-browser jump did not propagate to sibling tab");
  assert(third.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "jump"), "different browser did not observe shared visitor jump");

  await delay(600);
  third.ws.send(JSON.stringify({ type: "move", x: 0.6 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "action", action: "raise-hand" }));
  await delay(100);

  assert(first.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "raise-hand"), "same-browser raise-hand did not propagate to sibling tab");
  assert(third.seen.some((message) => message.type === "action" && message.id === first.id && message.action === "raise-hand"), "different browser did not observe shared visitor raise-hand");

  third.ws.send(JSON.stringify({ type: "action", action: "high-five", targetId: first.id }));
  await delay(100);

  assert(first.seen.some((message) => message.type === "action" && message.id === third.id && message.action === "high-five" && message.targetId === first.id), "target visitor did not observe high-five");
  assert(secondSameBrowser.seen.some((message) => message.type === "action" && message.id === third.id && message.action === "high-five" && message.targetId === first.id), "same-browser tab did not observe high-five targeting shared visitor");

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
  await delay(100);

  const firstBenchState = findLast(first.seen, (message) => message.type === "move" && message.id === first.id && message.pose === "sitting");
  const thirdBenchState = findLast(third.seen, (message) => message.type === "move" && message.id === first.id && message.pose === "sitting");

  assert(firstBenchState, "same-browser bench settle did not propagate to sibling tab");
  assert(thirdBenchState, "bench settle did not propagate to other visitors");

  third.ws.send(JSON.stringify({ type: "move", x: 0.2 }));
  await delay(100);
  third.ws.send(JSON.stringify({ type: "settle", propId: "bench" }));
  await delay(100);

  const thirdSeatState = findLast(first.seen, (message) => message.type === "move" && message.id === third.id && message.pose === "sitting");
  assert(thirdSeatState, "second visitor did not settle onto the bench");
  assert(Math.abs(thirdSeatState.x - firstBenchState.x) > 0.005, "bench seat allocation reused an occupied seat");

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.8 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "settle", propId: "tree" }));
  await delay(100);

  const firstTreeState = findLast(first.seen, (message) => (
    message.type === "move"
    && message.id === first.id
    && message.pose === "resting"
    && message.propId === "tree"
  ));
  const thirdTreeState = findLast(third.seen, (message) => (
    message.type === "move"
    && message.id === first.id
    && message.pose === "resting"
    && message.propId === "tree"
  ));

  assert(firstTreeState, "same-browser tree settle did not propagate to sibling tab");
  assert(thirdTreeState, "tree settle did not propagate to other visitors");

  third.ws.send(JSON.stringify({ type: "move", x: 0.8 }));
  await delay(100);
  third.ws.send(JSON.stringify({ type: "settle", propId: "tree" }));
  await delay(100);

  const thirdTreeSeatState = findLast(first.seen, (message) => (
    message.type === "move"
    && message.id === third.id
    && message.pose === "resting"
    && message.propId === "tree"
  ));
  assert(thirdTreeSeatState, "second visitor did not settle under the tree");
  assert(Math.abs(thirdTreeSeatState.x - firstTreeState.x) > 0.005, "tree seat allocation reused an occupied seat");

  secondSameBrowser.ws.close();
  await delay(100);

  assert(!first.seen.some((message) => message.type === "leave" && message.id === first.id), "closing one same-browser tab incorrectly removed the shared visitor");

  third.ws.close();
  await delay(1700);

  assert(first.seen.some((message) => message.type === "leave" && message.id === third.id), "first client did not observe different-browser leave");

  await assertCustomizationPersists();
  await assertMatchingWwwOriginsWork();
  await assertOwnerProfilePersists();
  await assertModerationTools();
  await assertHideVisitor();
  await assertPerSiteConnectionLimit();

  const hostedA = await createSite("Smoke A");
  const hostedB = await createSite("Smoke B");
  assertAdminTokenStoredAsHash(hostedA.site.siteKey, hostedA.adminToken);
  assertAdminTokenStoredAsHash(hostedB.site.siteKey, hostedB.adminToken);
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

  const statsBeforeChat = await assertPublicStatsEndpoint({ minRegistered: 2, minVerified: 2 });
  siteAVisitor.ws.send(JSON.stringify({ type: "say", text: "hello from smoke test" }));
  await delay(100);
  const statsAfterChat = await assertPublicStatsEndpoint({
    minRegistered: statsBeforeChat.registered,
    minVerified: statsBeforeChat.verified,
    minMessages: statsBeforeChat.messages + 1,
  });
  assert(statsAfterChat.messages === statsBeforeChat.messages + 1, "stats.messages did not increment after chat");

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
  await assertServiceAdminShowsActiveVisitors(hostedA, hostedB);

  siteAVisitor.ws.close();
  siteBVisitor.ws.close();
  await assertServiceAdminCanManageSites(hostedA, hostedB);
  await assertAuthFailuresAreThrottled(hostedA);
  await assertServiceAdminFailuresAreThrottled();

  console.log("Smoke test passed.");
  first.ws.close();
}

async function run() {
  // If an external server origin is provided, test against it (legacy behavior).
  // Otherwise spawn and manage our own so the script is self-contained.
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const cleanup = external ? null : await startManagedServer();
  try {
    await main();
  } finally {
    cleanup?.();
  }
}

run().catch((error) => {
  console.error(error.stack || `Smoke test failed: ${error.message}`);
  process.exit(1);
});
