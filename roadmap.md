# TownSquare roadmap

Product-level sequencing. Directional, not an implementation plan.
`spec.md` = intent; `v1-interaction-model.md` = first usable experience.

Each item has a concrete "done when" bar.

## Where we are

First playable slice works: widget, presence, movement, chat, bench and tree props, deployable server.

Still thin: scene feels like a demo strip; anonymous visitors; deployment docs lack production examples; embed API not yet stable.

## Done

- [x] **Shared presence**: live scene; movement and idle visible to others
- [x] **Left/right movement**: responsive, readable, not game-like
- [x] **Lightweight chat**: speech bubbles + per-character recovery tray
- [x] **Bench prop**: pause to sit; consistent seat ownership
- [x] **Tree prop**: pause to rest; consistent seat ownership
- [x] **Shared visitor across tabs**: one character per browser
- [x] **Reusable embed module**: widget separate from demo bootstrap
- [x] **Self-hostable server**: assets, WebSocket, `/healthz`, Docker

## Now

### Mobile (high priority)

- [ ] **Mobile optimization**: touch-friendly movement and prop interaction; scene, bubbles, and tray readable on small screens; acceptable performance on phones

### Scene

- [ ] **Default props**: lamps and a few more quiet scene props join the bench and tree
- [ ] **Distinct behaviors**: one obvious interaction per prop, no instructions needed
- [ ] **Busy-scene readability**: capped bubbles per character, overflow to tray, basic collision avoidance

### Self-host

- [ ] **Real-site embed**: third-party page mounts widget with documented steps
- [ ] **Production proxy examples**: copy-paste nginx/Caddy configs with WebSocket on `/live`
- [ ] **Documented embed contract**: `mountTownSquare` options documented; breaking changes versioned

### Safety

- [ ] **Safe chat text**: reject or strip HTML/script payloads in messages (e.g. `<script>alert("hmmm")</script>`); chat always treated and rendered as plain text end-to-end

## Next

### Visitors

- [x] **Optional display name**: short ephemeral name on own character; no accounts
- [x] **Character color**: visitor picks a color for their figure; choice is visible to others and persists for the session (same browser); small curated palette, not a full color picker
- [x] **Currently reading tag**: short label of the page each visitor is on (e.g. article or page title); visible to others; updates on navigation; readable in the scene without crowding
- [ ] **Click/tap props**: intentional interaction where proximity isn't enough
- [ ] **Arrival clarity**: live place, who's here, can move and chat: obvious in seconds

### Site owners

- [ ] **Operator checklist**: install, health check, embed, two-browser test, common failures
- [ ] **Stable widget + protocol**: public contract; hosted layer can sit on top later
- [ ] **Basic Moderation**: allow admins to kick/block people
- [ ] **Style overrides**: site owners can overwrite TownSquare's default look — background, border, accent color, and other basic widget styling


### Boundary (concept)

- [ ] **Hosted shape defined**: register site, get snippet, no self-hosted server: around current runtime
- [ ] **Optional network**: self-hosted sites can opt into discovery, linking, travel

## Future

Post-v1, roughly ordered.

- [ ] **Movement between places (websites)**: travel feels like walking, not a normal link
- [ ] **Map / world view**: nearby linked places (websites) without clutter
- [ ] **Connected neighbourhoods**: sites read as one wider world
- [ ] **Hosted registration**: same product, hosted deployment
- [ ] **Site owner tag**: distinct in-scene label for the site owner; visitors can spot who's running the place at a glance; stays lightweight, not a full profile or account system
- [ ] **Custom props and interactions**
- [ ] **Open interfaces**: maps, visualizations, related tools

## Ideas bucket

- [ ] **Optional message notifications**: simple on/off, quiet by default
- [ ] **Minimum moderation story**: lightest viable public-chat surface
- [ ] **Expandable Area**: Click to expand or full-screen
- [ ] **Highlight character**: CLick to highlight character, keep history or chat focused.
- [ ] **Jump ability**: Add a keyboard shortcut to make your character jump

## Open questions

- How much cross-site identity before it stops feeling ephemeral?
- How are neighbouring sites chosen or discovered?
- Smallest moderation surface that keeps chat usable?
