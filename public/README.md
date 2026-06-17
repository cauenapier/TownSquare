# `public/`

Everything the browser loads: the embeddable widget, the hosted setup/admin
pages, dev tooling, and styles. The Node server (`../server.js`) serves this
directory statically and handles the realtime WebSocket.

See `../docs/architecture.md` for the system boundary; this file is just a map.

## Widget runtime

- `townsquare.mjs` — the public mount API (`mountTownSquare(root, options)`).
- `widget/` — implementation split by concern (DOM/scene, chat bubbles,
  presence, protocol, movement, birds, page-watch, the `expand` controller,
  plus `constants`/`math`/`utils`). Start in `townsquare.mjs` and follow the
  imports.
- `demo.mjs` + `index.html` — the live demo that mounts the widget.

## Hosted pages

- `register.html` / `admin.html` / `service-admin.html` with their matching
  `hosted-register.mjs` / `hosted-admin.mjs` / `service-admin.mjs`.
- `hosted-common.mjs` — shared API/status/auto-refresh helpers for those pages.
- `ui-common.mjs` — generic DOM helpers (e.g. `bindCopy`), also used by dev tooling.

## Dev tooling

- `dev.html` + `dev-scene.mjs` — crowd simulator with live layout tuning.
- `walk-sandbox.html` + `walk-sandbox.mjs` — walk-cycle inspector.

## Shared with the server

`shared-constants.mjs`, `scene-props.mjs`, and `bird-perches.mjs` are imported
by **both** the browser widget and the CommonJS server (the server `import()`s
them at startup). Keep them free of browser- or Node-only APIs so both sides of
the protocol stay in lockstep.

## Styles

- `tokens.css` — design tokens (palette, type scale).
- `widget.css` — the widget/scene.
- `page.css` — host and dashboard pages.

## Checks

From the repo root: `npm run check` (syntax) and `npm run smoke` (integration
against a running server).
