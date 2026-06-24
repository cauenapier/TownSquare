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

test("visitor extensions are namespaced and browser modules respect enablement", () => {
  const manager = new PluginManager();
  manager.register({
    name: "owner-figure",
    adminModule: "/pro/owner-figure/admin.mjs",
    widgetModule: "/pro/owner-figure/widget.mjs",
    isEnabled: ({ site }) => site.supporter,
    extendVisitor: (_visitor, { data, visitor }) => (visitor.isOwner ? data : undefined),
  });
  const context = (site, visitor) => () => ({
    site,
    visitor,
    data: { hat: "top-hat" },
  });

  assert.deepEqual(
    manager.extendVisitor(
      { id: 1, displayName: "Owner" },
      context({ supporter: true }, { isOwner: true }),
    ),
    {
      id: 1,
      displayName: "Owner",
      plugins: { "owner-figure": { hat: "top-hat" } },
    },
  );
  assert.deepEqual(manager.browserModules("admin", context({ supporter: true }, {})), [
    { name: "owner-figure", module: "/pro/owner-figure/admin.mjs" },
  ]);
  assert.deepEqual(manager.browserModules("widget", context({ supporter: false }, {})), []);
});

test("labelled plugins stay off until a site enables them", () => {
  const manager = new PluginManager();
  const calls = [];
  manager.register({
    name: "telegram",
    label: "Telegram notifications",
    description: "Forward chat messages to Telegram.",
    onMessage: () => calls.push("telegram"),
    adminModule: "/pro/telegram/admin.mjs",
  });

  assert.deepEqual(manager.toggleable(), [
    { name: "telegram", label: "Telegram notifications", description: "Forward chat messages to Telegram." },
  ]);

  // Off by default and whenever the site has not opted in.
  manager.run("onMessage", () => ({ enabled: false }));
  manager.run("onMessage", () => ({}));
  assert.deepEqual(calls, []);
  assert.deepEqual(manager.browserModules("admin", () => ({ enabled: false })), []);

  // Active only once the site switches it on.
  manager.run("onMessage", () => ({ enabled: true }));
  assert.deepEqual(calls, ["telegram"]);
  assert.deepEqual(manager.browserModules("admin", () => ({ enabled: true })), [
    { name: "telegram", module: "/pro/telegram/admin.mjs" },
  ]);
});

test("toggleable plugins are filtered to entitled sites", () => {
  const manager = new PluginManager();
  const calls = [];
  manager.register({
    name: "owner-figure",
    label: "Owner figure",
    isEnabled: ({ site }) => site?.pro === true,
    onMessage: () => calls.push("owner-figure"),
  });

  // Listed everywhere when no context is given; hidden where the site lacks the
  // entitlement, even if its toggle is on.
  assert.deepEqual(manager.toggleable().map((plugin) => plugin.name), ["owner-figure"]);
  assert.deepEqual(manager.toggleable(() => ({ site: { pro: false }, enabled: true })), []);
  assert.deepEqual(
    manager.toggleable(() => ({ site: { pro: true } })).map((plugin) => plugin.name),
    ["owner-figure"],
  );

  // A pro site still has to switch it on for it to actually run.
  manager.run("onMessage", () => ({ site: { pro: true }, enabled: false }));
  manager.run("onMessage", () => ({ site: { pro: false }, enabled: true }));
  assert.deepEqual(calls, []);
  manager.run("onMessage", () => ({ site: { pro: true }, enabled: true }));
  assert.deepEqual(calls, ["owner-figure"]);
});

test("plugin metadata must be non-empty strings", () => {
  const manager = new PluginManager();
  assert.throws(() => manager.register({ name: "a", label: "" }), /label must be a non-empty string/);
  assert.throws(() => manager.register({ name: "b", description: 5 }), /description must be a non-empty string/);
});

test("plugin admin actions receive only their scoped context", () => {
  const manager = new PluginManager();
  let saved = null;
  manager.register({
    name: "owner-figure",
    adminActions: {
      update({ setData }, input) {
        setData({ hat: input.hat });
      },
    },
  });

  const invoked = manager.invokeAdminAction(
    "owner-figure",
    "update",
    () => ({ setData: (value) => { saved = value; } }),
    { hat: "top-hat" },
  );

  assert.equal(invoked.found, true);
  assert.deepEqual(saved, { hat: "top-hat" });
  assert.deepEqual(manager.invokeAdminAction("owner-figure", "missing", {}, {}), { found: false });
});
