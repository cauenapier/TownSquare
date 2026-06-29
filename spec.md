# Town Square — a tiny presence layer for websites

Short product spec for what this project is trying to be.

## What it is

A tiny presence layer for websites.

Visitors can see that other people are there, walk left and right through a tiny shared scene, interact with a few simple props, and chat in a lightweight scene-native shared space.

The goal is to make a site feel inhabited.

## What it is not

- Not a social network
- Not a full virtual world
- Not an account system (no login, no verification, no recovery)
- Not a long-term chat archive
- Not a moderation-heavy community platform in v1

Visitors keep a lightweight nameplate they carry, not an identity they log into:
a display name and colour that persist for recognition. It is unverified,
non-unique, and never gates presence or chat. Today it persists per site;
carrying one nameplate across different sites is a separate, explicit opt-in.

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
- What is the right opt-in for carrying one nameplate across different sites, given browser storage partitioning? (Per-site persistence is settled; cross-site sharing is the open part.)
