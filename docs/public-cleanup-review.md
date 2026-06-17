# `public/` cleanup & simplification review

> **Status (2026-06-17):** P1–P4 below are **implemented**, with one deliberate
> deviation on 3.3 (see that section). New shared modules: `public/ui-common.mjs`,
> `public/hosted-common.mjs`, `public/widget/math.mjs`, `public/widget/expand.mjs`.
> This document is kept as the rationale record.

A review of the browser-side codebase under `public/` (widget runtime, hosted
admin/registration shells, dev tooling, and styles). The goal is open-source
hygiene: less duplication, fewer magic numbers, and consistent patterns.

**Overall the code is in good shape** — clear module boundaries, strong JSDoc,
and thoughtful comments throughout. The findings below are mostly about
duplication that crept in while moving fast, plus a few small correctness/
consistency nits. Nothing here is urgent; the priorities reflect value-for-effort.

Source of truth is the code — line numbers are accurate as of this review and
may drift.

---

## Priority 1 — Duplication worth collapsing

### 1.1 Two admin runtimes are ~70% the same code
`public/hosted-admin.mjs` (292 lines) and `public/service-admin.mjs` (257 lines)
independently reimplement the same scaffolding:

- `setLoginStatus` / `setStatus` (identical)
- `escapeHtml` (byte-for-byte identical — `hosted-admin.mjs:121`, `service-admin.mjs:80`)
- `formatTime` (near-identical; differs only in the empty fallback string)
- `api()` POST-JSON wrapper (identical apart from how `password` vs `siteKey`/
  `adminToken` is injected)
- `showLogin` / `showAdmin` / `startAutoRefresh` / `stopAutoRefresh` (identical
  structure, same `REFRESH_INTERVAL_MS = 5000`)
- the copy-to-clipboard button handler (see 1.2)

**Recommendation:** extract a small `public/admin-common.mjs` exposing
`escapeHtml`, `formatTime`, `createApi(injectAuth)`, the status helpers, and a
`createAutoRefresh(loadFn)` controller. Each page keeps only its
page-specific render/action wiring. Estimated ~150 lines removed.

**Why:** these two files drift independently today (e.g. `formatTime` already
diverged), and "every line is a liability." Per `AGENTS.md` principles.

### 1.2 Clipboard "copy → show Copied → revert" is implemented 4 times
Same pattern in four files:
- `hosted-register.mjs:17` (`bindCopy`, the cleanest version)
- `hosted-admin.mjs:265`
- `service-admin.mjs:238`
- `dev-scene.mjs:399`

All do: `navigator.clipboard.writeText(...)` → set button text to "Copied" →
`setTimeout(restore, 1200)` → on failure, focus+select the source. The `1200`ms
and the fallback are copy-pasted.

**Recommendation:** promote `hosted-register.mjs`'s `bindCopy(button, source)`
into the shared admin/util module and reuse it everywhere (dev-scene copies from
a readout rather than an input, so the helper should accept a `() => string`
text getter).

### 1.3 Expanded-view controller duplicated between widget and dev scene
The `setExpanded` closure in `townsquare.mjs:177-192` and
`dev-scene.mjs:231-246` are line-for-line equivalent: same body-overflow lock,
same four `expandButton` attribute/class toggles, same `setExpandedView(...)`
call. The Escape-to-collapse handler is also duplicated
(`townsquare.mjs:220-225` vs `dev-scene.mjs:250-254`).

**Recommendation:** factor a `createExpandController({ app, expandButton,
getAvatars })` helper (likely in `widget/`) returning `{ setExpanded, destroy }`.
The dev scene exists specifically to mirror real widget behavior, so sharing this
keeps them honest.

---

## Priority 2 — Single-source values & helpers

### 2.1 String normalization reimplemented inline in `dom.mjs`
`setAvatarProfile` (`widget/dom.mjs:554-562`) inlines
`...trim().replace(/\s+/g, " ").slice(0, DISPLAY_NAME_MAX)` for both displayName
and readingLabel — exactly what `normalizeDisplayName` / `normalizeReadingLabel`
already do in `widget/utils.mjs:75-87`.

**Recommendation:** import and call the `utils.mjs` normalizers from `dom.mjs`.
One definition of "what a valid display name is."

### 2.2 `clamp` defined three times
- `widget/bubble-layout.mjs:91`
- `dev-scene.mjs:63`
- `widget/movement.mjs:26` (`clampSelfX`, a specialization)

**Recommendation:** a tiny `widget/math.mjs` (or add to `utils.mjs`) with
`clamp(value, min, max)`. `clampSelfX` becomes `clamp(x, MIN_X, MAX_X)`.

### 2.3 Seeded/real spawn-X duplicates `randomSpawnX`
`dev-scene.mjs:90` computes `MIN_X + random() * (MAX_X - MIN_X)` — the body of
`randomSpawnX` (`shared-constants.mjs:28`) but with a seeded RNG.

**Recommendation:** make `randomSpawnX(rng = Math.random)` take an optional RNG
so the dev scene can pass its seeded generator instead of reinventing the range.

