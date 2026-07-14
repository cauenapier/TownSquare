# Moderation direction

TownSquare is a presence layer, not a community platform. Moderation should keep
the space usable without becoming the dominant product surface.

## Current behavior

Site owners can disable chat; filter whole words; configure chat cooldown; mark
owners; kick, block, mute, hide, and reverse applicable actions; clear recent
messages; and inspect a bounded moderation log. Browser-ID blocks raise the cost
of returning but are not permanent identity bans.

The server also applies inactivity cleanup and source-scoped abuse limits. The
real-server smoke suite covers the core moderation and visibility transitions.
See `server.js` for action semantics and `public/admin/hosted/` for the owner UI.

## Principles

- Keep defaults usable without configuration.
- Prefer mute and cooldown before removing presence.
- Keep actions one-click and reversible where possible.
- State identity limitations honestly.
- Add a tool only when its operational value exceeds its policy and UI cost.

## Possible next work

These are uncommitted options that need a concrete owner need before building:

- report a visitor or message through the existing notification path;
- link blocking or allow-listing for phishing/spam;
- conservative repeated-message or flood detection feeding the existing mute;
- enough recent-message context for an owner to judge an action.

Pre-moderation, IP/account bans, shared word-list packs, and broader reputation
systems introduce substantially more identity or policy ownership. They should
remain out of scope until the product explicitly chooses those responsibilities.
