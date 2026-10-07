# TownSquare product spec

## Purpose

TownSquare makes a website feel inhabited. It is a small shared scene where
visitors can see one another, move, use lightweight interactions, and chat.
Presence comes first; conversation is local to that shared place.

## Current product

- An embeddable widget for a self-hosted scene or an isolated registered site.
- Keyboard, tap, and swipe movement; scene-native interactions and lightweight
  chat.
- A persistent, per-site display name and colour. This is recognition, not an
  account: it is unverified, non-unique, and does not grant access.
- Hosted site controls for appearance, scene configuration, owner identity,
  moderation, analytics, overlays, counters, and optional trusted add-ons.
- A public directory/map of eligible hosted sites and in-widget discovery.

The implementation and compatibility boundaries are described in
[`docs/architecture.md`](docs/architecture.md); the public plugin contract is
in [`docs/plugins.md`](docs/plugins.md).

## Product boundaries

- Not a social network, account system, or long-term chat archive.
- Not a multi-process or multi-region service; live scene state is owned by one
  process.
- Not a promise of durable identity, permanent bans, or complete bot detection.
- Not an open remote-plugin marketplace. Extensions are trusted in-process
  modules controlled by the operator.

Site owners do have practical moderation controls. They should keep a shared
space usable without turning TownSquare into a community-management platform.

## Principles

- Make shared presence useful before adding social complexity.
- Work well with a generated embed snippet and sensible defaults.
- Keep configuration and extension optional.
- Be honest about privacy, identity, and abuse-control limits.
- Keep self-hosting and the open-source core first-class.

## Open product questions

- What additional trust gate, if any, belongs on a visitor's first public
  action?
- Which customization options genuinely help a host without diluting the shared
  experience?
- What consent and storage model would make cross-site identity appropriate?
- Can cross-site travel feel continuous while remaining simple and opt-in?
