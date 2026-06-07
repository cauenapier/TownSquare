# Town Square — a tiny presence layer for websites

Short product spec for what this project is trying to be.

## What it is

A tiny presence layer for websites.

Visitors can see that other people are there, walk left and right through a tiny shared scene, interact with a few simple props, and chat in a lightweight scene-native shared space.

The goal is to make a site feel inhabited.

## What it is not

- Not a social network
- Not a full virtual world
- Not an account system
- Not a persistent identity layer
- Not a long-term chat archive
- Not a moderation-heavy community platform in v1

## Why it exists

The web feels crowded but empty.
There is content everywhere, but little felt human presence. This project is meant to bring back a small sense of shared aliveness: the feeling that other people are here too, right now.

It should create presence first, conversation second.

## Who it is for

First audience:
- indie web people
- personal sites
- small hand-made sites
- technically curious people who are comfortable self-hosting

## Core concepts

- Site — a single place a person can visit on the web
- TownSquare / scene — the shared presence layer attached to that site
- Character — a visitor as represented inside the scene
- Props — environmental objects inside the scene, such as benches, trees, and lamps
- Interaction — a small action between a character and the scene, another character, or a prop
- Chat — lightweight local conversation inside that shared place
- Map — a higher-level view of how places connect
- Neighbourhood — a cluster of nearby or related places
- World — the larger network of connected places

## Core product principles

- Presence and lightweight chat are both essential
- It should work beautifully with almost no options
- Feeling matters as much as mechanics
- UX matters as much as technical correctness
- Complexity should be optional, not required
- Self-hosted/open source comes first

## MVP

Version 1 should provide:
- a tiny embeddable widget
- lightweight real-time presence
- lightweight real-time chat
- one strong default scene
- simple left/right walking for characters inside that scene
- a small set of environmental props that characters can interact with
- very low-friction setup
- self-hosted backend
- ephemeral interaction by default

## First playable slice

Before going deeper into the full MVP, the first working slice should prove the core feeling on a real site.

It should be:
- a real embedded widget on one page of a real site
- playable and testable in-place rather than as a disconnected mockup
- focused on presence, walking, and chat before richer scene interactions

The first slice should include:
- real-time shared presence
- simple left/right movement and idle state
- lightweight real-time chat
- one fixed default scene

It should not yet depend on:
- accounts
- persistence
- customization
- multiple scenes
- cross-site travel
- complex moderation systems
- environmental props beyond what is needed to make the scene readable

The purpose of this slice is to answer a small number of concrete questions:
- does the widget feel natural when embedded in a real page?
- does the space feel alive with presence, movement, and chat alone?
- is the interaction legible without explanation?

If that works, the next step can add one simple prop interaction, likely a bench, without changing the basic shape of the product.

## Current product shape

TownSquare should support two modes eventually:
- a clean self-hosted mode for a single site or small cluster of sites
- a hosted shared-service mode where site owners register their site instead of running the backend themselves

These are not two different products. They are two deployment shapes over the same interaction model.

Even in the self-hosted shape, a site owner may choose to let their TownSquare communicate with other TownSquares.
That means self-hosting should not imply isolation by default forever.
A self-hosted TownSquare can still be part of a bigger network if its operator opts into shared discovery, linking, federation, or travel paths.

The important boundary is:
- the widget/embed client
- the realtime scene service
- the site registration and network layer

Right now, the project should fully shape the first two.
The third should influence naming and interfaces, but should not dominate implementation yet.

## Recommended sequencing

The right order is:
1. Make single-site self-hosting clean.
2. Make the embed API and runtime boundary stable.
3. Add deployment packaging and operating guidance.
4. Only then build the hosted multi-site layer.

Why:
- the self-hosted path keeps the product honest
- it proves the embed and realtime contract without tenant complexity
- it avoids prematurely designing account, billing, registration, and moderation surfaces
- it gives a better base for a hosted service later

This also leaves room for an important middle shape:
- self-hosted TownSquares that remain independently operated
- but optionally communicate with other TownSquares
- and therefore participate in the wider network without giving up self-hosting

