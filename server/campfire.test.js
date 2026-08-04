"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createCampfirePlugin } = require("../plugins/campfire");

const coreUrl = pathToFileURL(path.join(__dirname, "..", "public", "lib", "site-config-core.mjs")).href;
const viewUrl = pathToFileURL(path.join(__dirname, "..", "public", "widget", "campfire.mjs")).href;

test("campfire add-on is free, toggleable, and has no parallel socket state", () => {
  const plugin = createCampfirePlugin();
  assert.equal(plugin.name, "campfire");
  assert.equal(plugin.tier, "free");
  assert.equal(plugin.label, "Campfire");
  assert.equal(plugin.sceneEntity, undefined);
  assert.equal(plugin.onSocketMessage, undefined);
});

test("campfire builds four distinct authoritative seats inside its settle zone", async () => {
  const { REFERENCE_STAGE_WIDTH, buildSceneProps, sanitizeSceneConfig } = await import(coreUrl);
  const scene = sanitizeSceneConfig({ campfires: 9, campfireXs: [0.5] });
  assert.equal(scene.campfires, 1);

  const fire = buildSceneProps(scene).find((prop) => prop.id === "campfire");
  assert.ok(fire);
  assert.equal(fire.pose, "sitting");
  assert.equal(fire.faceAway, true);
  assert.equal(fire.seats.length, 4);
  assert.equal(new Set(fire.seats).size, 4);
  const halfWidth = fire.width / 2 / REFERENCE_STAGE_WIDTH;
  assert.ok(fire.seats.every((offset) => Math.abs(offset) <= halfWidth));
});

test("campfire strength uses exact visible prop membership and caps at four", async () => {
  const { campfireStrength } = await import(viewUrl);
  const visible = [
    { propId: "campfire" },
    { propId: "bench" },
    { propId: "campfire-2" },
    { propId: "campfire" },
    { propId: "campfire" },
    { propId: "campfire" },
    { propId: "campfire" },
  ];
  assert.equal(campfireStrength(visible, "campfire"), 4);
  assert.equal(campfireStrength(visible, "campfire-2"), 1);
  assert.equal(campfireStrength(visible, "missing"), 0);
  assert.equal(campfireStrength([], "campfire"), 0);
});
