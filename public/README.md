# `public/`

Server-owned browser assets: the embeddable widget, hosted setup/admin pages,
dev tooling, and styles. The Node server (`../server.js`) serves this directory
statically and handles the realtime WebSocket.

See `../docs/architecture.md` for the system boundary; this file is just a map.

## Layout

```
townsquare.mjs   widget.css   tokens.css   page.css   design/
widget/   admin/   map/   dev/   lib/
```

- `townsquare.mjs` — the public mount API (`mountTownSquare(root, options)`),
  served at the frozen embed URL `/townsquare.mjs`.
- `widget/` — implementation split by concern (DOM/scene, chat bubbles,
  presence, protocol, movement, birds, page-watch, the `expand` controller,
  plus `constants`/`math`/`utils`). Start in `townsquare.mjs` and follow imports.
- `admin/` — hosted admin and register pages with setup UI.
- `map/` — public TownSquare network map visualization.
- `lib/` — server-shared modules wrapped for browser access (site-config, protocol, map-world, etc.).
- `widget.css` / `tokens.css` / `page.css` / `design/` — see Styles below.

## Hosted pages — `hosted/`

`register.html` / `admin.html` / `service-admin.html` with their matching
`.mjs`, plus `hosted-common.mjs` (shared API/status/auto-refresh helpers).
Served at the clean routes `/register`, `/admin`, `/service-admin`.
The service-admin page also edits global map scenery through its authenticated API.

## Dev tooling — `dev/`

- `dev.html` + `dev-scene.mjs` — crowd simulator with live layout tuning (`/dev`).
- `walk-sandbox.html` + `walk-sandbox.mjs` — walk-cycle inspector (`/walk-sandbox`).

## Shared utilities — `lib/`

Browser-served wrappers for server-shared modules:

- `ui-common.mjs` — generic DOM helpers (e.g. `bindCopy`) used by hosted pages.
- `site-config.mjs` / `site-config-core.mjs` — scene/style defaults, sanitizers, and `buildSiteCss`.
- `protocol.mjs` — WebSocket message types shared by widget and server.
- `map-world.mjs` — map dimension constants and validation.
- `shared-constants.mjs` — character colors, limits, and utilities.
- `scene-props.mjs` — default scene prop definitions.
- `bird-perches.mjs` — bird perch definitions derived from scene props.
- `scene-prop-geometry.mjs` — prop settle-zone helpers.
- `url.mjs` — URL normalization and origin utilities.

These are copies/wrappers of modules at `../shared/` (server-owned). The server imports from `../shared/` directly; the browser imports from `lib/` which is served. Keep server modules free of browser- or Node-only APIs so both sides stay in lockstep.

## URLs vs. files

`/townsquare.mjs` and `/widget.css` are a public contract (live embeds point at
them) — don't move those files. Everything else is reached via editable
relative imports or server aliases (`resolvePublicFile` in `server.js`), so it
can move freely as long as references are updated.

## Styles

- `tokens.css` — widget tokens (palette, type scale), scoped by the widget stylesheet.
- `widget.css` — the widget/scene (served at the frozen `/widget.css`).
- `design/` — canonical tokens, base rules, and shared components for TownSquare-owned public pages.
- `page.css` — feature-specific host and dashboard page layout.

## Checks

From the repo root: `npm run check` (syntax) and `npm run smoke` (integration
against a running server).
