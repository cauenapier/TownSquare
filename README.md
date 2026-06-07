# TownSquare

TownSquare is a tiny presence layer for websites.

This repo currently contains a narrow but real slice:
- embeddable browser widget
- real-time shared presence
- simple left/right walking
- lightweight real-time chat
- one first bench prop with a sit interaction
- ephemeral in-memory server state

The codebase is intentionally small. The main goal right now is to make the product boundary clear enough that TownSquare can be self-hosted cleanly and later grow into a hosted shared service without rewriting the core widget.
Self-hosted should not mean forever disconnected: a self-hosted TownSquare may also choose to communicate with other TownSquares and become part of the wider network.

## Repo shape

- `server.js` — Node server for static assets, health checks, and WebSocket presence
- `public/townsquare.mjs` — reusable embeddable widget mount API
- `public/widget/` — widget implementation modules (DOM, chat, presence, protocol, movement)
- `public/widget.css` — widget and demo styling
- `public/demo.mjs` — local demo bootstrap
- `public/index.html` — demo host page for local development
- `scripts/smoke-test.js` — automated websocket smoke test
- `spec.md` — product truth
- `roadmap.md` — product-facing sequencing
- `docs/architecture.md` — current boundaries and future hosted shape
- `docs/deployment.md` — self-hosting and embed instructions

## Requirements

- Node.js 18+
- npm

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

Default local URL:

```text
http://127.0.0.1:8787
```

Override host/port if needed:

```bash
HOST=0.0.0.0 PORT=8787 npm start
```

Health check:

```text
http://127.0.0.1:8787/healthz
```

## Development workflow

1. Start the server:

   ```bash
   npm start
   ```

2. Open the demo page:

   ```text
   http://127.0.0.1:8787
   ```

3. Open it in two windows or two browsers.

4. Verify the current slice manually:
   - two tabs from the same browser still share one visitor
   - a different browser or browser profile shows a second visitor
   - arrow keys move your figure left/right
   - movement is reflected in the other window
   - pausing by the bench settles the visitor into a seat
   - chat messages appear above the figure and also enter the recent-message tray
   - closing one tab does not remove the visitor if another tab from that browser is still open

## Embed the widget into another site

TownSquare is now split into a reusable widget module and a demo bootstrap.
A site can embed the widget by loading the CSS plus the module from the TownSquare server:

```html
<link rel="stylesheet" href="https://your-townsquare-host/widget.css" />
<div id="townsquare-root"></div>
<script type="module">
  import { mountTownSquare } from "https://your-townsquare-host/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "https://your-townsquare-host",
    socketPath: "/live"
  });
</script>
```

Notes:
- `serverOrigin` is the realtime/backend origin the widget should connect to.
- `socketPath` defaults to `/live`; set it explicitly when your reverse proxy exposes TownSquare on a different websocket path such as `/townsquare/live`.
- The host page owns placement and surrounding layout.
- TownSquare owns the scene, movement, chat, and realtime transport inside the mount root.

## Deploy updates to the shared Hetzner host

This repo includes a deployment helper:

```bash
cp .env.deploy.example .env.deploy.local
scripts/deploy.sh
```

Useful flags:

```bash
scripts/deploy.sh --skip-checks
scripts/deploy.sh --ref origin/main
scripts/deploy.sh --env-file ./ops/my-deploy.env
```

The script:
- runs local syntax checks unless skipped
- archives the chosen git ref
- uploads it to the server
- creates a new release under `/opt/townsquare/releases`
- runs `npm ci --omit=dev` on the server
- flips `/opt/townsquare/current`
- restarts `townsquare.service`
- checks the local health endpoint
- optionally checks a public health endpoint when `HEALTHCHECK_URL` is set

It expects a machine with working `ssh` and `scp` access to the server.

The checked-in `.env.deploy.example` is generic. Keep real deployment values in `.env.deploy.local` or another uncommitted env file.

## Docker

Build and run:

```bash
docker build -t townsquare .
docker run --rm -p 8787:8787 townsquare
```

Then open:

```text
http://127.0.0.1:8787
```

## Checks

Syntax check the current code:

```bash
npm run check
```

Run the websocket smoke test in a second shell while the server is already running:

```bash
npm run smoke
```

The smoke test verifies:
- hello/initial peer snapshot
- join
- move
- say
- leave

## Current scope

Included now:
- one embeddable widget module
- one default scene
- presence
- walking
- one bench prop with simple sit interaction
- lightweight chat with small per-character recovery tray
- self-hostable single-process server

Not included yet:
- persistence
- accounts
- moderation systems
- multiple scenes
- cross-site travel
- site registration/tenant management
- packaged integrations for major site builders

## Direction

The next serious product boundary is:
1. **single-site self-hosting that feels clean**
2. **clear separation between widget, realtime service, and site registration concerns**
3. **only then a hosted multi-site TownSquare service**

That means we should make the deployable single-site system good now, while keeping the protocol and embed boundary simple enough that a hosted shared version can be added later.
It also means leaving room for self-hosted TownSquares to optionally communicate with each other and participate in the wider network without requiring a full centrally hosted model.

## License

TBD
