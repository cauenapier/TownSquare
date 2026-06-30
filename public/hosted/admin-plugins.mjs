/**
 * Loads trusted, same-origin admin feature modules declared by the server.
 * A module exports mountAdminPlugin({ container, plugin, action }) and returns
 * an optional { render(snapshot), destroy() } lifecycle object.
 */
export function createAdminPluginRuntime({ container, action }) {
  const mounted = new Map();
  const loading = new Map();
  let latestSnapshot = null;
  let active = new Map();

  /**
   * @param {object} snapshot
   * @param {{ background?: boolean }} [options]
   *   `background` marks a poll-driven refresh. Plugin admin UIs are stateful
   *   editors, so a background tick must not push a fresh snapshot into an
   *   already-mounted plugin — doing so resets in-progress form edits (and, for
   *   plugins that act during render, drives an action/poll request storm). The
   *   snapshot is still cached and used to mount/unmount plugins; mounted ones
   *   only re-render on an action-driven (foreground) refresh.
   */
  function render(snapshot, { background = false } = {}) {
    latestSnapshot = snapshot;
    active = new Map(validModules(snapshot.pluginModules).map((descriptor) => [descriptor.name, descriptor]));

    for (const [name, entry] of mounted) {
      if (!active.has(name)) {
        destroyEntry(name, entry);
      } else if (!background) {
        entry.instance?.render?.(snapshot);
      }
    }

    for (const descriptor of active.values()) {
      if (!mounted.has(descriptor.name) && !loading.has(descriptor.name)) {
        const pending = mount(descriptor).finally(() => loading.delete(descriptor.name));
        loading.set(descriptor.name, pending);
      }
    }
  }

  async function mount(descriptor) {
    let host = null;
    try {
      const moduleUrl = new URL(descriptor.module, window.location.origin);
      if (moduleUrl.origin !== window.location.origin) throw new Error("Admin plugin modules must be same-origin");
      const pluginModule = await import(moduleUrl.href);
      if (!active.has(descriptor.name)) return;
      if (typeof pluginModule.mountAdminPlugin !== "function") {
        throw new Error("Admin plugin module must export mountAdminPlugin");
      }

      host = document.createElement("div");
      host.dataset.townsquarePlugin = descriptor.name;
      container.appendChild(host);
      const instance = await pluginModule.mountAdminPlugin({
        container: host,
        plugin: descriptor.name,
        action: (name, input = {}) => action(descriptor.name, name, input),
      });
      if (!active.has(descriptor.name)) {
        instance?.destroy?.();
        host.remove();
        return;
      }
      const entry = { host, instance };
      mounted.set(descriptor.name, entry);
      instance?.render?.(latestSnapshot);
    } catch (error) {
      host?.remove();
      console.warn(`Could not load TownSquare admin plugin ${descriptor.name}: ${error.message}`);
    }
  }

  function destroyEntry(name, entry) {
    entry.instance?.destroy?.();
    entry.host.remove();
    mounted.delete(name);
  }

  function clear() {
    active.clear();
    latestSnapshot = null;
    for (const [name, entry] of mounted) destroyEntry(name, entry);
  }

  return { render, clear };
}

function validModules(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((descriptor) => (
    descriptor
    && typeof descriptor.name === "string"
    && typeof descriptor.module === "string"
    && descriptor.module.startsWith("/")
  ));
}
