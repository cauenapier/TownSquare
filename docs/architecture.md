# TownSquare architecture

This doc describes the current system boundary and the next one.
It is intentionally short. Source code is the source of truth for implementation details.

## Current boundary

TownSquare currently has three practical surfaces:

1. **Embed client**
   - browser module mounted into a host page
   - owns scene rendering, keyboard input, local animation, and chat UI
   - connects to one TownSquare server origin over WebSocket

2. **Realtime scene service**
   - serves static assets
   - accepts WebSocket connections
   - owns ephemeral scene state and prop arbitration
   - routes either the default self-hosted scene or registered hosted site scenes
   - currently runs as one simple Node process with in-memory scene state

3. **Demo host page**
   - exists only for development and manual testing
   - should stay separate from the reusable widget boundary

4. **Hosted registration/admin surface**
   - accountless site registration
   - public site key for embed routing
   - private admin token for moderation/settings, stored as a hash
   - verified owner badge: admin marks a live visitor's browser id into the site's
     `ownerBrowserIds`; the server stamps `isOwner` on that identity (gated by the
     visitor's `browserSecret`, so it cannot be spoofed) and broadcasts it as a crown
   - service admin password for operator-level site management
   - small JSON site registry

That separation is now reflected directly in the repo:
- `public/townsquare.mjs` = reusable widget mount API
- `public/widget/` = widget implementation split by concern: scene/DOM (`dom`,
  `figure`), chat bubbles (`chat`, `bubble-layout`), presence/protocol
  (`presence`, `protocol`), input/motion (`movement`), ambient `birds`,
  host-page reading tags (`page-watch`), the fullscreen `expand` controller,
  the shared mount `context` typedef, and small `constants`/`math`/`utils`.
- `public/shared-constants.mjs` + `public/scene-props.mjs` +
  `public/bird-perches.mjs` = protocol/scene definitions loaded by both the
  browser widget and the CommonJS server (keep them browser/Node-agnostic).
- `public/demo.mjs` + `public/index.html` = demo shell
- `public/register.html` + `public/admin.html` + `public/service-admin.html` =
  hosted setup/admin shells, sharing `public/hosted-common.mjs` and
  `public/ui-common.mjs`
- `public/dev.html` + `public/dev-scene.mjs` + `public/walk-sandbox.*` = dev tooling
- `server.js` = static + realtime service

## Why this boundary matters

This is the minimum shape that supports both:
- **self-hosted single-site TownSquare** now
- **hosted multi-site TownSquare** later

If the widget has a stable mount API and the server has a stable realtime protocol, the hosted path can be added as a registration/orchestration layer instead of as a rewrite.

There is also an important in-between shape worth preserving:
- a TownSquare can be self-hosted and independently operated
- while still optionally communicating with other TownSquares
- so self-hosting and wider-network participation are not mutually exclusive

## What we should build now

Focus now:
- self-hosted deployment that is easy to run
- clear embed instructions
- stable client-to-server contract
- scene and prop quality inside the default experience

Do not front-load yet:
- tenant dashboards
- billing
- complex per-site configuration UIs
- multi-region world routing
- account-heavy identity systems

## Hosted path, later

The first hosted shape is:

1. Site owner registers a URL with the main TownSquare service.
2. The service issues an embed snippet with a public site key.
3. The service issues a private admin link with an admin token.
4. The widget connects to the main service using that site identity.
5. The runtime keeps site-level scene separation while optionally allowing curated cross-site travel later.

That suggests a future fourth surface:

4. **Site registration and network layer**
   - site metadata
   - site allowlists / origin checks
   - site config
   - hosted administration through admin tokens first, accounts later if needed
   - world/neighbourhood linking

Important: this layer should sit **around** the current widget/runtime contract, not leak deeply into it.

## Optional inter-TownSquare communication

The long-term network story should not assume that every connected TownSquare belongs to one centrally hosted control plane.

A self-hosted TownSquare may eventually expose or consume a small communication layer that allows:
- discovery of neighbouring TownSquares
- explicit linking between places
- shared travel paths between independently run sites
- participation in a wider network without surrendering local hosting

That should stay optional.
The local self-hosted deployment must still work cleanly on its own.

## Immediate technical implications

Near-term changes should preserve these rules:
- the widget should mount into any DOM node without needing the demo page
- the widget should know which server origin to use without assuming same-page hosting
- the server should be deployable behind a normal reverse proxy
- health checks and operational docs should exist before broader packaging work

## Current limits

Deliberate current limits:
- one process
- in-memory state
- JSON-backed site registry, not a database-backed control plane
- no user accounts
- no admin-link recovery

These are fine for now.
The mistake would be pretending they are already the hosted product.
