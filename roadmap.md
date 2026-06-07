# TownSquare roadmap

Product-level sequencing. Directional, not an implementation plan.
`spec.md` = intent; `v1-interaction-model.md` = first usable experience.

Each item has a concrete "done when" bar.

## Where we are

First playable slice works: widget, presence, movement, chat, one bench, deployable server.

Still thin: scene feels like a demo strip; one prop; anonymous visitors; deployment docs lack production examples; embed API not yet stable.

## Done

- [x] **Shared presence**: live scene; movement and idle visible to others
- [x] **Left/right movement**: responsive, readable, not game-like
- [x] **Lightweight chat**: speech bubbles + per-character recovery tray
- [x] **Bench prop**: pause to sit; consistent seat ownership
- [x] **Shared visitor across tabs**: one character per browser
- [x] **Reusable embed module**: widget separate from demo bootstrap
- [x] **Self-hostable server**: assets, WebSocket, `/healthz`, Docker

## Now

Focus: **scene legibility** and **credible self-host on a real site**.

### Scene

- [ ] **Default props**: trees and lamps join the bench
- [ ] **Distinct behaviors**: one obvious interaction per prop, no instructions needed
- [ ] **Busy-scene readability**: capped bubbles per character, overflow to tray, basic collision avoidance

### Self-host

- [ ] **Real-site embed**: third-party page mounts widget with documented steps
- [ ] **Production proxy examples**: copy-paste nginx/Caddy configs with WebSocket on `/live`
- [ ] **Documented embed contract**: `mountTownSquare` options documented; breaking changes versioned

## Next

Finish v1 without reading source.

### Visitors

- [ ] **Optional display name**: short ephemeral name on own character; no accounts
- [ ] **Click/tap props**: intentional interaction where proximity isn't enough
- [ ] **Arrival clarity**: live place, who's here, can move and chat: obvious in seconds

### Site owners

- [ ] **Operator checklist**: install, health check, embed, two-browser test, common failures
- [ ] **Stable widget + protocol**: public contract; hosted layer can sit on top later
- [ ] **Basic Moderation**: allow admins to kick/block people

### Boundary (concept)

- [ ] **Hosted shape defined**: register site, get snippet, no self-hosted server: around current runtime
- [ ] **Optional network**: self-hosted sites can opt into discovery, linking, travel

## Future

Post-v1, roughly ordered.

- [ ] **Movement between places (websites)**: travel feels like walking, not a normal link
- [ ] **Map / world view**: nearby linked places (websites) without clutter
- [ ] **Connected neighbourhoods**: sites read as one wider world
- [ ] **Hosted registration**: same product, hosted deployment
- [ ] **Custom props and interactions**
- [ ] **Open interfaces**: maps, visualizations, related tools

## Ideas bucket

- [ ] **Optional message notifications**: simple on/off, quiet by default
- [ ] **Minimum moderation story**: lightest viable public-chat surface

## Open questions

- How much cross-site identity before it stops feeling ephemeral?
- How are neighbouring sites chosen or discovered?
- Smallest moderation surface that keeps chat usable?
