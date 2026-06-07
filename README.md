# TownSquare

TownSquare is a tiny presence layer for websites.

This repo currently contains the **first playable slice**:
- a real embedded widget on a normal page
- real-time shared presence
- simple left/right walking
- lightweight real-time chat
- ephemeral in-memory state only

It is intentionally small, readable, and dependency-light so the project can grow in the open without carrying early complexity.

## What is in this repo right now

- `server.js` — tiny Node server that serves the demo page and handles WebSocket events
- `public/index.html` — demo page used for local development/testing
- `public/widget.js` — browser-side widget logic
- `public/widget.css` — demo/widget styling
- `scripts/smoke-test.js` — small automated websocket smoke test
- `spec.md` — product spec
- `v1-interaction-model.md` — first usable interaction model
- `roadmap.md` — product-level roadmap

## Requirements

- Node.js 18+
- npm

## Install

```bash
npm install
```

## Run locally

Start the demo server:

```bash
npm start
```

By default it runs at:

```text
http://127.0.0.1:8787
```

You can override host/port if needed:

```bash
HOST=0.0.0.0 PORT=8787 npm start
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

4. Verify the first slice manually:
   - opening the page in two tabs of the same browser still shows only one shared visitor
   - opening it in a different browser or separate browser profile shows a second visitor
   - arrow keys move your figure left/right
   - movement is reflected in the other window
   - chat messages appear above the figure and disappear after a few seconds
   - closing one window removes that visitor from the other window only when it was the last tab for that browser

## Checks

Syntax check the current code:

```bash
npm run check
```

Run the websocket smoke test (requires the server to already be running):

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

This first slice is intentionally narrow.

Included now:
- one embedded widget
- one default scene area
- presence
- walking
- chat

Not included yet:
- props/bench interaction
- persistence
- accounts
- identity
- moderation systems
- multiple scenes
- cross-site travel
- packaging for third-party drop-in embeds

## Design notes

A few deliberate choices in this first version:

- **No framework yet**: easier to read and easier to change while the core interaction is still moving.
- **In-memory server state**: enough for presence/chat validation without premature backend complexity.
- **Demo page inside the repo**: lets us test the widget as an embedded experience instead of as a disconnected toy.
- **Small file count**: acceptable for the first slice, as long as the code stays clean. We can split into a package structure once the interaction settles.

## Next likely steps

- add the first prop interaction (bench)
- improve scene legibility and inhabited feeling
- define the clean embed API/boundary
- separate demo-app concerns from reusable widget concerns

## License

TBD
