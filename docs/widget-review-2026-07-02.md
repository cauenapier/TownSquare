# Widget code review — refactoring & simplification opportunities

Deep review of the embeddable widget (`public/townsquare.mjs`, `public/widget/`,
`public/shared/`) performed 2026-07-02. This is a work order for a follow-up
agent: each item has a location, the evidence, and the intended change. Nothing
here has been applied yet.

Baseline at review time: `npm run lint` clean, `npm test` 49/49 pass.
Complements `docs/tech-debt.md` (items H2/H3/H5 there overlap; see §E for
which parts of H5 are already fixed).

**Validation for every change:** `npm run check && npm run lint && npm test`,
plus `npm run smoke` for anything touching the socket path. For visual changes
use the screenshot harness `scripts/widget-shots.mjs` (Playwright) to compare
before/after. Do the items one at a time — most are independent.

---

## A. Duplication to collapse (highest value per line)

### A1. Cluster solver duplicated in bubble-layout.mjs
`layoutBubbleColumns` and `layoutNameLabels` contain byte-identical copies of
the seed/merge cluster loop (`bubble-layout.mjs:317-334` vs `:443-459`), and
`placeCluster` (`:157-177`) vs `placeLabelCluster` (`:377-394`) differ only in
which "apply shift" function they call. Extract one
`solveClusters(columns, { minLeft, maxRight, gap, apply })` used by both.
~80 lines removed; the solver gets a single place to tune.

### A2. Presence field-copying duplicated in presence.mjs
`applySelfState` (`presence.mjs:115-143`) and `applyPeerState` (`:150-174`)
repeat the same 8 guarded field assignments (`displayName`, `color`,
`badgeColor`, `readingLabel`, `readingUrl`, `readingActive`, `isOwner`,
`plugins`) and the same render tail (renderAvatar / setAvatarProfile /
setFacing / updatePose / updatePropEffects / widgetPlugins.renderPresence).
`applyPresenceFields` (`:184-194`) already exists for a subset — extend it (or
add `assignPresenceState(presence, state)` + `renderPresence(ctx, presence,
previousX)`) and have both callers use it. Self keeps only its extra
settle-reset/targetX lines.

### A3. Pose-clearing logic exists in four places
- `dom.mjs:891-897` `clearPresencePose` (canonical)
- `movement.mjs:149-156` `clearSelfPoseForAction` — same body plus
  `resetPropSettle`; rewrite as `resetPropSettle(ctx); clearPresencePose(ctx.self, ctx.sceneProps)`
- `movement.mjs:256-259` — the same clearing inlined again inside `tick`
- `protocol.mjs:62-64` `clearPresencePoseForAction` — a pointless one-line
  wrapper; inline it at its three call sites

### A4. Modal scaffolding duplicated (connections vs message board)
`openConnectionsModal` (`connections.mjs:132-221`) and
`openMessageBoardModal` (`message-board.mjs:99-161`) build the identical
overlay/backdrop/panel/head/title/×-close structure, the identical
capture-phase Escape handler, and the identical close-restores-trigger-focus
teardown (`closeConnectionsModal:226-233` ≡ `closeMessageBoardModal:166-173`).
Extract a `widget/modal.mjs` helper, e.g.
`openWidgetModal(ctx, { className, ariaLabel, trigger })` returning
`{ overlay, panel, head, close() }`; each feature keeps only its own body
content. The CSS classes stay per-feature.

### A5. Mode/siteKey derivations recomputed all over
Compute once in `mountTownSquare` and store on ctx; delete the re-derivations:
- `siteKey` (`options.siteKey || root.dataset.townsquareSiteKey || ""`):
  `townsquare.mjs:189`, `townsquare.mjs:488`, `protocol.mjs:124`,
  `message-board.mjs:91` and `:158`, `connections.mjs:244` → `ctx.siteKey`.
- `preview/simulate` ("localOnly"): `chat.mjs:252`, `connections.mjs:140`,
  `movement.mjs:99`, `townsquare.mjs:205,221` → `ctx.localOnly` (and
  `ctx.watch`, `ctx.solo`, `ctx.preview` for the remaining `=== true` checks in
  `protocol.mjs:25-33` and `movement.mjs:277`). Update the `context.mjs`
  typedef accordingly.

