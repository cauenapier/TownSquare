"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PluginManager } = require("./plugins");

test("plugins run in registration order and can stop a core action", () => {
  const calls = [];
  const manager = new PluginManager();
  manager.register({ name: "analytics", onMessage: () => calls.push("analytics") });
  manager.register({ name: "moderation", onMessage: () => false });
  manager.register({ name: "notifications", onMessage: () => calls.push("notifications") });

  assert.equal(manager.run("onMessage", { message: { text: "hello" } }), false);
  assert.deepEqual(calls, ["analytics"]);
});

test("extension hooks compose returned values", () => {
  const manager = new PluginManager();
  manager.register({
    name: "supporter-badges",
    extendWidgetConfig: (config) => ({ ...config, supporter: true }),
  });
  manager.register({
    name: "custom-themes",
    extendWidgetConfig: (config) => ({ ...config, themeName: "midnight" }),
  });

  assert.deepEqual(
    manager.extend("extendWidgetConfig", { siteKey: "site_1" }),
    { siteKey: "site_1", supporter: true, themeName: "midnight" },
  );
});

test("registration rejects duplicate names and unknown hooks", () => {
  const manager = new PluginManager();
  manager.register({ name: "analytics" });

  assert.throws(() => manager.register({ name: "analytics" }), /already registered/);
  assert.throws(
    () => manager.register({ name: "moderation", beforeEverything() {} }),
    /Unknown TownSquare plugin hook/,
  );
});
