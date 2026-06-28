const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(ROOT, "server.js");

const EXPECT_POW = process.env.EXPECT_POW === "1";
const EXPECT_FRESH_CHAT_BLOCK = process.env.EXPECT_FRESH_CHAT_BLOCK === "1";
const EXPECT_PUBLIC_NAME_GATE = process.env.EXPECT_PUBLIC_NAME_GATE === "1";

const CHALLENGE_TIMEOUT_MS = Number(process.env.BOT_REPLAY_TIMEOUT_MS || 8000);

function randomPort() {
  return 10000 + Math.floor(Math.random() * 40000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 5000, intervalMs = 50) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await delay(intervalMs);
  }
  throw new Error(message);
}

function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function solveChallenge({ salt, difficulty }) {
  for (let nonce = 0; ; nonce += 1) {
    const digest = crypto.createHash("sha256").update(`${salt}:${nonce}`).digest();
    if (leadingZeroBits(digest) >= difficulty) return String(nonce);
  }
}

async function startServer() {
  const port = Number(process.env.TOWNSQUARE_BOT_REPLAY_PORT || randomPort());
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "townsquare-bot-replay-"));
  const publicOrigin = `http://127.0.0.1:${port}`;
  const wsOrigin = `ws://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_ORIGIN: publicOrigin,
      SERVICE_ADMIN_PASSWORD: process.env.SERVICE_ADMIN_PASSWORD || "bot-replay-pass",
      IP_MAX_IDENTITIES: process.env.IP_MAX_IDENTITIES || "2",
      IP_JOIN_LIMIT: process.env.IP_JOIN_LIMIT || "30",
      IP_STATE_EVENT_LIMIT: process.env.IP_STATE_EVENT_LIMIT || "120",
      IP_CHAT_EVENT_LIMIT: process.env.IP_CHAT_EVENT_LIMIT || "10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`${publicOrigin}/`);
        return response.status > 0;
      } catch {
        return false;
      }
    }, `server did not start on ${publicOrigin}`);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return {
    child,
    dataDir,
    port,
    publicOrigin,
    wsOrigin,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function stopServer(server) {
  if (!server) return;
  server.child.kill("SIGTERM");
  await new Promise((resolve) => server.child.once("exit", resolve));
  await fs.rm(server.dataDir, { recursive: true, force: true });
}

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { response, body: json };
}

function socketUrl(baseWsUrl, siteKey = "") {
  const url = new URL(`${baseWsUrl}/live`);
  if (siteKey) url.searchParams.set("siteKey", siteKey);
  return url.toString();
}

function createBotClient({ baseWsUrl, origin, siteKey = "", browserId, displayName = "", color = "#5f6b73", x = 0.4 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(baseWsUrl, siteKey), { headers: { Origin: origin } });
    const seen = [];
    let hello = null;
    let challenge = null;
    let closeInfo = null;
    let settled = false;

    const initPayload = {
      type: "init",
      browserId,
      browserSecret: "",
      x,
      displayName,
      color,
      readingUrl: origin,
      readingActive: true,
    };

    function finishError(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function finishSuccess() {
      if (settled) return;
      settled = true;
      resolve({ ws, seen, hello, challenge, closeInfo });
    }

    ws.on("open", () => {
      ws.send(JSON.stringify(initPayload));
    });

    ws.on("message", (buffer) => {
      let message;
      try {
        message = JSON.parse(String(buffer));
      } catch (error) {
        finishError(error);
        return;
      }
      seen.push(message);

      if (message.type === "challenge") {
        challenge = message;
        const nonce = solveChallenge(message);
        ws.send(JSON.stringify({ type: "solve", nonce }));
        return;
      }

      if (message.type === "hello") {
        hello = message;
        finishSuccess();
      }
    });

    ws.on("close", (code, reason) => {
      closeInfo = { code, reason: String(reason) };
      if (!settled) {
        resolve({ ws, seen, hello, challenge, closeInfo });
      }
    });

    ws.on("error", (error) => {
      if (closeInfo) return;
      finishError(error);
    });

    setTimeout(() => {
      if (!settled) {
        resolve({ ws, seen, hello, challenge, closeInfo });
      }
    }, CHALLENGE_TIMEOUT_MS);
  });
}

async function createSite(baseUrl, origin, name) {
  const { response, body } = await postJson(baseUrl, "/api/sites", { name, origin });
  assert.equal(response.status, 201, body.error || "site registration failed");
  return body;
}

async function adminAction(baseUrl, siteKey, adminToken, action, data = {}) {
  const { response, body } = await postJson(baseUrl, "/api/admin/action", {
    siteKey,
    adminToken,
    action,
    ...data,
  });
  assert.equal(response.status, 200, body.error || `admin action failed: ${action}`);
  return body;
}

async function expectJoin(params) {
  const client = await createBotClient(params);
  assert(client.hello, `expected join for ${params.browserId}, but never received hello`);
  return client;
}

async function expectNoJoin(params) {
  const client = await createBotClient(params);
  assert(!client.hello, `unexpectedly joined as ${params.browserId}`);
  return client;
}

async function run() {
  const server = await startServer();
  const openSockets = [];

  try {
    console.log(`Started isolated TownSquare on ${server.publicOrigin}`);

    const defaultJoin = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      browserId: "baseline-join",
      displayName: "baseline",
    });
    openSockets.push(defaultJoin.ws);
    console.log("✓ same-origin visitor can join");

    const wrongOrigin = await expectNoJoin({
      baseWsUrl: server.wsOrigin,
      origin: "http://evil.example",
      browserId: "wrong-origin",
    });
    assert(wrongOrigin.closeInfo || wrongOrigin.seen.length === 0, "wrong-origin join neither closed nor stayed silent");
    console.log("✓ wrong-origin visitor cannot join the default scene");

    const hosted = await createSite(server.publicOrigin, server.publicOrigin, "Replay Site");
    if (EXPECT_POW) {
      await adminAction(server.publicOrigin, hosted.site.siteKey, hosted.adminToken, "setBotProtection", { enabled: true });
    }
    const hostedJoin = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      siteKey: hosted.site.siteKey,
      browserId: "hosted-ok",
      displayName: "hello",
    });
    openSockets.push(hostedJoin.ws);
    console.log("✓ hosted-site visitor can join from the registered origin");

    if (EXPECT_POW) {
      assert(hostedJoin.challenge, "expected a proof-of-work challenge before hosted-site hello");
      console.log("✓ proof-of-work challenge was required");
    } else if (defaultJoin.challenge || hostedJoin.challenge) {
      console.log("• proof-of-work challenge observed and solved");
    } else {
      console.log("• no proof-of-work challenge in this environment");
    }

    const hostedWrongOrigin = await expectNoJoin({
      baseWsUrl: server.wsOrigin,
      origin: "http://evil.example",
      siteKey: hosted.site.siteKey,
      browserId: "hosted-bad-origin",
    });
    assert(hostedWrongOrigin.closeInfo || hostedWrongOrigin.seen.length === 0, "wrong-origin hosted join neither closed nor stayed silent");
    console.log("✓ hosted-site wrong-origin visitor is rejected");

    defaultJoin.ws.close();
    hostedJoin.ws.close();
    await delay(120);

    const firstIpLimited = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      browserId: "ip-limit-1",
    });
    const secondIpLimited = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      browserId: "ip-limit-2",
    });
    openSockets.push(firstIpLimited.ws, secondIpLimited.ws);

    const thirdIpLimited = await expectNoJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      browserId: "ip-limit-3",
    });
    assert(!thirdIpLimited.hello, "third distinct identity should have been blocked by IP_MAX_IDENTITIES=2");
    console.log("✓ per-IP identity cap blocks the third distinct identity");

    const speaker = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      siteKey: hosted.site.siteKey,
      browserId: "chat-speaker",
      displayName: EXPECT_PUBLIC_NAME_GATE ? "" : "speaker",
    });
    const listener = await expectJoin({
      baseWsUrl: server.wsOrigin,
      origin: server.publicOrigin,
      siteKey: hosted.site.siteKey,
      browserId: "chat-listener",
    });
    openSockets.push(speaker.ws, listener.ws);

    if (EXPECT_PUBLIC_NAME_GATE) {
      assert(!speaker.hello.displayName, "expected fresh visitor display name to be hidden or empty");
      console.log("✓ fresh visitor public name is gated");
    } else {
      assert.equal(speaker.hello.displayName, "speaker", "fresh visitor display name unexpectedly changed");
      console.log("• fresh visitor public name is currently ungated");
    }

    await delay(1700);
    speaker.ws.send(JSON.stringify({ type: "say", text: "hi" }));
    await delay(200);

    const sawChat = listener.seen.some((message) => (
      message.type === "say"
      && message.id === speaker.hello.id
      && message.text === "hi"
    ));

    if (EXPECT_FRESH_CHAT_BLOCK) {
      assert(!sawChat, "expected fresh visitor chat to be blocked or quarantined");
      console.log("✓ fresh visitor chat is gated");
    } else {
      assert(sawChat, "expected fresh visitor chat to reach peers in the current baseline");
      console.log("• fresh visitor chat is currently ungated");
    }

    console.log("Bot replay test passed.");
  } finally {
    for (const ws of openSockets) {
      try {
        ws.close();
      } catch {
        // ignore — socket may already be closed
      }
    }
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
