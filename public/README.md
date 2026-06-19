# `public/`

Everything the browser loads: the embeddable widget, the hosted setup/admin
pages, dev tooling, and styles. The Node server (`../server.js`) serves this
directory statically and handles the realtime WebSocket.

See `../docs/architecture.md` for the system boundary; this file is just a map.

## Layout

```
townsquare.mjs   widget.css   tokens.css   page.css   demo.mjs   index.html
widget/   shared/   hosted/   dev/   lib/
```

- `townsquare.mjs` — the public mount API (`mountTownSquare(root, options)`),
  served at the frozen embed URL `/townsquare.mjs`.
- `widget/` — implementation split by concern (DOM/scene, chat bubbles,
  presence, protocol, movement, birds, page-watch, the `expand` controller,
  plus `constants`/`math`/`utils`). Start in `townsquare.mjs` and follow imports.
- `shared/` — `shared-constants.mjs`, `scene-props.mjs`, `scene-prop-geometry.mjs`,
  `bird-perches.mjs`, `site-config.mjs`, and `map-world.mjs` (shared validation/config).
- `demo.mjs` + `index.html` — the live demo that mounts the widget.
- `widget.css` / `tokens.css` / `page.css` — see Styles below.

## Hosted pages — `hosted/`

`register.html` / `admin.html` / `service-admin.html` with their matching
`.mjs`, plus `hosted-common.mjs` (shared API/status/auto-refresh helpers).
Served at the clean routes `/register`, `/admin`, `/service-admin`.
The service-admin page also edits global map scenery through its authenticated API.

## Dev tooling — `dev/`

- `dev.html` + `dev-scene.mjs` — crowd simulator with live layout tuning (`/dev`).
- `walk-sandbox.html` + `walk-sandbox.mjs` — walk-cycle inspector (`/walk-sandbox`).

## Shared helpers — `lib/`

`ui-common.mjs` — generic DOM helpers (e.g. `bindCopy`) used by both the hosted
pages and dev tooling.

## Shared with the server — `shared/`

`shared-constants.mjs`, `scene-props.mjs`, `scene-prop-geometry.mjs`,
`bird-perches.mjs`, and `site-config.mjs` are imported by **both** the browser
widget and the CommonJS server (the server `import()`s them at startup). Keep them
free of browser- or Node-only APIs so both sides of the protocol stay in lockstep.
`site-config.mjs` holds the scene/style defaults, sanitizers, and `buildSiteCss`
(the per-site Customization CSS the admin/register pages hand owners to paste).

## URLs vs. files

`/townsquare.mjs` and `/widget.css` are a public contract (live embeds point at
them) — don't move those files. Everything else is reached via editable
relative imports or server aliases (`resolvePublicFile` in `server.js`), so it
can move freely as long as references are updated.

## Styles

- `tokens.css` — design tokens (palette, type scale).
- `widget.css` — the widget/scene (served at the frozen `/widget.css`).
- `page.css` — host and dashboard pages.

## Checks

From the repo root: `npm run check` (syntax) and `npm run smoke` (integration
against a running server).
