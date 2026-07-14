# TownSquare architecture

TownSquare is deliberately a single-process application. This document records
the stable boundaries; source code is the authority for endpoint and payload
details.

## Runtime boundaries

1. **Widget** — `public/townsquare.mjs` mounts into a host-owned DOM node.
   Modules under `public/widget/` render the scene and handle input, presence,
   chat, optional plugins, and the WebSocket connection.
2. **Server** — `server.js` serves assets and APIs, validates WebSocket actions,
   owns live scene state, and coordinates persistence and plugins through focused
   modules under `server/`.
3. **Hosted control plane** — pages under `public/admin/hosted/` register sites
   and manage site or service settings. Public site keys select isolated scenes;
   private tokens and the service password protect mutations.
4. **Public network map** — `public/map/` renders verified sites and persisted
   operator-edited scenery from `DATA_DIR/map-world.json`.
5. **Landing site** — marketing pages, user documentation, and the changelog live
   in the separate landing repository. `LANDING_ORIGIN` redirects those routes.

## Shared contracts

`public/lib/` is the canonical home for browser/Node-neutral modules. The browser
and server import the same protocol constants, URL rules, scene geometry, site
configuration, and map schema. These files must not depend on DOM or Node-only
APIs.

The public embed URLs `/townsquare.mjs` and `/widget.css`, and the WebSocket
message types in `public/lib/protocol.mjs`, are compatibility boundaries. Internal
files may move when their imports and tests move with them.

Hosted site configuration has two delivery paths:

- the site-specific stylesheet endpoint provides palette tokens;
- the WebSocket hello/update messages provide scene, connections, message board,
  and enabled plugin data.

The registration snippet installs both once. Later admin changes are served by
the same URLs and do not require a new snippet.

## Persistence and process model

The server keeps connected visitors, recent messages, and scene activity in
memory. Site records and the global map are JSON files under `DATA_DIR`.
`server/sites-store.js` owns registry serialization and its format version;
`server.js` normalizes older records when loading them.

This model intentionally assumes one application process. Multi-process or
multi-region operation would require external shared state and is not an implied
property of the current protocol.

## Plugins

Trusted in-process plugins add decisions, event handlers, admin actions, visitor
data, and browser modules around the core runtime. They receive constrained data
objects rather than sockets or registry internals. The complete contract is in
[`plugins.md`](plugins.md).

## Security boundary

- Origin validation and site keys select allowed hosted scenes.
- Browser identities are paired with a server-issued secret; they are not user
  accounts.
- Site admin tokens are hashed at rest and exchanged for same-origin sessions.
- Service-admin operations require the configured operator password.
- A loopback reverse proxy may supply `X-Real-IP`; arbitrary remote peers may not.
- Rate limits and optional proof-of-work protect actions, but do not claim durable
  human identity or permanent bans.

Abuse controls and their remaining product questions are summarized in
[`ideas/anti-bot-plan.md`](ideas/anti-bot-plan.md) and
[`ideas/moderation.md`](ideas/moderation.md).
