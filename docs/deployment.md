# TownSquare deployment

This is the current deployment story for TownSquare.
It covers the clean self-hosted shape first.

## What you are deploying

One Node process that:
- serves the widget assets
- serves the local demo page
- serves accountless hosted registration/admin pages
- exposes a WebSocket endpoint for realtime presence/chat
- exposes `/healthz` for simple health checks

Current defaults:
- HTTP host: `127.0.0.1`
- HTTP port: `8787`
- WebSocket path: `/live`

Configure with environment variables:
- `HOST`
- `PORT`
- `DATA_DIR` for hosted site registry storage
- `PUBLIC_ORIGIN` for generated hosted snippets/admin links
- `REGISTRATIONS_PER_HOUR` per-IP registration rate limit (default 20, `0` disables)
- `AUTH_FAILURES_PER_HOUR` per-IP failed admin sign-in throttle (default 30, `0` disables)
- `SERVICE_ADMIN_PASSWORD` to enable the service admin page
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to send Telegram notifications for chat messages
- `INACTIVE_DISCONNECT_MS` to disconnect visitors who stay away or inactive (default 30 minutes, `0` disables)
- `INACTIVE_CHECK_INTERVAL_MS` for how often the server scans for inactive visitors (default 60 seconds)

For local runs, copy `.env.example` to `.env` (or create `.env` directly); `server.js` loads it on startup.
Real environment variables take precedence over `.env` values.

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

### Theme

By default the widget follows the OS/browser `prefers-color-scheme` setting.
If your site uses a manual dark-mode toggle, pass an explicit theme so labels
and plates do not keep the light palette on a dark page:

```js
mountTownSquare(document.getElementById("townsquare-root"), {
  serverOrigin: "https://your-townsquare-host",
  theme: "dark"
});
```

You can also set `data-townsquare-theme="dark"` (or `"light"`) on the mount
root before calling `mountTownSquare`. Valid values: `auto`, `light`, `dark`.
Token definitions live in `public/tokens.css`.

Self-hosting does not have to mean permanent isolation.
A future self-hosted TownSquare may also choose to communicate with other TownSquares and join the wider network while still remaining independently operated.

## Hosted registration

For a shared hosted server, open:

```text
https://your-townsquare-host/register
```

The hosted flow does not require an owner account:
- the site owner enters a website URL
- TownSquare issues a public `siteKey` in the embed snippet
- TownSquare issues a private admin token and admin link
- the site is marked seen/verified when the snippet connects from the registered origin

The admin token is the password for moderation.
Save it; the admin page asks for it to sign back in later, and keeps it in
`sessionStorage` for the duration of the browser session.
Generated admin links keep the token in the URL fragment so it is not sent in HTTP requests.
Only an admin token hash is stored in the site registry.

The admin page supports the first hosted operations:
- view install status and active visitors
- mark/unmark an active visitor as the verified site owner
- kick/block active visitors
- disable chat
- disable the site
- clear recent in-memory messages

Marking a visitor as owner stores that browser's id under `ownerBrowserIds` on the site
record and stamps a server-issued owner badge (a crown) on that character for everyone in
the square. The flag is re-applied on every join and is gated by the visitor's
server-issued `browserSecret`, so it cannot be forged by typing a name or by another
browser asserting the same id. Ownership is per-browser, in keeping with the accountless
model; see the README "Mark the site owner" section for the owner-facing steps.

Registered site records are stored in `.data/sites.json` by default.
For production, set `DATA_DIR` to a persistent directory and `PUBLIC_ORIGIN` to the public HTTPS origin.

## Service admin

Set `SERVICE_ADMIN_PASSWORD` and open:

```text
https://your-townsquare-host/service-admin
```

The service admin page is for the operator of the shared TownSquare server.
It can list registered sites, reset a site's admin token, disable a site or its chat, and delete site records.
Reset tokens are shown once and then stored only as hashes.

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
Set `DEPLOY_MODE=local` in that file, or pass `--local`, when running directly on the host that owns `/opt/townsquare`.
Local mode skips SSH and deploys the archive directly before restarting the configured systemd service.

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
- accounts
- admin-link recovery
- billing or tenant dashboards
- hosted multi-site control plane

That is intentional.
First make the single-site system clean and easy to run.
Then layer the hosted model on top.