### A6. Socket send boilerplate
13 sites do `socket.send(JSON.stringify({ type: MSG.X, ... }))`, 9 of them
behind the same `readyState === WebSocket.OPEN` guard (movement, chat,
page-watch, townsquare, protocol). Add one helper (in `widget/protocol.mjs`),
e.g. `sendToServer(ctx, type, payload)` that checks OPEN and stringifies, and
use it everywhere.

### A7. `applyLiveConfig` vs `updateConfig` in townsquare.mjs
`ctx.applyLiveConfig` (`townsquare.mjs:441-467`) and the handle's
`updateConfig` (`:483-505`) implement the same four per-field appliers
(scene→sanitize+refreshScene, style→applySiteStyle, connections→setupConnections,
messageBoard→setupMessageBoard). Differences: live config honours
`ctx.inlineConfig`, resolves `styleConfig[mode]`, and the handle path sends
`SCENE_CONFIG` for self-hosted embeds. Fold into one internal
`applyConfig(ctx, patch, { respectInline })` with those two deltas parameterized.

### A8. Mount-time scene setup duplicates `refreshScene`
`townsquare.mjs` builds `sceneProps`/`birdPerches` (`:209-210`), calls
`renderProps` (`:256`), and rebuilds `propsById`/`birdPerchesById` inside the
ctx literal (`:269-270`) — all of which `refreshScene` (`:152-167`) already
does. Restructure so the ctx starts with empty collections and mount calls
`refreshScene(ctx, sceneConfig)` once after ctx creation (before the avatar is
appended, so prop effects still resolve). One code path for "scene changed".

### A9. Ghost-stack / history maintenance duplicated in chat.mjs
- The drop-oldest-while-over-cap loop appears in `setExpandedView`
  (`chat.mjs:98-104`) and `sayMessage` (`:191-196`) → extract
  `capGhostStack(avatar, max)`.
- History trim + tray re-render + `--has-history` toggle appears in
  `setExpandedView` (`:105-109`) and `recordMessage` (`:164-167`) → extract
  `setHistory(avatar, entries)`.

### A10. Birds field special-cased with copy-paste in site-config.mjs
`readSceneConfigFromForm` (`site-config.mjs:41-64`), `applySceneConfigToForm`
(`:82-104`), `syncSceneCountProse` (`:125-151`), and `bindSceneCountProse`
(`:153-173`) each iterate `SCENE_FIELDS` and then repeat a near-identical block
for `SCENE_BIRDS_FIELD`. For the count/prose parts, iterate
`[...SCENE_FIELDS, SCENE_BIRDS_FIELD]` and skip the positions logic when the
field has no `positionsKey`.

### A11. Style-control lookup loop duplicated in site-config.mjs
`bindStyleColorFields` (`site-config.mjs:175-235`) and `syncStyleColorFields`
(`:274-291`) duplicate the mode×field hidden-input/control/picker/clear lookup.
Extract a `forEachStyleControl(form, fn)` iterator both use.

### A12. Bird upsert paths overlap (minor)
`upsertArrivingBird` (`birds.mjs:136-166`) and `upsertPerchedBird` (`:174-194`)
share the get-or-create-and-position skeleton; also `bird.perchId = perchId` at
`:151` is redundant on the update path (`setBirdPerch` just set it). Extract
`ensureBird(ctx, id, perchId)` and keep only the arriving-animation vs
perched-art difference in the callers.

---

## B. Structural splits (tech-debt H2/H3 + routing)

### B1. Split dom.mjs (995 lines) — tech-debt H2
Mechanical move-only split, keeping `dom.mjs` as a re-export barrel for one
release if that eases review:
- `widget/shell.mjs` — `renderShell`, `wireHelpPanel`, the icon/URL constants
  (`dom.mjs:78-301`).
- `widget/avatar.mjs` — `createAvatar`, `setAvatarProfile`, `setSendReady`,
  `createBubble`, `createTrayRow`, the `AvatarView`/`GhostMessage` typedefs.
  Inside `createAvatar` (~360 lines), extract `createProfileEditor(...)`
  (`:453-607`) and `createComposer(...)` (`:488-682`) as named subfunctions —
  the toolbar-mode branching becomes much easier to follow.
