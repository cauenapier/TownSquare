# TownSquare roadmap

Product-level roadmap and deliverables.
This is directional, not a detailed implementation plan.
`spec.md` remains the source of truth for product intent.

## Done

- [x] A first bench prop with a simple sit interaction
- [x] Shared visitor identity across browser tabs
- [x] Per-character recent-message tray for lightweight short-term recovery
- [x] Reusable embed/widget module separated from the demo bootstrap

## Now

- [ ] A default TownSquare experience that already feels alive without customization
- [x] Lightweight real-time chat
- [x] Left/right movement, idling, and co-presence in a shared scene
- [ ] A small set of clear props with simple interactions
- [ ] A scene that feels like a place rather than a UI overlay
- [x] Low-friction self-hosted setup
- [x] A deployable single-process server with a documented embed boundary

## Next

- [ ] Lightweight naming
- [ ] Small expressive actions or ambient feedback
- [ ] Clear self-hosted deployment docs for real servers and reverse proxies
- [ ] Stable site-facing embed API
- [ ] A clean concept for hosted TownSquare without pulling tenant complexity into the core runtime
- [ ] Optional inter-TownSquare communication for self-hosted sites that want to join the wider network
- [ ] Clear room for future extensibility

## Future

- [ ] Custom props and interactions
- [ ] Open interfaces for maps, visualizations, and related tools
- [ ] A first credible form of movement between places
- [ ] A basic map or world view
- [ ] Connected places that feel coherent enough to read as a wider world
- [ ] Hosted site registration and multi-site management

## Ideas bucket

- [ ] Optional notifications for new messages, with a simple enable/disable control similar in spirit to quiet mode
- [ ] Notification defaults and interaction states that stay lightweight and reveal complexity only on demand
