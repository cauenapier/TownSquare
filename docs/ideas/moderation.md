# Moderation roadmap

How TownSquare grows its moderation story without becoming "a moderation-heavy
community platform" (see `spec.md`). Presence first, conversation second —
moderation should protect that, not dominate it.

## Guiding principles

- **Off by default.** A fresh site needs zero moderation config to feel good.
  Every tool here is opt-in per site.
- **Owner-driven, low-ceremony.** Owners moderate from the admin page; actions
  are one click and reversible where possible.
- **Soft before hard.** Prefer mute/slow-mode over kick/ban. Kicking a visitor
  removes presence, which is the one thing the product is trying to create.
- **Honest about limits.** Identity is a `browserId` + secret, not an account.
  Bans raise the cost of abuse; they are not permanent. The UI should say so
  rather than imply more.

## Current state

Implemented in `server.js` (admin action handlers near `kickVisitor`):

- `setChatDisabled` — site-wide chat kill switch
- `kickVisitor` — disconnect, rejoinable (close code 4001)
- `blockVisitor` — ban persisted by `browserId` (close code 4003)
- `setOwnerVisitor` — promote / demote owners
- auto inactive-kick, fixed chat throttle (`CHAT_THROTTLE_MS`), `MAX_MESSAGE_LEN`
- Telegram notification on every chat message

We have the hard tools (kick/ban) and a broadcast tool (disable chat). The gaps
are **soft/graduated enforcement**, **content filtering**, and **review/visibility**.

---

## Phase 1 — Low-hanging fruit ✅ shipped

Small, self-contained, slotted into existing hooks (per-site config +
`applyWordFilter` / `handleSay`). All off by default; admin-managed from the
Moderation section.

- [x] **Forbidden-words filter.** Per-site list (`site.blockedWords`), masked
  with `*` via `applyWordFilter()`. Applied to chat in `handleSay()` and to
  display names in `handleInit`/`handleProfile`. Whole-word, case-insensitive —
  avoids the Scunthorpe problem.
- [x] **Mute.** `site.mutedBrowserIds` (mirrors `blockedBrowserIds`). A muted
  visitor stays present but their messages are dropped server-side in
  `handleSay()`. Indefinite, toggled from the visitor list and chat thread.
  - *Note:* like the existing site-wide chat disable, the muted user still sees
    their own optimistic local echo (the widget echoes before the server);
    peers never receive it. Timed/auto-expiring mutes were deferred.
- [x] **Configurable slow mode.** `site.chatThrottleMs` (default 0.5s, capped at
  30s) read by `getChatThrottle()`. Owners pick a cooldown in the admin UI; the
  widget enforces it too, showing a "wait" hint instead of silently dropping.
- [x] **Moderation log.** `site.moderationLog` (newest-first, capped at 50) via
  `logModeration()`. Records kick/block/mute/unmute and chat/site toggles;
  rendered read-only in the admin Moderation section.

Covered by `scripts/smoke-test.js` (`assertModerationTools`): word masking,
mute/unmute propagation, slow-mode suppression, and log ordering.

## Phase 2 — Medium

Useful, slightly larger surface. Decide after Phase 1 ships and we see real use.

- [ ] **Report button.** Visitors flag a message/visitor; routes to the existing
  Telegram channel. Cheap given the notification plumbing already exists.
- [ ] **Link controls in chat.** Block or allow-list URLs in messages, mirroring
  how `readingUrl` is already validated against the site origin. Stops spam /
  phishing.
- [ ] **Spam heuristics.** Repeated-identical, ALL-CAPS, flood detection →
  auto-mute. Builds on throttling + Phase 1 mute.
- [ ] **Admin recent-messages view.** Surface `identity.messages` so an owner
  can judge context before acting.

## Phase 3 — Complex / needs a decision

Real product tension with the "lightweight, not a community platform" ethos.
Don't build until the open questions below are answered.

- [ ] **Shadow mute.** Muted user still sees their own messages; nobody else
  does. Reduces retaliation, but is deliberately deceptive — does it fit the
  product's tone?
- [ ] **Pre-moderation / approval mode.** Messages held until an owner approves.
  Powerful for high-stakes sites, heavy for a presence layer.
- [ ] **Stronger bans (IP / auth).** The only way past trivial ban evasion, but
  it pushes toward an identity/account system the product explicitly avoids.
- [ ] **Shared / built-in wordlist packs.** Curated slur and spam lists owners
  toggle on. Convenient, but introduces a maintenance and policy burden.

---

## Open questions

- What *is* the minimum moderation story for lightweight public chat? Phase 1
  is a proposed answer — validate it before committing to Phase 3.
- Is shadow-muting acceptable for a product whose whole point is honest presence?
- How far do we go on ban evasion before it forces an account system?
- Should filtering ship with built-in wordlists, or stay BYO to avoid owning a
  content-policy?