- `widget/gestures.mjs` — `setFacing`, `setWalking`, `playJump`,
  `clearRaisedHand`, `clearHighFiveState`, `playRaisedHand`, `playHighFive`,
  `needsStandUp`, `clearPresencePose`, `playHighFivePair`, `updatePose`
  (`:808-928`).
- `renderProps`, `renderAvatar`, `updatePropEffects` can join `gestures.mjs` or
  a small `scene-render.mjs`.
Update the ~6 importers (`townsquare.mjs`, `movement.mjs`, `protocol.mjs`,
`presence.mjs`, `chat.mjs`, `page-watch.mjs`) — also check `map*.mjs`,
`staging.html`, and `scripts/widget-shots.mjs` for direct imports.

### B2. Shrink mountTownSquare (~360 lines) — tech-debt H3
- Move the mobile-keyboard/visualViewport handling
  (`townsquare.mjs:86-131`, `:399-418`, plus the `onChange` rAF hook at
  `:353-358`) into `widget/keyboard-inset.mjs` exposing
  `wireKeyboardInset(ctx, expandController)` → dispose fn.
- Move `setQuiet` (`:362-379`) into its own function/module (it touches chat,
  expand, toggle ARIA, and composer state — a named `setQuiet(ctx, quiet)`
  next to presence code reads better than a closure).
- Replace the hand-synced teardown list in `destroy()` (`:506-534`) with a
  `disposers: Array<() => void>` collected as things are wired
  (`disposers.push(unwatchTheme, unwatchPage, ...)`); `destroy` becomes
  reverse-iterate + the socket close + `root.replaceChildren()`. This is what
  makes future wiring additions teardown-safe by construction.

### B3. Message routing if-chain → handler table
`protocol.mjs:136-321` routes with a ~15-branch if/else chain. Convert to
named handlers in a table keyed by `MSG.*`
(`const HANDLERS = { [MSG.HELLO]: handleHello, ... }`), with the solo/watch
gating inside each handler. The server already boot-asserts its handler keys
match the vocabulary; mirror that pattern client-side. The unknown-type
`console.warn` stays as the table-miss branch.

### B4. WS close reasons are magic strings shared with the server
`PERMANENT_CLOSE_MESSAGES` keys + the `"full"` special case
(`widget/protocol.mjs:39-48`, `:339`) must match string literals scattered in
`server.js` (`:964`, `:1016`, `:1493`, `:1516`, `:1628`, `:2789`, `:2792`,
`:3526-3546`). Same failure mode C1 (protocol constants) already fixed for
message types: a typo silently degrades into a generic reconnect loop. Add a
`CLOSE_REASON` map to `shared/protocol.mjs` and import it on both sides.

### B5. Keyboard shortcut boilerplate (minor)
`movement.mjs:321-331` repeats
`!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && key === "x"`
three times. Table-drive it (`{ j: triggerJump, h: triggerHighFive, t: openComposer }`)
behind one modifier guard.

---

## C. Lifecycle & correctness nits found during review

### C1. destroy()/removePeer leave timers running (residual part of tech-debt H5)
`townsquare.mjs destroy()` clears `reconnectTimer` and `typingTimer` only.
Not cleared: `ctx.cooldownHintTimer` (`chat.mjs:215`), the self avatar's
`jumpTimer`/`raisedHandTimer`/`highFiveTimer`/`awayTimer`
(set in `dom.mjs:829/860/873` and `:711`), per-bubble expire/fade timers
(`chat.mjs:198`, `:147`), and `self.walkTimer` (`protocol.mjs:52`).
`removePeer` (`presence.mjs:100-109`) clears only `walkTimer` + `awayTimer`.
Fired timers only touch detached DOM (harmless) but hold closures alive.
Fix: add `destroyAvatar(avatar)` that clears the four gesture/away timers and
every `messages[i].timer`; call it from `removePeer` and from `destroy()` for
self + all peers, and clear `cooldownHintTimer` in `destroy()`.

