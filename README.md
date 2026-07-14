# TownSquare

TownSquare is an embeddable presence layer for websites: visitors share a small
scene, walk around, chat, and see who else is there. It runs as a single Node.js
process and supports both a self-hosted scene and isolated scenes for registered
sites.

The product contract lives in [`spec.md`](spec.md). Current sequencing lives in
[`roadmap.md`](roadmap.md).

## Run locally

TownSquare requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://127.0.0.1:8787`. With the development tools enabled by the example
environment, `/dev` opens the crowd simulator and `/walk-sandbox` opens the
walk-cycle inspector. The health endpoint is `/healthz`.

`npm start` does not stop another process using the configured port. Use
`npm run kill-port` explicitly when that is what you want.

## Repository map

- `server.js` — HTTP routes, hosted APIs, WebSocket runtime, and scene state.
- `server/` — focused persistence, security, statistics, and plugin helpers.
- `public/townsquare.mjs` — stable widget mount API at `/townsquare.mjs`.
- `public/widget/` — widget behavior grouped by concern.
- `public/lib/` — canonical browser/Node-neutral protocol, scene, map, URL, and
  site-configuration modules. Both server and browser import these files.
- `public/admin/hosted/` — registration, site-admin, chat-admin, and
  service-admin pages.
- `public/map/` — public network-map layout and rendering.
- `plugins/` — trusted in-process feature plugins included in this distribution.
- `scripts/` — deployment, smoke tests, and visual regression helpers.
- `ops/` — example Nginx and systemd configuration.

The public landing page, user documentation, and changelog are maintained in the
separate `TownSquare_landingpage` repository. See
[`docs/architecture.md`](docs/architecture.md) for the runtime boundaries.

## Embed the widget

```html
<link rel="stylesheet" href="https://townsquare.example/widget.css" />
<div id="townsquare-root"></div>
<script type="module">
  import { mountTownSquare } from "https://townsquare.example/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "https://townsquare.example",
    socketPath: "/live",
    theme: "host"
  });
</script>
```

`serverOrigin` selects the HTTP and WebSocket service. `socketPath` defaults to
`/live`. A hosted multi-site embed also supplies its generated `siteKey` and
site-specific stylesheet; the registration page generates the complete snippet.

The host page owns placement. TownSquare owns everything inside
`#townsquare-root`. Palette tokens can be overridden by host CSS; the supported
tokens and defaults are defined in [`public/tokens.css`](public/tokens.css) and
[`public/lib/site-config-core.mjs`](public/lib/site-config-core.mjs).

For a read-only presence pill, use `mountTownSquareCounter` from
`/townsquare-counter.mjs`. Its option contract is documented next to the
implementation in [`public/townsquare-counter.mjs`](public/townsquare-counter.mjs).

## Hosted operation

- `/register` creates a site key, install snippet, and private admin token.
- `/admin` manages a registered site's scene, appearance, connections, owner
  identity, moderation, and plugins.
- `/service-admin` manages the service registry, aggregate activity, global map,
  and operator notifications when `SERVICE_ADMIN_PASSWORD` is set.
- `/map` displays verified, enabled sites.

Registered sites are stored under `DATA_DIR` (`.data` by default). Admin tokens
are stored as hashes. Runtime visitor and message state remains in memory.

Copy [`.env.example`](.env.example) for the supported runtime settings and their
defaults. In production, set `PUBLIC_ORIGIN`, keep `DATA_DIR` on persistent
storage, and run behind a reverse proxy that supports WebSockets. The checked-in
Nginx examples include the expected `/live` limits and trusted client-IP setup.

Trusted server features compose through the in-process plugin contract described
in [`docs/plugins.md`](docs/plugins.md). There is no remote plugin loader.

## Deploy

Docker:

```bash
docker build -t townsquare .
docker run --rm -p 8787:8787 townsquare
```

Release deployment is handled by `scripts/deploy.sh`. Run
`scripts/deploy.sh --help` for its current modes and environment contract; keep
real deployment values in the ignored `.env.deploy.local` file based on
`.env.deploy.example`.

Public-page design foundations live in `public/design/`. If the ignored local
`scripts/admin/sync-design.js` helper is present, use it after design changes to
check and sync the landing repository. The widget stylesheet remains independent.

## Checks

```bash
npm run check             # JavaScript syntax
npm run lint              # ESLint
npm test                  # Node unit tests
npm run test:integration  # real managed servers and WebSocket/API clients
npm run test:all          # all of the above
```

The integration tests allocate their own ports and temporary data directories;
no manually started server is required. Browser-based geometry checks are
available as `test:ground-line`, `test:widget-color`, and
`test:scene-alignment` when Playwright browsers are installed.

## License

MIT — see [`LICENSE`](LICENSE).
