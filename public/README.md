# Browser assets

The Node server serves this directory. `/townsquare.mjs` and `/widget.css` are
stable public embed URLs; other clean routes are aliases defined by the server's
static-file resolver.

## Layout

- `townsquare.mjs` — widget mount API.
- `townsquare-counter.mjs` — read-only presence counter.
- `widget/` — scene, input, chat, presence, and plugin behavior.
- `lib/` — canonical browser/Node-neutral contracts and utilities. The server
  imports these same files directly; do not add DOM or Node-only dependencies.
- `admin/hosted/` — registration and administration pages.
- `map/` — network-map layout and rendering.
- `dev/` — local scene and visual test tools.
- `design/`, `page.css` — TownSquare-owned public-page design system and layouts.
- `tokens.css`, `widget.css` — independent embeddable-widget tokens and styles.

Read [`../docs/design-system.md`](../docs/design-system.md) before changing
public-page styles. Keep widget styles scoped and independent from that system.

Run `npm run check`, `npm run lint`, and `npm test` from the repository root.
`npm run test:integration` starts its own isolated servers.
