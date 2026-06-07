# TownSquare deployment

This is the current deployment story for TownSquare.
It covers the clean self-hosted shape first.

## What you are deploying

One Node process that:
- serves the widget assets
- serves the local demo page
- exposes a WebSocket endpoint for realtime presence/chat
- exposes `/healthz` for simple health checks

Current defaults:
- HTTP host: `127.0.0.1`
- HTTP port: `8787`
- WebSocket path: `/live`

Configure with environment variables:
- `HOST`
- `PORT`

## Local run

```bash
npm install
npm start
```

## Docker

Build:

```bash
docker build -t townsquare .
```

Run:

```bash
docker run --rm -p 8787:8787 -e HOST=0.0.0.0 townsquare
```

## Embed on another site

Serve TownSquare somewhere reachable, then add this to the host website:

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

This is the core self-hosting contract:
- the website decides where the widget appears
- TownSquare owns what happens inside the widget
- the widget connects back to the TownSquare server origin you provide

Self-hosting does not have to mean permanent isolation.
A future self-hosted TownSquare may also choose to communicate with other TownSquares and join the wider network while still remaining independently operated.

## Reverse proxy notes

For a normal production deployment, put TownSquare behind nginx, Caddy, or another reverse proxy.
Requirements:
- forward normal HTTP traffic
- support WebSocket upgrade requests on `/live`
- keep the TownSquare origin stable so widget asset URLs and WebSocket URLs stay aligned

If you expose TownSquare under a path-prefixed websocket route such as `/townsquare/live`, pass that path explicitly in `mountTownSquare(..., { socketPath: "/townsquare/live" })`.

## Generic release deploy helper

This repo ships a generic deploy helper at `scripts/deploy.sh`.

Suggested setup:

```bash
cp .env.deploy.example .env.deploy.local
scripts/deploy.sh
```

`deploy.sh` sources `.env.deploy.local` by default if it exists, or you can pass a custom file with `--env-file path/to/file`.

Keep real deployment values out of git.

## Health checks

Use:

```text
/healthz
```

Expected response body:

```text
ok
```

## What this deployment shape does not do yet

Not yet included:
- persistence
- accounts
- site registration
- tenant management
- hosted multi-site control plane

That is intentional.
First make the single-site system clean and easy to run.
Then layer the hosted model on top.
