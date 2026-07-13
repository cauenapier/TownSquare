/**
 * Renders site add-ons and lazily mounts an enabled add-on's trusted,
 * same-origin settings module inside its own expandable card.
 */
export function createAdminPluginRuntime({ container, action, setEnabled }) {
  const cards = new Map();
  const mounted = new Map();
  const loading = new Map();
  let latestSnapshot = null;
  let activeModules = new Map();
  let layoutSignature = null;

  function render(snapshot, { background = false } = {}) {
    latestSnapshot = snapshot;
    activeModules = new Map(validModules(snapshot.pluginModules).map((descriptor) => [descriptor.name, descriptor]));
    const addons = validAddons(snapshot.addons);
    const hasPlus = snapshot.site?.plus === true;
    const nextLayoutSignature = JSON.stringify({
      hasPlus,
      addons: addons.map(({ name, label, description, tier }) => ({ name, label, description, tier })),
    });
    if (nextLayoutSignature !== layoutSignature) {
      reconcileCards(addons, hasPlus);
      layoutSignature = nextLayoutSignature;
    }

    for (const addon of addons) {
      const card = cards.get(addon.name);
      card.input.checked = addon.enabled;
      card.input.disabled = !addon.available;
      card.config.hidden = !addon.enabled || !addon.available;
      if (addon.enabled && addon.available && activeModules.has(addon.name)) mount(addon.name, background);
      else destroyMounted(addon.name);
    }

    for (const name of [...mounted.keys()]) {
      if (!addons.some((addon) => addon.name === name)) destroyMounted(name);
    }
  }

  function reconcileCards(addons, hasPlus) {
    const names = new Set(addons.map((addon) => addon.name));
    for (const [name, card] of cards) {
      if (!names.has(name)) {
        destroyMounted(name);
        card.element.remove();
        cards.delete(name);
      }
    }

    container.replaceChildren();
    if (addons.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hosted-note";
      empty.textContent = "No add-ons are available for your site yet.";
      container.appendChild(empty);
      return;
    }

    for (const tier of ["free", "pro"]) {
      const group = addons.filter((addon) => addon.tier === tier);
      if (group.length === 0) continue;
      const section = document.createElement("section");
      section.className = "addon-group";
      section.appendChild(Object.assign(document.createElement("h3"), { textContent: `${tier === "free" ? "Free" : "Plus"} add-ons` }));
      if (tier === "pro" && !hasPlus) {
        const note = document.createElement("p");
        note.className = "hosted-note addon-group__plus-note";
        note.append(
          "Looking for a little more? These extra touches come with TownSquare Plus. It’s a small thank-you for supporting TownSquare. ",
          Object.assign(document.createElement("a"), {
            className: "addon-group__plus-cta",
            href: "https://buymeacoffee.com/cauenapier",
            textContent: "Buy me a coffee →",
          }),
          " If you’ve already chipped in, send me a note and I’ll switch it on for your site.",
        );
        section.appendChild(note);
      }
      for (const addon of group) section.appendChild(thisCard(addon));
      container.appendChild(section);
    }
  }

  function thisCard(addon) {
    let card = cards.get(addon.name);
    if (!card) {
      const element = document.createElement("article");
      element.className = "addon-card";
      const toggle = document.createElement("label");
      toggle.className = "addon-card__toggle";
      const name = document.createElement("strong");
      const input = document.createElement("input");
      input.type = "checkbox";
      toggle.append(name, input);
      const description = document.createElement("p");
      description.className = "hosted-note";
      const config = document.createElement("div");
      config.className = "addon-card__config";
      element.append(toggle, description, config);
      input.addEventListener("change", async () => {
        input.disabled = true;
        const ok = await setEnabled(addon.name, input.checked);
        if (!ok) input.checked = !input.checked;
        input.disabled = false;
      });
      card = { element, name, description, input, config };
      cards.set(addon.name, card);
    }
    card.name.textContent = addon.label;
    card.description.hidden = !addon.description;
    card.description.textContent = addon.description;
    return card.element;
  }

  async function mount(name, background) {
    const descriptor = activeModules.get(name);
    const card = cards.get(name);
    if (!descriptor || !card) return;
    const entry = mounted.get(name);
    if (entry) {
      if (!background) entry.instance?.render?.(latestSnapshot);
      return;
    }
    if (loading.has(name)) return;

    const pending = (async () => {
      try {
        const moduleUrl = new URL(descriptor.module, window.location.origin);
        if (moduleUrl.origin !== window.location.origin) throw new Error("Admin plugin modules must be same-origin");
        const pluginModule = await import(moduleUrl.href);
        if (!activeModules.has(name) || !cards.get(name)?.input.checked) return;
        if (typeof pluginModule.mountAdminPlugin !== "function") throw new Error("Admin plugin module must export mountAdminPlugin");
        const host = document.createElement("div");
        card.config.appendChild(host);
        const instance = await pluginModule.mountAdminPlugin({
          container: host,
          plugin: name,
          action: (actionName, input = {}) => action(name, actionName, input),
        });
        if (!activeModules.has(name) || !cards.get(name)?.input.checked) {
          instance?.destroy?.();
          host.remove();
          return;
        }
        mounted.set(name, { host, instance });
        instance?.render?.(latestSnapshot);
      } catch (error) {
        console.warn(`Could not load TownSquare admin plugin ${name}: ${error.message}`);
      } finally {
        loading.delete(name);
      }
    })();
    loading.set(name, pending);
    await pending;
  }

  function destroyMounted(name) {
    const entry = mounted.get(name);
    if (!entry) return;
    entry.instance?.destroy?.();
    entry.host.remove();
    mounted.delete(name);
  }

  function clear() {
    for (const name of mounted.keys()) destroyMounted(name);
    cards.clear();
    container.replaceChildren();
    latestSnapshot = null;
    activeModules.clear();
    layoutSignature = null;
  }

  return { render, clear };
}

function validModules(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((descriptor) => (
    descriptor && typeof descriptor.name === "string" && typeof descriptor.module === "string" && descriptor.module.startsWith("/")
  ));
}

function validAddons(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((addon) => addon && typeof addon.name === "string" && typeof addon.label === "string")
    .map((addon) => ({
      ...addon,
      available: addon.available !== false,
      enabled: addon.enabled === true,
      tier: addon.tier === "pro" ? "pro" : "free",
    }));
}
