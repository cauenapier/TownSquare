# TownSquare server plugins

Plugins are trusted in-process feature modules. They are registered before
`server.js` starts; there is no package discovery or remote installation.
`server/plugins.js` is the source of truth for the manifest and hook contract.

## Register a private plugin

```js
const pluginEngine = require("../TownSquare/server/plugins");
const ownerFigure = require("./plugins/owner-figure");

const EXPECTED_PLUGIN_API_VERSION = 1;
if (pluginEngine.PLUGIN_API_VERSION !== EXPECTED_PLUGIN_API_VERSION) {
  throw new Error(
    `Expected TownSquare plugin API v${EXPECTED_PLUGIN_API_VERSION}, ` +
    `got ${pluginEngine.PLUGIN_API_VERSION ?? "unknown"}`,
  );
}

const { registerPlugin } = pluginEngine;
registerPlugin(ownerFigure);
require("../TownSquare/server");
```

`PLUGIN_API_VERSION` changes only on breaking plugin-contract changes: hook
names/signatures, context shape, registration rules, or browser module path
requirements. Private plugin bundles should assert the expected version before
registering plugins so an incompatible core checkout fails before boot.

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

  isEnabled: ({ site }) => site?.plus === true,

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
`origin`, `supporter`, and `plus`.

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

Changing a toggle updates connected widgets without a refresh. The server sends
the active widget-module list again, so newly enabled modules mount and disabled
ones are destroyed. A scene-entity plugin also receives its current snapshot;
weather uses the same live update path to apply or remove its configuration.

A plugin's own `isEnabled` layers on top of the owner's choice as an
*entitlement* gate. The toggle is only offered to a site when its `isEnabled`
passes, and the plugin runs only when both the entitlement holds **and** the
owner has switched it on. For example, `telegram-notifications` keeps its own
entitlement `isEnabled`, so its switch appears only on entitled sites and
activates only once that owner turns it on. The same toggle framework covers
core and Plus plugins alike — a Plus plugin opts in purely by adding a `label`;
no toggle code lives in the Plus repo. A Plus plugin that omits `label` (like
`owner-figure` and `scene-cat`) instead runs automatically on every site its
`isEnabled` entitles.

### Core weather add-on

Weather is a built-in labelled add-on and is off for hosted sites until the
owner enables it in **Admin → Add-ons**. Its panel can pin clear, rain, snow,
or storm, or set whole-number probabilities for the shared UTC-hour schedule.
The server rejects distributions that do not total 100, and changes are sent to
connected widgets immediately; the standard hosted embed snippet needs no
custom CSS or replacement.

## Plugin storage and admin actions

Each site persists plugin data under `site.plugins[pluginName]`. Admin action
context exposes the current immutable `data`, `owners`, public `visitors`, and
`enabled`, plus `setData(nextData)`. `enabled` is the per-site activation state
for labelled plugins. `setData` replaces only that plugin's namespace and saves
it atomically with the site registry after the action succeeds. Failed actions do
not retain staged data. Data must be JSON and is limited to 64 KiB per plugin.

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
join, profile, and admin visitor snapshots. MOVE broadcasts skip visitor plugin
extension data and the widget keeps the peer's last-known plugin state. Its return value is
placed under `visitor.plugins[pluginName]`; plugins cannot replace core visitor
fields or another plugin's namespace.

The server-side `visitor` context passed to `extendVisitor` exposes `id`,
`browserId`, `displayName`, `color`, `isOwner`, `ownerHandle` (owners only), and
`fp` — a stable per-visitor fingerprint (the same hash as `ownerHandle`) usable
as a storage key without ever handling the raw `browserId`. The admin panel's
`scene.visitors` carry the matching `fp`, so an admin action can target a
specific present visitor (e.g. `visitor-figure` assigns a hat by `fp`).

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

## Shared scene entities

A plugin can own server-authoritative state for each live scene with a
`sceneEntity` block. It is created only while the plugin is enabled, is kept
across scene rebuilds while still enabled, and is discarded when disabled.

```js
module.exports = {
  name: "counter",
  sceneEntity: {
    create() {
      return { value: 0 };
    },
    snapshot({ state }) {
      return { value: state.value };
    },
    tick({ state, dtMs, emit }) {
      // Update server-owned state, then emit a JSON-shaped frame when needed.
      state.value += dtMs;
      emit({ value: state.value });
    },
  },
};
```

`create`, `snapshot`, and `tick` are optional functions. `snapshot` defaults to
the state value when omitted. `tick` receives the plugin context plus `state`,
`figures` (`{ x }` for joined visitors), `bounds`, `dtMs`, and `emit(frame)`.
Frames are namespaced by plugin name and delivered to widget modules through
`applyEntity(frame)`. Emit only when a client needs a new frame; ticks run while
the scene has connected clients.

Use `onSceneMove` for interactions driven by a visitor's normal movement:

```js
onSceneMove({ state, x, direction, speed, emit }) {
  // React on the server; do not add a client-controlled entity message.
}
```

It receives the plugin context, the entity `state` when present, the destination
`x`, movement `direction`, speed, bounds, visitor data, and `emit(frame)`. The
hook follows the normal enablement and fail-open rules.

## Existing hooks

Event/decision hooks are `onVisitorJoin`, `onMessage`, `onSocketMessage`, and
`onSceneMove`.
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
