# TownSquare

**NOTE**: This project has been mostly vibe-coded

TownSquare is a tiny presence layer for websites.

This repo currently contains a narrow but real slice:

- embeddable browser widget
- real-time shared presence
- simple left/right walking
- lightweight real-time chat
- bench and tree props with simple seat interactions
- no-account hosted site registration
- ephemeral in-memory server state

The codebase is intentionally small. The main goal right now is to make the product boundary clear enough that TownSquare can be self-hosted cleanly and later grow into a hosted shared service without rewriting the core widget.
Self-hosted should not mean forever disconnected: a self-hosted TownSquare may also choose to communicate with other TownSquares and become part of the wider network.

## Repo shape

- `server.js` — Node server for static assets, health checks, and WebSocket presence
- `public/townsquare.mjs` — reusable embeddable widget mount API (public embed URL `/townsquare.mjs`)
- `public/widget/` — widget implementation modules (DOM, chat, presence, protocol, movement)
- `public/shared/` — protocol, scene, style, and map definitions shared with the server
- `public/widget.css` — embeddable widget styling (scoped to `#townsquare-root`)
- `public/page.css` — feature-specific layout for TownSquare host pages
- `public/design/` — canonical public-page tokens, base styles, and shared chrome
- `public/tokens.css` — independent widget tokens (imported by widget.css)
- `public/lib/` — generic browser helpers shared across pages (e.g. `ui-common.mjs`)
- `public/hosted/` — hosted registration/admin pages and scripts, served at `/register`, `/admin`, `/service-admin`
- `public/map.html` — public map of verified, enabled TownSquares, served at `/map`
- `public/dev/` — local dev tooling: `dev.html` (simulation, `/dev`) and `walk-sandbox.html` (`/walk-sandbox`)
- `scripts/smoke-test.js` — automated websocket smoke test
- `spec.md` — product truth
- `roadmap.md` — product-facing sequencing
- `docs/architecture.md` — current boundaries and future hosted shape
- `docs/design-system.md` — visual contract for TownSquare-owned public pages

The landing page, user documentation, and changelog live in the private
`TownSquare_landingpage` repository. Set `LANDING_ORIGIN` to redirect those
routes when this server is reached directly.

Public design foundations are canonical in `public/design/` and copied into the
landing repository with the ignored local helper at `scripts/admin/sync-design.js`.
The helper can also check for drift and does not copy or modify widget styles.

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
2. Open the development scene:
  ```text
   http://127.0.0.1:8787/dev
  ```
3. Open it in two windows or two browsers.
4. Verify the current slice manually:
  - two tabs from the same browser still share one visitor
  - a different browser or browser profile shows a second visitor
  - arrow keys move your figure left/right
  - tapping the stage walks there, while horizontal touch swipes walk by the swipe distance without blocking vertical page scrolling
  - pressing H shows a high-five emoji, and a nearby second visitor pressing H high-fives you
  - on touch devices, the jump and high-five buttons trigger the same actions
  - movement is reflected in the other window
  - pausing by the bench or tree settles the visitor into a seat
  - chat messages appear above the figure and also enter the recent-message tray
  - closing one tab does not remove the visitor if another tab from that browser is still open

For local scene stress testing with one controllable local user plus simulated visitors, use:

```text
http://127.0.0.1:8787/dev?characters=24
```

For frame-by-frame walk-cycle review, use:

```text
http://127.0.0.1:8787/walk-sandbox
```

## Embed the widget into another site

A site can embed the widget by loading the CSS plus the module from the TownSquare server:

```html
<link rel="stylesheet" href="https://your-townsquare-host/widget.css" />
<div id="townsquare-root"></div>
<script type="module">
  import { mountTownSquare } from "https://your-townsquare-host/townsquare.mjs";

  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "https://your-townsquare-host",
    socketPath: "/live",
    theme: "host"
  });
</script>
```

Notes:

