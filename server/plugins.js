"use strict";

const HOOKS = new Set([
  "isEnabled",
  "onVisitorJoin",
  "onMessage",
  "onSocketMessage",
  "onSceneMove",
  "extendVisitor",
  "extendSiteConfig",
  "extendAdminPanel",
  "extendMapData",
  "extendWidgetConfig",
]);
const SCENE_ENTITY_FNS = ["create", "tick", "snapshot"];
const MODULE_PATH_RE = /^\/[A-Za-z0-9_./-]+\.mjs$/;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTION_RE = /^[A-Za-z][A-Za-z0-9]*$/;

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
    if (!NAME_RE.test(name)) throw new TypeError(`Invalid TownSquare plugin name: ${name}`);
    if (this.names.has(name)) throw new Error(`TownSquare plugin already registered: ${name}`);

    for (const key of Object.keys(plugin)) {
      if (key !== "name" && typeof plugin[key] === "function" && !HOOKS.has(key)) {
        throw new Error(`Unknown TownSquare plugin hook: ${key}`);
      }
    }

    for (const key of ["adminModule", "widgetModule"]) {
      if (plugin[key] !== undefined && !MODULE_PATH_RE.test(String(plugin[key]))) {
        throw new TypeError(`${key} must be a same-origin .mjs path`);
      }
    }
    // A plugin opts into the site-owner activation toggle by declaring a label.
    // Labelled plugins stay off until a site explicitly enables them; unlabelled
    // ones keep running globally as before.
    for (const key of ["label", "description"]) {
      if (plugin[key] !== undefined && (typeof plugin[key] !== "string" || !plugin[key].trim())) {
        throw new TypeError(`${key} must be a non-empty string`);
      }
    }
    if (plugin.adminActions !== undefined) {
      if (!plugin.adminActions || typeof plugin.adminActions !== "object" || Array.isArray(plugin.adminActions)) {
        throw new TypeError("adminActions must be an object");
      }
      for (const [action, handler] of Object.entries(plugin.adminActions)) {
        if (!ACTION_RE.test(action) || typeof handler !== "function") {
          throw new TypeError(`Invalid admin action: ${name}.${action}`);
        }
      }
    }
    if (plugin.sceneEntity !== undefined) {
      const entity = plugin.sceneEntity;
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        throw new TypeError("sceneEntity must be an object");
      }
      for (const fn of SCENE_ENTITY_FNS) {
        if (entity[fn] !== undefined && typeof entity[fn] !== "function") {
          throw new TypeError(`sceneEntity.${fn} must be a function`);
        }
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
        const pluginContext = this.contextFor(plugin, context);
        if (!this.isEnabled(plugin, pluginContext)) continue;
        const result = handler(pluginContext);
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
        const pluginContext = this.contextFor(plugin, context);
        if (!this.isEnabled(plugin, pluginContext)) continue;
        const next = handler(current, pluginContext);
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

  extendVisitor(visitor, context = {}) {
    const extensions = {};

    for (const plugin of this.plugins) {
      if (typeof plugin.extendVisitor !== "function") continue;
      try {
        const pluginContext = this.contextFor(plugin, context);
        if (!this.isEnabled(plugin, pluginContext)) continue;
        const value = plugin.extendVisitor(visitor, pluginContext);
        if (value && typeof value.then === "function") {
          throw new TypeError("TownSquare visitor extensions must be synchronous");
        }
        if (value !== undefined) {
          const json = JSON.stringify(value);
          if (json !== undefined) extensions[plugin.name] = value;
        }
      } catch (error) {
        this.report(plugin.name, "extendVisitor", error);
      }
    }

    return Object.keys(extensions).length > 0
      ? { ...visitor, plugins: extensions }
      : visitor;
  }

  browserModules(kind, context = {}) {
    const key = kind === "admin" ? "adminModule" : kind === "widget" ? "widgetModule" : "";
    if (!key) throw new Error(`Unknown TownSquare browser module kind: ${kind}`);
    const modules = [];

    for (const plugin of this.plugins) {
      if (!plugin[key]) continue;
      const pluginContext = this.contextFor(plugin, context);
      if (!this.isEnabled(plugin, pluginContext)) continue;
      modules.push({ name: plugin.name, module: plugin[key] });
    }

    return modules;
  }

  invokeAdminAction(pluginName, action, context, input) {
    const plugin = this.plugins.find((candidate) => candidate.name === pluginName);
    const handler = plugin?.adminActions?.[action];
    if (!plugin || typeof handler !== "function") return { found: false };

    const pluginContext = this.contextFor(plugin, context);
    if (!this.isEnabled(plugin, pluginContext)) return { found: false };
    try {
      const result = handler(pluginContext, input);
      if (result && typeof result.then === "function") {
        throw new TypeError("TownSquare admin actions must be synchronous");
      }
      return { found: true, result };
    } catch (error) {
      this.report(plugin.name, `adminActions.${action}`, error);
      return { found: true, error: "Plugin action failed." };
    }
  }

  hasSceneEntities() {
    return this.plugins.some((plugin) => plugin.sceneEntity);
  }

  /**
   * Seed per-scene state for every enabled scene-entity plugin. Existing state
   * is preserved across rebuilds so a customization change does not reset a
   * live entity; only newly enabled plugins are created and disabled ones drop.
   */
  createSceneEntityState(context, existing = {}) {
    const state = {};

    for (const plugin of this.plugins) {
      const entity = plugin.sceneEntity;
      if (!entity) continue;
      const pluginContext = this.contextFor(plugin, context);
      if (!this.isEnabled(plugin, pluginContext)) continue;

      if (existing && Object.prototype.hasOwnProperty.call(existing, plugin.name)) {
        state[plugin.name] = existing[plugin.name];
        continue;
      }
      if (typeof entity.create !== "function") continue;
      try {
        const value = entity.create(pluginContext);
        if (value !== undefined) state[plugin.name] = value;
      } catch (error) {
        this.report(plugin.name, "sceneEntity.create", error);
      }
    }

    return state;
  }

  snapshotSceneEntities(stateByPlugin, context) {
    const snapshot = {};

    for (const plugin of this.plugins) {
      const entity = plugin.sceneEntity;
      if (!entity) continue;
      const pluginContext = this.contextFor(plugin, context);
      if (!this.isEnabled(plugin, pluginContext)) continue;
      const state = stateByPlugin?.[plugin.name];
      if (state === undefined) continue;
      try {
        const value = typeof entity.snapshot === "function"
          ? entity.snapshot({ ...pluginContext, state })
          : state;
        if (value !== undefined) snapshot[plugin.name] = value;
      } catch (error) {
        this.report(plugin.name, "sceneEntity.snapshot", error);
      }
    }

    return snapshot;
  }

  tickSceneEntities(stateByPlugin, context, emitFrame) {
    for (const plugin of this.plugins) {
      const entity = plugin.sceneEntity;
      if (!entity || typeof entity.tick !== "function") continue;
      const pluginContext = this.contextFor(plugin, context);
      if (!this.isEnabled(plugin, pluginContext)) continue;
      const state = stateByPlugin?.[plugin.name];
      if (state === undefined) continue;
      try {
        entity.tick({
          ...pluginContext,
          state,
          emit: (frame) => emitFrame(plugin.name, frame),
        });
      } catch (error) {
        this.report(plugin.name, "sceneEntity.tick", error);
      }
    }
  }

  runSceneMove(stateByPlugin, context, emitFrame) {
    for (const plugin of this.plugins) {
      if (typeof plugin.onSceneMove !== "function") continue;
      const pluginContext = this.contextFor(plugin, context);
      if (!this.isEnabled(plugin, pluginContext)) continue;
      const state = stateByPlugin?.[plugin.name];
      try {
        plugin.onSceneMove({
          ...pluginContext,
          state,
          emit: (frame) => emitFrame(plugin.name, frame),
        });
      } catch (error) {
        this.report(plugin.name, "onSceneMove", error);
      }
    }
  }

  contextFor(plugin, context) {
    return typeof context === "function" ? context(plugin.name) : context;
  }

  // Labelled, site-toggleable add-ons. Pass a context factory to keep only the
  // ones a site is actually entitled to (those whose own isEnabled passes), so
  // owners never see a switch that cannot do anything on their tier.
  toggleable(contextFactory = null) {
    return this.plugins
      .filter((plugin) => plugin.label)
      .filter((plugin) => !contextFactory || this.isAvailable(plugin, this.contextFor(plugin, contextFactory)))
      .map((plugin) => ({
        name: plugin.name,
        label: plugin.label,
        description: plugin.description || "",
      }));
  }

  isEnabled(plugin, context) {
    // Site-toggleable add-ons (those with a label) only run where the site has
    // switched them on; context.enabled carries that per-site decision.
    if (plugin.label && (!context || context.enabled !== true)) return false;
    return this.isAvailable(plugin, context);
  }

  // The plugin's own entitlement/availability gate, independent of the owner's
  // on/off choice — this is what decides whether a toggle is offered at all.
  isAvailable(plugin, context) {
    if (typeof plugin.isEnabled !== "function") return true;
    try {
      return plugin.isEnabled(context) !== false;
    } catch (error) {
      this.report(plugin.name, "isEnabled", error);
      return false;
    }
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