### C2. Reconnect re-seeds self chat history (duplicate tray rows)
Every reconnect `HELLO` appends `message.messages` into the persistent
`self.avatar` history (`protocol.mjs:170-173`). Peers don't duplicate because
`clearPeers` on close rebuilds their avatars, but self's avatar survives, so
after a disconnect/reconnect the hover tray shows the same lines twice
(bounded at the 5-row cap). Fix: reset self history before seeding, or dedupe
on `at` timestamp.

### C3. Full profile re-render on every MOVE frame
`applyPeerState` runs for every `MOVE` message (`protocol.mjs:256`) and always
calls `setAvatarProfile` (`presence.mjs:166`), which does ~20 DOM
reads/writes/class toggles (`dom.mjs:691-762`) — per peer, up to every 45 ms
while they walk. Same for self via `applySelfState`. Split position updates
(renderAvatar/setFacing/updatePose/updatePropEffects) from profile updates
(setAvatarProfile only when a profile-ish field actually changed), or make
`setAvatarProfile` early-return on unchanged input. Pairs naturally with A2.

### C4. Expand Escape guard misses non-input editors
`expand.mjs:48` ignores Escape only when `event.target instanceof
HTMLInputElement`. `movement.mjs:139-144` already has the fuller
`isTypingTarget` (textarea/select/contenteditable) — export it (utils) and use
it here.

### C5. Unguarded setPointerCapture
`movement.mjs:399` — `setPointerCapture` throws `InvalidStateError` if the
touch pointer is already gone (can happen when the browser takes over the
gesture mid-move). Wrap in try/catch like the release path already guards with
`hasPointerCapture`.

### C6. Counter comment contradicts behavior
`townsquare-counter.mjs:273-274` says "Pause polling while the tab is hidden",
but the `setInterval` keeps fetching regardless; only the "refresh on return"
half exists. Either gate `fetchCount` on `document.visibilityState` or fix the
comment.

### C7. Doc/typedef drift (fix while touching the files)
- `context.mjs:105` — `inlineConfig` typedef omits `style`;
  `:106` `applyLiveConfig` typedef omits `styleConfig`.
- `birds.mjs:129-134` — `upsertArrivingBird` JSDoc documents an `x` param that
  no longer exists (also `:169-173` for `upsertPerchedBird`).
- `chat.mjs:153` — "the latter latter" typo.
- `utils.mjs` `sanitizeStylePalette` doc in `site-config-core.mjs:513` says
  "the 7 style tokens"; `STYLE_FIELDS` has 9.

---

## D. Per-frame efficiency (low priority, do opportunistically)

### D1. Redundant per-frame allocations in the game loop
Each `tick` (`movement.mjs:277-282`) allocates the presences array, an object
from `layoutConfigFor`, and then `layoutBubbleColumns`/`layoutNameLabels`
*re-spread* the already-merged config (`bubble-layout.mjs:283`, `:414`). Have
the layout functions accept the merged config as-is (they're only called with
`layoutConfigFor` output or undefined), and cache the merged config, refreshing
only when `ctx.options.layout` identity or `ctx.expanded` changes.

### D2. updatePropEffects linear scans
`dom.mjs:936-950` does `find` + 2×`some` over all props per avatar per frame /
per state message. Fine at the current prop cap (≤16); if scenes grow,
precompute shade/light intervals in `refreshScene`. Note only — no action now.

---

## E. Corrections to docs/tech-debt.md (H5 is partially stale)

H5 bundles four claims; two are already fixed on main:
- ~~module-level `chat.mjs` state makes double-mount unsafe~~ → fixed: per-mount
  `createChatScope` (`chat.mjs:39`), threaded through every avatar.
- ~~unrestored `history.pushState` patch~~ → fixed: refcounted
  install/uninstall that restores only-if-ours (`page-watch.mjs:28-65`).
- Reconnect "socket listener leak": largely obsolete — each closed socket is
  dropped and its listeners GC with it; `destroy()` clears `reconnectTimer` and
  closes the live socket. No action needed.
- **Still real:** the timer leaks — tracked here as **C1**.

Suggested edit: mark H5 🟡 with a pointer to this file's C1/C2.

---

## F. Security (follow-up pass, same day)

