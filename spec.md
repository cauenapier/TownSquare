# Town Square — a tiny presence layer for websites

Short product spec for what this project is trying to be.

## What it is

A tiny presence layer for websites.

Visitors can see that other people are there, walk left and right through a tiny shared scene, interact with a few simple props, and chat in a lightweight shared space at the bottom of the page.

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

- Phase 3 — Social texture
  - lightweight names are supported
  - small expressive actions and ambient feedback make the scene feel more alive
  - the balance between movement, props, and chat becomes smoother and more intuitive

- Phase 4 — Neighbourhood expansion
  - portals, gates, or similar transitions can link participating sites
  - movement between sites starts to feel diegetic rather than link-like
  - the product begins to resemble a small web neighbourhood rather than a single isolated widget

This roadmap is directional. The spec is the source of truth for product intent; later engineering plans can be more detailed and more disposable.

## Product shape

TownSquare can support both:
- a self-hosted, open-source path
- a hosted, shared-service path

These are not two different products, just two ways the same product may exist and spread. Sequencing can be made clearer later in the roadmap if needed.

## A wider world

A strong post-v1 direction is for TownSquare to stop feeling like a widget attached to one site and start feeling like a small world spread across many sites.

The core idea is simple:
- each site is a place
- movement between places is part of the experience
- travel should feel like travel, not like clicking away

If this works, the web starts to feel less like isolated pages and more like a walkable neighbourhood. Small clusters can become streets, districts, and eventually a larger shared world.

The important quality is not scale for its own sake, but continuity. A visitor should feel that they are still inside the same living environment even as they move outward.

This is not necessary for v1, but it is one of the clearest long-term directions in the product.

## Open questions worth preserving

- How much short-term history is useful before it starts feeling too persistent?
- What is the minimum moderation story needed even for lightweight public chat?
- How much customization is necessary before the product starts getting diluted?
- How should cross-site travel work without breaking the simplicity of the widget?
- How should neighbouring sites be chosen or discovered?
- How should the map show local clusters without becoming cluttered?
- What is the lightest way to connect different regions while keeping the world coherent?
- How much shared identity between sites is useful before the system starts feeling too persistent?
