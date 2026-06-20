"use strict";

const HOOKS = new Set([
  "onVisitorJoin",
  "onMessage",
  "onSocketMessage",
  "extendSiteConfig",
  "extendAdminPanel",
  "extendMapData",
  "extendWidgetConfig",
]);

class PluginManager {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.plugins = [];
    this.names = new Set();
  }

  register(plugin) {
    if (!plugin || typeof plugin !== "object") {
      throw new TypeError("TownSquare plugins must be objects");
    }

    const name = String(plugin.name || "").trim();
    if (!name) throw new TypeError("TownSquare plugins must have a name");
    if (this.names.has(name)) throw new Error(`TownSquare plugin already registered: ${name}`);

    for (const key of Object.keys(plugin)) {
      if (key !== "name" && typeof plugin[key] === "function" && !HOOKS.has(key)) {
        throw new Error(`Unknown TownSquare plugin hook: ${key}`);
      }
    }

    this.names.add(name);
    this.plugins.push({ ...plugin, name });
    return plugin;
  }

  run(hook, context) {
    this.assertHook(hook);
    for (const plugin of this.plugins) {
      const handler = plugin[hook];
      if (typeof handler !== "function") continue;
      try {
        const result = handler(context);
        if (result === false) return false;
        if (result && typeof result.then === "function") {
          void result.catch((error) => this.report(plugin.name, hook, error));
        }
      } catch (error) {
        this.report(plugin.name, hook, error);
      }
    }

    return true;
  }

  extend(hook, value, context = {}) {
    this.assertHook(hook);
    let current = value;

    for (const plugin of this.plugins) {
      const handler = plugin[hook];
      if (typeof handler !== "function") continue;
      try {
        const next = handler(current, context);
        if (next && typeof next.then === "function") {
          throw new TypeError("TownSquare extension hooks must be synchronous");
        }
        if (next !== undefined) current = next;
      } catch (error) {
        this.report(plugin.name, hook, error);
      }
    }

    return current;
  }

  assertHook(hook) {
    if (!HOOKS.has(hook)) throw new Error(`Unknown TownSquare plugin hook: ${hook}`);
  }

  report(pluginName, hook, error) {
    this.logger.warn(`TownSquare plugin ${pluginName} failed in ${hook}: ${error.message}`);
  }
}

const plugins = new PluginManager();

module.exports = {
  HOOKS,
  PluginManager,
  plugins,
  registerPlugin: (plugin) => plugins.register(plugin),
};