Reviewed: every client-side injection surface (peer-supplied data → DOM), the
server sanitizers behind them, WS input hardening, and the unauthenticated
HTTP endpoints the widget/counter call. The trust chain is in good shape —
findings are edge hardening, not holes. What's already solid is listed at the
end of this file.

### F1. Beacon endpoints have no rate limit (analytics poisoning)
`/api/connection-click` (`server.js:2540`) and `/api/map-click` (`:2586`) are
unauthenticated POSTs with no per-IP budget: anyone with a siteKey (it's in
the public embed snippet) can inflate a site's click tallies with a curl loop.
Memory stays bounded (the URL must match a configured connection; map clicks
are a single counter) and the sites.json write is already debounced, so this
is integrity-of-analytics only. Fix: route both through the existing
`makeBucketStore` per-IP budget exactly as `/api/event` was in H9
(`server.js:890-892,1152` shows the pattern).

### F2. `/api/site-presence` has no rate limit or cache
`handleSitePresence` (`server.js:1295`) iterates the scene's clients on every
unauthenticated GET. Legit traffic is one poll per counter embed per 20s, so
a hostile tight loop stands out. Cheap fix: same per-IP bucket, or memoize
`countActiveVisitors` per scene for ~2s (also helps many-counters-one-site).

### F3. PoW solver: no difficulty clamp, no cancellation
The `CHALLENGE` handler (`widget/protocol.mjs:150-158`) forwards any
`difficulty` number to `solveChallenge`, and the worker
(`pow.mjs:140-153`) terminates only on solve/error — `destroy()` never
reaches it. Consequences: (a) a hostile/compromised `serverOrigin` (the host
page picks it, but embeds shouldn't inherit its worst case) can demand
unbounded CPU from every visitor; (b) unmounting the widget mid-challenge
leaves a worker burning CPU until it solves. Fix: clamp difficulty client-side
(≤ ~24 bits is generous; the server's real values are far lower), have
`solveChallenge` return a handle with `cancel()` that terminates the worker /
flags the inline loop, store it on ctx, and cancel in `destroy()` and on
socket close.

### F4. `SAFE_COLOR_RE` admits `url(...)`-shaped tokens (hardening only)
`site-config-core.mjs:9` — `/^[#(),.%\sA-Za-z0-9-]+$/` blocks `:`, `/`, `;`
and quotes, so no external URL or declaration breakout is possible, but
`url(name.png)` passes and would resolve same-directory-relative. Only site
owners set palettes, on their own pages, so impact is nil today; if tightening,
reject values containing `url(` case-insensitively.

---

## G. Performance (follow-up pass, same day)

Complements D1/D2 and C3 (per-frame allocations, prop scans, MOVE-triggered
profile re-renders) already logged above. Server-side hot paths checked out:
`broadcast` serializes once per message (`server.js:2042`), WS payload capped
at 512 B, per-type input throttles (move 40 ms, action 560 ms, chat per-site),
registry writes debounced.

### G1. Layout thrash in the frame loop (biggest win)
`layoutBubbleColumns` and `layoutNameLabels` interleave DOM reads
(`tray.offsetWidth` `bubble-layout.mjs:93`, `above.offsetWidth` `:302`,
`live.el.offsetWidth` `:260`, `below.offsetWidth` `:432`) with CSS-var writes
(`setProperty` in `placeTray`/`setShiftVars`/`setLabelFade`) — per avatar, per
frame, across two passes. Each read after a write forces a reflow, so a busy
scene can pay O(avatars) reflows per frame. Restructure each `tick` to one
measure phase (collect all widths for both passes) then one write phase.
Verify with the Performance panel (long purple "Layout" slices under the rAF
tick) before/after, and `scripts/widget-shots.mjs` for pixel parity.

### G2. Game loop runs while the widget is offscreen
Blog embeds often sit below the fold, but `startGameLoop`
(`movement.mjs:290`) runs the rAF tick — with the G1 layout work — whenever
the tab is visible, even when the mount is scrolled out of view (rAF pauses
for hidden tabs, not offscreen elements). Add an IntersectionObserver on
`ctx.app` that stops/starts the loop (or skips the layout half); also skip the
two layout passes when `above`/`below` are all empty. Battery/CPU win for the
primary deployment shape.

### G3. Avatars animate via `style.left` (layout property)
`renderAvatar` (`dom.mjs:800-802`) writes `left: N%` every frame while
walking, forcing layout+paint; `transform: translateX()` would stay on the
compositor. Not mechanical: widget.css centers/flips figures with transforms
already, so this needs CSS coordination and a before/after profile. Do it
only if G1+G2 leave walking janky on low-end devices; file it as "measure
first".

### G4. Counter: polls hidden tabs, and a hung fetch stalls polling forever
`townsquare-counter.mjs` — the `setInterval` keeps fetching while the tab is
hidden (the comment at `:273` claims otherwise — same as C6), and `fetchCount`
(`:251-271`) early-returns while `inFlight` is set with no timeout, so one
network request that never settles stops all future polls. Gate on
`document.visibilityState === "visible"` and abort the in-flight controller
after ~10s.

---

## Reviewed and deliberately left alone

- `pow.mjs` — worker built by stringifying the same hashing functions (single
  source of truth), CSP fallback to the yielding inline loop. Solid.
- `bubble-layout.mjs` algorithm (post-A1 dedup) — the 1D cluster solver and
  the tail-reach clamping are well-documented and correct.
- `plugins.mjs` — origin check, dispose-race guards, per-plugin error
  isolation all present.
- `widget.css` (2151 lines) — single file is a deliberate embed constraint
  (one stylesheet request); it is well-sectioned with comments. Don't split.
- `page-watch.mjs`, `utils.mjs` storage try/catch discipline, `expand.mjs`
  scroll-lock save/restore — all sound.

Security surfaces verified solid (no action):
- **Peer-supplied URLs**: `readingUrl` is the one peer-controlled `href` in the
  DOM (`dom.mjs:749`); the server parses it, allows only http(s), caps length,
  *and* restricts it to the site's allowed origins
  (`server.js:481-530` `sanitizeReadingUrl`/`readingUrlAllowedForClient`) — a
  peer cannot plant an off-site or `javascript:` link on their nameplate.
- **Peer colors**: `color`/`badgeColor` land in `style.color` / a CSS var, but
  the server allow-lists both against fixed sets (`server.js:534-540`);
  display names get owner-badge-lookalike stripping + caps (`:470-479`).
- **innerHTML sinks**: all static, trusted markup (figure rig, prop/bird/cloud
  SVG constants, icons). Every dynamic string (chat, tray, labels, message
  board body, modal titles, hostnames) goes through `textContent`.
- **Server-pushed config**: the client re-sanitizes everything from `hello`
  (`sanitizeSceneConfig`, `sanitizeConnections`, `sanitizeMessageBoard`,
  `sanitizeStylePalette`) — defense in depth against a compromised server.
- **Plugin loading**: modules restricted to the TownSquare server origin +
  leading-`/` paths (`plugins.mjs:32-35,104-112`).
- **WS input hardening**: 512 B `maxPayload`, per-type throttles, scene
  capacity → `"full"`, IP quarantine + per-site IP blocks checked *before*
  identity creation, PoW gate. External links use
  `rel="noopener"`/`noreferrer`.

---

## Suggested sequencing for the implementing agent

1. **Mechanical dedups, no behavior change:** A3, A5, A6, A9, A12, C7
   (each a small commit; lint + tests between).
2. **Solver/state dedups:** A1, A2 (+C3 while in presence.mjs), A4.
3. **Lifecycle + security fixes:** C1, C2, C4, C5, F3 (PoW clamp/cancel),
   G4 — these are the behavior *fixes*. Server-side: F1/F2 (reuse
   `server/rate-limit.js`, mirror the H9 change; add smoke assertions).
4. **Config unification:** A7 + A8 together (they share `refreshScene`).
5. **Structural splits (biggest churn):** B1, then B2, then B3/B4.
6. **Performance, measured:** G1 (profile before/after), then G2; G3 only if
   still needed. D1 rides along with G1.
7. **When idle:** A10, A11, B5, C6, F4, D2.

After each step: `npm run check && npm run lint && npm test`; after steps 3-5
also `npm run smoke`; after anything visual, `scripts/widget-shots.mjs`
before/after screenshots. Update `docs/tech-debt.md` rows H2/H3/H5 as they
land, and log progress in this file.