## Scene and interaction language

The shared space should feel a bit like a tiny sidewalk, park strip, or town-edge scene rather than an abstract chat box.

Characters should be able to:
- walk left and right
- stop and idle
- visually occupy the same scene as other visitors
- approach and interact with props placed in the scene

Props are part of the feel, not just decoration. The first scene should likely include benches, trees, street lamps, and a few other instantly readable objects.

Interaction should stay lightweight and legible rather than becoming game logic. Good examples:
- standing near a bench and sitting on it
- pausing under a lamp or near a tree
- triggering a tiny visual response from an object

The interaction model should remain simple enough that a new visitor understands it almost immediately, even if they never read instructions.

## V1 deployment boundary

For v1, a site owner should be able to:
- run one TownSquare server
- embed one small client module into their site
- point that client at the server origin
- get presence, chat, and the default scene without further infrastructure

V1 does not need:
- tenant dashboards
- a hosted admin panel
- per-site accounts
- a world graph UI
- pluggable scene packages

It does need clean seams so those can be added later without rewriting the widget.

## Non-goals for v1

- Accounts
- Persistent identity
- Reputation systems
- Long-term chat history
- Heavy moderation systems
- Rich social features
- A huge customization surface

Short-term history may be acceptable if it improves the immediate experience, but long-term history is not part of the product.

Optional lightweight naming is acceptable if it stays low-friction and ephemeral.
A visitor may optionally set a display name for their character, for example by hovering or interacting directly with the character.
That should not turn into a full account or identity system.

## Experience bar

A person should be able to add it to their site and quickly get something that feels alive, playful, and understandable without reading a long manual.

The default experience should already feel good.
Customization is allowed, but the product should not depend on customization to be compelling.

## Product roadmap

For now, the roadmap should stay at the product and experience level, not the implementation level.

- Phase 1 — Presence baseline
  - visitors appear in the shared scene
  - characters can walk left and right
  - characters can stop, idle, and feel co-present
  - lightweight chat works reliably

- Phase 2 — Scene legibility
  - the default scene feels like a place, not just a UI layer
  - benches, trees, street lamps, and similar props are added
  - prop interactions make the shared space easier to read at a glance

- Phase 3 — Deployable shape
  - self-hosting feels straightforward
  - the embed boundary is stable enough for third-party sites
  - operating the service does not require reading the source code

- Phase 4 — Hosted expansion
  - site owners can connect a site without self-hosting the backend
  - the hosted path still feels like the same product, not a separate SaaS rewrite
  - movement between participating sites can start to feel diegetic rather than link-like

This roadmap is directional. The spec is the source of truth for product intent; later engineering plans can be more detailed and more disposable.

## A wider world

A strong post-v1 direction is for TownSquare to stop feeling like a widget attached to one site and start feeling like a small world spread across many sites.

The core idea is simple:
- each site is a place
- movement between places is part of the experience
- travel should feel like travel, not like clicking away

That wider world does not need to be hosted from one central service only.
Part of the long-term appeal is that independently self-hosted TownSquares could still choose to interoperate and become part of the same wider network.

If this works, the web starts to feel less like isolated pages and more like a walkable neighbourhood. Small clusters can become streets, districts, and eventually a larger shared world.

The important quality is not scale for its own sake, but continuity. A visitor should feel that they are still inside the same living environment even as they move outward.

This is not necessary for v1, but it is one of the clearest long-term directions in the product.

## Extensibility

Over time, TownSquare should be open enough that other people can add to the world rather than only consume it.

This may include:
- custom props and interactions
- open interfaces for maps, visualizations, and related tools

This does not need to become a full platform story in v1, but the product should leave room for it.

## Open questions worth preserving

- What is the minimum moderation story needed even for lightweight public chat?
- How much customization is necessary before the product starts getting diluted?
- How should cross-site travel work without breaking the simplicity of the widget?
- How should neighbouring sites be chosen or discovered?
- How should the map show local clusters without becoming cluttered?
- What is the lightest way to connect different regions while keeping the world coherent?
- How much shared identity between sites is useful before the system starts feeling too persistent?
