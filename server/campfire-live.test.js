"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { startManagedServer } = require("../scripts/lib/managed-server");
const { handleSmokeSocketMessage, withTimeout } = require("../scripts/smoke-ws-helpers");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(origin, pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function connect(managed, siteKey, browserId, index) {
  return withTimeout(new Promise((resolve, reject) => {
    const ws = new WebSocket(`${managed.wsOrigin}/live?siteKey=${encodeURIComponent(siteKey)}`, {
      headers: { Origin: managed.httpOrigin, "X-Real-IP": `192.0.2.${20 + index}` },
    });
    const seen = [];
    ws.on("open", () => ws.send(JSON.stringify({ type: "init", browserId, x: 0.5 })));
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        handleSmokeSocketMessage(ws, message, {
          seen,
          onHello: (hello) => resolve({ ws, seen, hello }),
        });
      } catch (error) {
        reject(error);
      }
    });
    ws.on("error", reject);
  }), 8000, `campfire visitor ${browserId}`);
}

test("live campfire uses four presence seats, public chat, and normal pose cleanup", async (t) => {
  const managed = await startManagedServer({
    dataPrefix: "townsquare-campfire-",
    env: { MIN_HUMAN_SAY_MS: "0", POW_DIFFICULTY_BITS: "1" },
    captureOutput: true,
  });
  t.after(async () => managed.cleanup());

  const registration = await post(managed.httpOrigin, "/api/sites", {
    name: "Campfire test",
    origin: managed.httpOrigin,
  });
  assert.equal(registration.response.ok, true, registration.body.error);
  const { siteKey } = registration.body.site;
  const { adminToken } = registration.body;

  const toggle = await post(managed.httpOrigin, "/api/admin/action", {
    siteKey, adminToken, action: "setPluginEnabled", name: "campfire", enabled: true,
  });
  assert.equal(toggle.response.ok, true, toggle.body.error);

  const visitors = [];
  for (let index = 0; index < 5; index += 1) {
    visitors.push(await connect(managed, siteKey, `campfire-${index}`, index));
  }
  assert.equal(visitors[0].hello.scene.campfires, 1);

  for (const visitor of visitors) {
    visitor.ws.send(JSON.stringify({ type: "settle", propId: "campfire" }));
    await delay(60);
  }

  const admin = await post(managed.httpOrigin, "/api/admin/site", { siteKey, adminToken });
  const seated = admin.body.scene.visitors.filter((visitor) => visitor.propId === "campfire");
  assert.equal(seated.length, 4, "a fifth visitor must not displace an occupied fire seat");
  assert.equal(new Set(seated.map((visitor) => visitor.x)).size, 4, "fire seats must be distinct");

  const sitter = visitors.find((visitor) => seated.some((entry) => entry.id === visitor.hello.id));
  const bystander = visitors.find((visitor) => !seated.some((entry) => entry.id === visitor.hello.id));
  sitter.ws.send(JSON.stringify({ type: "say", text: "still public" }));
  await delay(100);
  assert.ok(bystander.seen.some((message) => message.type === "say" && message.text === "still public"));

  sitter.ws.send(JSON.stringify({ type: "action", action: "jump" }));
  await delay(100);
  const afterJump = await post(managed.httpOrigin, "/api/admin/site", { siteKey, adminToken });
  const jumped = afterJump.body.scene.visitors.find((visitor) => visitor.id === sitter.hello.id);
  assert.equal(jumped.propId, null, "ordinary actions must stand a sitter up");
  assert.equal(jumped.pose, null);

  sitter.ws.send(JSON.stringify({ type: "move", x: 0.5 }));
  await delay(60);
  sitter.ws.send(JSON.stringify({ type: "settle", propId: "campfire" }));
  await delay(80);
  const disable = await post(managed.httpOrigin, "/api/admin/action", {
    siteKey, adminToken, action: "setPluginEnabled", name: "campfire", enabled: false,
  });
  assert.equal(disable.response.ok, true, disable.body.error);
  await delay(80);
  assert.ok(visitors[0].seen.some((message) => message.type === "scene" && message.scene?.campfires === 0));
  const afterRemoval = await post(managed.httpOrigin, "/api/admin/site", { siteKey, adminToken });
  assert.ok(afterRemoval.body.scene.visitors.every((visitor) => visitor.propId !== "campfire" && visitor.pose !== "sitting"));

  for (const visitor of visitors) visitor.ws.close();
});
