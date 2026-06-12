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

For local runs, `server.js` also reads `.env` if it exists.
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

Serve TownSquare somewhere reachable, then add this to the host website.
CSS and JS load without blocking the host page's first paint; the widget mounts after its stylesheet arrives:

```html
<link rel="preconnect" href="https://your-townsquare-host" crossorigin>
<div id="townsquare-root"></div>
<script type="module">
  const origin = "https://your-townsquare-host";
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${origin}/widget.css`;
  document.head.appendChild(css);
  await new Promise((resolve, reject) => {
    css.addEventListener("load", resolve, { once: true });
    css.addEventListener("error", () => reject(new Error("TownSquare CSS failed to load")), { once: true });
  });
  const { mountTownSquare } = await import(`${origin}/townsquare.mjs`);
  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: origin,
    socketPath: "/live"
  });
</script>
```

Widget static assets (`widget.css`, `townsquare.mjs`, and related files) are served with a one-day browser cache.
Repeat visitors may keep cached copies for up to 24 hours after a deploy unless they hard-refresh.

This is the core self-hosting contract:
- the website decides where the widget appears
- TownSquare owns what happens inside the widget
- the widget connects back to the TownSquare server origin you provide

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
- kick/block active visitors
- disable chat
- disable the site
- clear recent in-memory messages

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
