# TownSquare server plugins

Plugins are trusted in-process feature modules. They are registered before
`server.js` starts; there is no package discovery or remote installation.
`server/plugins.js` is the source of truth for the manifest and hook contract.

## Register a private plugin

```js
const { registerPlugin } = require("../TownSquare/server/plugins");
const ownerFigure = require("./plugins/owner-figure");

registerPlugin(ownerFigure);
require("../TownSquare/server");
```

Plugin names use lowercase kebab-case and are also their storage and wire-data
namespace. Browser module paths are same-origin absolute `.mjs` paths. The Plus
deployment must make those paths reachable. Set `TOWNSQUARE_PLUGIN_ASSETS_DIR`
to a directory and the core serves its files as a fallback overlay after its
own `public/` (e.g. point it at the Plus repo's `public/`, so `/plus/...` resolves
to `<dir>/plus/...`). A reverse-proxy alias also works.

## Full-stack plugin manifest

```js
module.exports = {
  name: "owner-figure",
  adminModule: "/plus/owner-figure/admin.mjs",
  widgetModule: "/plus/owner-figure/widget.mjs",

  isEnabled: ({ site }) => site?.supporter === true,

  adminActions: {
    update({ owners, setData }, input) {
      if (!owners.some((owner) => owner.handle === input.ownerHandle)) {
        return { error: "Unknown owner." };
      }
      setData({ ownerHandle: input.ownerHandle, hat: input.hat });
    },
  },

  extendVisitor(_visitor, { visitor, data }) {
    if (!visitor.isOwner || visitor.ownerHandle !== data?.ownerHandle) return;
    return { hat: data.hat };
  },

  extendAdminPanel(panel, { data }) {
    return {
      ...panel,
      plugins: { ...panel.plugins, "owner-figure": data },
    };
  },
};
```

`isEnabled` controls the plugin's hooks, actions, visitor data, and browser
module descriptors for a site. Current site context includes `siteKey`, `name`,
`origin`, and `supporter`.

## Site-owner activation toggle

Declaring a `label` (and optional `description`) opts a plugin into the
per-site activation switch shown in the admin **Add-ons** tab:

```js
module.exports = {
  name: "telegram-notifications",
  label: "Telegram notifications",
  description: "Forward chat messages to a Telegram chat.",
  // ...hooks, adminModule, etc.
};
```

Labelled plugins are **off by default** and only run for sites whose owner has
switched them on; the enablement state persists under `site.pluginsEnabled` and
is surfaced to `isEnabled` as `context.enabled`. Unlabelled plugins keep running
globally as before.

A plugin's own `isEnabled` layers on top of the owner's choice as an
*entitlement* gate. The toggle is only offered to a site when its `isEnabled`
passes, and the plugin runs only when both the entitlement holds **and** the
owner has switched it on. For example, `owner-figure` keeps
`isEnabled: ({ site }) => site?.plus === true`, so its switch appears only on Plus
sites and activates only once that owner turns it on. The same toggle framework
covers core and Plus plugins alike — a Plus plugin opts in purely by adding a
`label`; no toggle code lives in the Plus repo.

## Plugin storage and admin actions

Each site persists plugin data under `site.plugins[pluginName]`. Admin action
context exposes the current immutable `data`, `owners`, public `visitors`, and
`setData(nextData)`. `setData` replaces only that plugin's namespace and saves
it atomically with the site registry after the action succeeds. Failed actions
do not retain staged data. Data must be JSON and is limited to 64 KiB per plugin.

Browser admin modules call actions through the authenticated core admin API;
they never receive the admin token:

```js
export function mountAdminPlugin({ container, action }) {
  const section = document.createElement("section");
  section.className = "hosted-section";
  container.appendChild(section);

  return {
    render(snapshot) {
      const config = snapshot.plugins?.["owner-figure"];
      // Render idempotently from the latest five-second admin snapshot.
    },
    destroy() {},
  };
}
```

Call `action("update", input)` to invoke `adminActions.update`. Admin actions
are synchronous; the returned promise represents the browser request.

## Visitor data and widget modules

`extendVisitor` runs through the single identity serializer used by hello,
join, movement, profile, and admin visitor snapshots. Its return value is
placed under `visitor.plugins[pluginName]`; plugins cannot replace core visitor
fields or another plugin's namespace.

Widget modules are announced in the WebSocket hello payload, so enabling a
plugin does not require owners to replace an existing embed snippet. A module
mounts once and receives idempotent figure updates:

```js
export function mountWidgetPlugin() {
  return {
    renderFigure({ figure, data, isSelf, visitor }) {
      // Add, update, or remove only this plugin's decoration inside `figure`.
    },
    removeFigure({ figure }) {},
    destroy() {},
  };
}
```

`data` is the current `visitor.plugins[pluginName]` value or `null`. The widget
core continues to own figure creation, movement, presence, and removal.

## Existing hooks

Event/decision hooks are `onVisitorJoin`, `onMessage`, and `onSocketMessage`.
Payload hooks are `extendSiteConfig`, `extendAdminPanel`, `extendMapData`, and
`extendWidgetConfig`. Hooks run synchronously in registration order. Returning
`false` from `onMessage` or `onSocketMessage` stops the action. Plugin failures
are logged and otherwise fail open so core self-hosted behavior continues.

The real contract fixture is `server/fixtures/feature-plugin.js`; its API and
WebSocket client is `scripts/plugin-smoke-test.js` (`npm run smoke:plugins`).
That smoke test spawns its own server and injects the fixture via
`TOWNSQUARE_EXTRA_PLUGINS` — a comma/space-separated list of module paths the
server `require`s at boot, each self-registering with `registerPlugin`. Use the
same variable to load private/extra plugin bundles in a deploy.