- `serverOrigin` is the realtime/backend origin the widget should connect to.
- `socketPath` defaults to `/live`; set it explicitly when your reverse proxy exposes TownSquare on a different websocket path such as `/townsquare/live`.
- `siteKey` is only needed when using one hosted TownSquare server for multiple registered sites.
- `theme: "host"` syncs with common host-page dark mode signals such as
  `html.dark`, `body.dark`, `data-theme`, `data-bs-theme`, and `data-color-mode`,
  or an explicit `color-scheme: light|dark` on `html`/`body`. When none of those
  are present it stays on the light palette so macOS dark mode does not restyle
  the widget on a light page. Omit `theme` to use `auto`, which follows
  `prefers-color-scheme`.
- To restyle the square, set the palette tokens (`--scene`, `--page`, `--surface`,
  `--ink`, `--you`, `--tree-trunk`, `--tree-canopy`, `--other`, `--ground`) on
  `#townsquare-root` in your own stylesheet. The widget writes no inline palette
  styles, so your CSS wins. See [Customization](#customization).
- The host page owns placement and surrounding layout.
- TownSquare owns the scene, movement, chat, and realtime transport inside the mount root.

## Hosted registration

User-facing guidance is maintained with the public site in the private
`TownSquare_landingpage` repository.

TownSquare can also run as a tiny hosted service.
Open:

```text
https://your-townsquare-host/register
```

The flow is intentionally accountless:

- enter a website URL
- optionally allow the matching `www`/non-`www` version with one checkbox
- receive an embed snippet with a public site key
- receive a private admin token and admin link
- paste the snippet into the website

The public `siteKey` routes visitors into that site's isolated scene.
The private admin token is the password for settings and moderation.
Save it; the admin page asks for it to sign back in later.
Generated admin links keep the token in the URL fragment so it is not sent in HTTP requests.
Only an admin token hash is stored in the site registry.

The admin page can:

- show install/seen status
- show active visitors
- customize the scene (bench/tree/lamp/bird counts and placement) and colors, with a live preview (see [Customization](#customization))
- mark an active visitor as the verified site owner (and unmark them)
- kick or block active visitors
- disable chat
- disable the site
- clear recent in-memory messages

### Mark the site owner

Visitors are anonymous, so by default nothing distinguishes the owner from anyone
else. To get a tamper-resistant owner badge (a 👑 crown) on your own character:

1. Open your own site so you appear as a live visitor. Add `#townsquare-owner` to the
   URL and the widget shows a hint with your visitor number (`You're visitor #N …`).
2. Open the admin page and find that visitor in the active list.
3. Click **Make owner**. Your character gains the crown live for everyone in the square,
   and keeps it on every future visit from that browser. Click **Owner ✓** to remove it.

The badge is server-issued, so it cannot be faked by typing a name or picking a color.
Ownership is bound to the specific browser that was marked — it is verified by the same
server-issued `browserSecret` that keeps a visitor's character stable across refreshes,
so another browser asserting the same id without that secret gets no crown. Because the
project stays accountless, a new device or cleared browser storage means marking owner
once more (one click). You can mark more than one browser if you want the badge on
several devices. Marked browser ids are stored per site under `ownerBrowserIds` in
`.data/sites.json`.

### Customization

Every square ships with a default hosted style — the palette baked into
`public/tokens.css` (light and dark), which `DEFAULT_SITE_STYLE` in
`public/shared/site-config.mjs` mirrors. No setup is needed to look good.

The admin and registration pages expose two kinds of customization, each with a
live preview:

- **Scene** — bench/tree/lamp/bird counts and per-prop placement. Saved server-side
  per site in `sceneConfig` and pushed to live embeds by `siteKey`, so changes take
  effect immediately without re-pasting anything (`refreshSiteScenes` in `server.js`).
- **Colors** — a palette per mode (light/dark) saved in `styleConfig`. Because hosted
  embeds never write palette tokens inline, colors are delivered as a small scoped CSS
  block (`buildSiteCss`) the owner copies into their own stylesheet. The admin/register
  pages generate this **Customization CSS** block from the swatch choices. Re-copy it
  after changing colors.

The CSS sets these tokens, scoped to `#townsquare-root` for light, explicit dark, and
`prefers-color-scheme` dark: `--scene` (background), `--page` (ground), `--surface`
(buttons/tags), `--ink` (text/line work), `--you` (accent), `--tree-trunk`,
`--tree-canopy`, `--other`, and `--ground`. Advanced owners can edit that block or
write their own rules on the same tokens — the widget writes no inline palette styles
for hosted embeds, so host CSS always wins.

Registered sites are stored in `.data/sites.json` by default.
Set `DATA_DIR` if the registry should live somewhere else.
Set `PUBLIC_ORIGIN` in production so generated snippets use the public HTTPS origin.
Set `LANDING_ORIGIN` when this server should redirect `/`, `/docs`, and `/changelog` to a separately hosted public site.
Set `PLAUSIBLE_DOMAIN` and `PLAUSIBLE_SCRIPT_SRC` to inject Plausible into every HTML page served by TownSquare. The landing repository loads the same tracker from its shared `site.mjs` on the canonical production hostname.
Set `AUTH_FAILURES_PER_HOUR` to tune per-IP failed admin sign-in throttling; `0` disables it.
Set `SERVICE_ADMIN_PASSWORD` to enable `/service-admin`, where the service operator can manage registered sites and paint the global `/map` scenery. The editor supports density-controlled tree scattering, freehand lakes, and curved rivers. Saved maps live in `DATA_DIR/map-world.json`; see the map modules for schema and validation details.
Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to send a Telegram notification whenever a chat message is sent.
Set `INACTIVE_DISCONNECT_MS` and `INACTIVE_CHECK_INTERVAL_MS` to control away/inactive disconnects (see `.env.example`).
For local runs, copy `.env.example` to `.env` (or create `.env` directly); `server.js` loads it on startup. Real environment variables win over `.env` values.

## Deploy updates

This repo includes a deployment helper:

```bash
cp .env.deploy.example .env.deploy.local
scripts/deploy.sh
```

On the shared host checkout, `.env.deploy.local` can use local mode so redeploys do not need SSH:

```bash
DEPLOY_MODE=local
DEPLOY_ROOT=/opt/townsquare
DEPLOY_SERVICE=townsquare.service
DEPLOY_PORT=8788
```

Useful flags:

```bash
scripts/deploy.sh --promote-main
scripts/deploy.sh --local
scripts/deploy.sh --skip-checks
scripts/deploy.sh --tag staging
scripts/deploy.sh --ref origin/main
scripts/deploy.sh --env-file ./ops/my-deploy.env
```

By default, the script deploys the local `production` tag. Use `--promote-main`
to fetch `origin/main`, move the deploy tag to that commit, deploy it, and push
the tag to `origin` after a successful deploy. Use
`--tag` for another tag. It resolves only real Git tags, so annotated and
lightweight tags both deploy the commit the tag points to. Keep `--ref` for
explicit branch, SHA, or rollback deploys without retagging.

The script:

- runs local syntax checks unless skipped
- archives the chosen git tag or ref
- uploads it to the server for remote deploys, or deploys directly in local mode
- creates a new release under `/opt/townsquare/releases`
- runs `npm ci --omit=dev`
- flips `/opt/townsquare/current`
- restarts `townsquare.service`
- checks the local health endpoint
- optionally checks a public health endpoint when `HEALTHCHECK_URL` is set

Remote mode expects a machine with working `ssh` and `scp` access to the server.
Local mode expects permission to write the deploy root and restart the service, usually via root or sudo.

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
- hosted site isolation and admin token hashing
- moderation tools (word filter, mute/unmute, slow mode, moderation log)
- service-admin map validation and persistence

To also verify inactive disconnect, restart the server with a short timeout and rerun smoke:

```bash
INACTIVE_DISCONNECT_MS=800 INACTIVE_CHECK_INTERVAL_MS=200 npm start
INACTIVE_DISCONNECT_MS=800 npm run smoke
```

## Current scope

Included now:

- one embeddable widget module
- one default scene
- presence
- walking
- bench and tree props with simple seat interactions
- lightweight chat with small per-character recovery tray
- self-hostable single-process server
- accountless hosted site registration with isolated scenes
- token-protected hosted admin/moderation page
- verified site-owner badge (server-issued crown, bound to the owner's browser)

Not included yet:

- persistence
- accounts or admin-link recovery
- heavy moderation systems
- multiple scenes
- cross-site travel
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
