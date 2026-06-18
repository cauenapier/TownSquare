# Hosted customization UX idea

## Goal

Make TownSquare setup feel like a one-time install for the site owner.

A site owner should copy one snippet, paste it once, and then manage the look of their TownSquare from the TownSquare admin page. They should not need to copy a new CSS block every time they change colors or scene settings.

## Proposed experience

The registration and admin pages continue to show a single embed snippet.

That snippet loads:

- the base TownSquare widget styles
- the site-specific TownSquare style from the TownSquare server
- the widget script

After that, the owner can update customization in TownSquare admin. Their website automatically picks up the latest saved TownSquare styling from the server.

## Why this is better

- Setup stays simple: copy one snippet once.
- Customization feels live and owned by TownSquare admin.
- Site owners do not need to understand CSS.
- Future styling fixes can be handled by TownSquare without asking every site owner to update pasted code.
- The host website remains responsible only for placing the square where it should appear.

## Product expectation

If the TownSquare server is reachable, the embedded square should use the latest saved style for that site.

If the site-specific style cannot load, the square should still work with the default TownSquare look.

## Owner CSS override

Hosted styling should be the default, but not a lock-in.

Advanced site owners should still be able to write their own CSS on their website if they want more control than the TownSquare admin page offers. Their CSS should be able to override the same visual tokens that hosted customization uses, such as scene color, ground color, surface color, ink color, and accent color.

This keeps the normal setup simple while still giving technical owners an escape hatch.

The important product rule: TownSquare admin owns the easy path; the host website can still take control when the owner deliberately chooses to.

## Open question

Should the admin UI mention the owner CSS override, or should it live only in documentation so the main setup flow stays uncluttered?