### 2.4 Animation durations split between JS and hard-coded literals
Some timings live in `widget/constants.mjs` (`HIGH_FIVE_MS`, `RAISED_HAND_MS`,
`BUBBLE_TTL_MS`), but others are bare literals that must stay in sync across files:
- jump animation length `560` appears in `widget/dom.mjs:667` (the `playJump`
  timeout) **and** as `JUMP_COOLDOWN_MS = 560` in `widget/movement.mjs:88`.
- `FADE_MS = 320` in `chat.mjs:26`, `WALK_BUMP_MS` in `protocol.mjs`,
  `HIGH_FIVE_COOLDOWN_MS` in `movement.mjs` — each defined locally.

These also shadow durations defined in `widget.css` (jump/high-five keyframes).

**Recommendation:** collect avatar-animation durations next to the existing ones
in `constants.mjs` and reference them from both `dom.mjs` and `movement.mjs`, so
the jump timing has one home. Where a value mirrors a CSS keyframe, add a short
comment pointing at the CSS rule (the figure rig already does this in
`figure.mjs`).

---

## Priority 3 — Correctness & consistency nits

### 3.1 `setShiftVars` called with the wrong arity (latent bug)
`widget/bubble-layout.mjs:186` is `setShiftVars(avatar, shift, tailShift, tailTip)`
(4 params), but the empty-column reset at line 271 calls
`setShiftVars(avatar, 0, 0)` — `tailTip` is `undefined`. The guard then evaluates
`Math.abs((avatar.tailTip ?? 0) - undefined)` → `NaN`, which is never `>
SHIFT_EPSILON`, so `--tail-tip` is **never reset to 0** when a column empties. The
JSDoc above the function also only documents three params.

**Recommendation:** call `setShiftVars(avatar, 0, 0, 0)` and update the JSDoc to
include `tailTip`. Low impact visually, but it's an inconsistency that will
mislead the next reader.

### 3.2 `presenceById` helper exists but isn't used everywhere
`widget/protocol.mjs:63` defines `presenceById(ctx, id)`, yet `applyJump`
(line 57) inlines the identical `id === ctx.self.id ? ctx.self : ctx.peers.get(id)`.

**Recommendation:** route `applyJump` through `presenceById` for consistency.

### 3.3 Mixed DOM-construction styles in admin pages
The admin renderers mix `innerHTML` + manual `escapeHtml` (e.g.
`hosted-admin.mjs:133`, `:165`; `service-admin.mjs:102`) with `createElement`/
`textContent` in the same function. The widget side (`dom.mjs`, `presence.mjs`)
is consistently `createElement`/`textContent` and never needs an escaper.

**Recommendation:** for an open-source repo, prefer the `createElement` +
`textContent` style throughout the admin pages too. It removes the manual-escaping
footgun entirely (no `escapeHtml` to forget) and matches the widget code. If kept
as-is, at least consolidate `escapeHtml` per 1.1.

**Done (partial):** `escapeHtml` is now single-sourced in `hosted-common.mjs`
(the "at least" path). The fuller `createElement` conversion of the admin render
functions was **deliberately deferred** — it's a larger, higher-risk rewrite of
working markup with no behavior change, better done on its own if/when those
render paths are next touched.

---

## Priority 4 — Documentation polish (low effort)

### 4.1 `docs/architecture.md` module list is stale
It enumerates `widget/` as "DOM, chat, presence, protocol, movement"
(`architecture.md:38`) but the directory now also has `bubble-layout`, `birds`,
`page-watch`, `utils`, `context`, `figure`, and `constants`. Worth a one-line
refresh so the doc stays a faithful map.

### 4.2 No `public/README.md`
The top-level `README.md` covers the product; there's no short orientation for a
contributor opening `public/`. A ~20-line `public/README.md` (or a section in the
architecture doc) listing "widget runtime vs. host pages vs. dev tooling" and the
shared-module rule (`shared-constants.mjs` / `scene-props.mjs` are loaded by the
CommonJS server too — do not add browser-only imports) would lower the on-ramp.
Keep it pointer-style per `AGENTS.md` ("point to source code for specifics").

---

## Explicitly *not* flagged (already good)

- Module separation under `widget/` is clean and the `WidgetContext` typedef
  (`context.mjs`) is a nice way to avoid closure spaghetti.
- JSDoc coverage and the "why" comments (bubble-layout solver, ghost stack,
  prop settle) are genuinely helpful — keep that bar.
- `shared-constants.mjs` / `scene-props.mjs` / `bird-perches.mjs` single-sourcing
  across server and client is the right call.
- CSS files are large (`widget.css` ~1450 lines, `page.css` ~1129) but
  well-sectioned with comments; not worth splitting unless they keep growing.

---

## Suggested order of work

1. **1.1 + 1.2** — shared `admin-common.mjs` (biggest line reduction, stops drift).
2. **1.3** — shared expand controller (keeps dev scene faithful to the widget).
3. **2.1 + 2.2 + 2.3** — collapse normalize/clamp/spawn duplication (small, safe).
4. **3.1** — fix the `setShiftVars` arity (quick correctness win).
5. **2.4 + 3.2 + 3.3** — magic-number homes and style consistency.
6. **4.x** — doc refresh once the above lands.

Each item is independently shippable; none requires touching the server or the
wire protocol.
