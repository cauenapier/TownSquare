# TownSquare — Code Review Findings (temporary)

> Generated 2026-06-18. Each finding below is scoped to be fixable independently by a
> separate agent. Delete this file once the findings are resolved.
> Tag legend: 🔴 risk · 🟠 should fix · 🟡 cleanup · 🟢 optional.

---

## TASK 1 — 🔴 Make `saveSites()` an atomic write — ✅ DONE (2026-06-18)

Resolved: `saveSites()` writes to `sites.json.tmp` then `fs.renameSync`'s it over
`SITES_FILE` (atomic same-filesystem rename), kept synchronous. `node --check` and
`npm run smoke` pass.

---

## TASK 2 — 🟠 Fix the `check` script to validate the whole codebase

**File:** `package.json` (`scripts.check`)

**Problem:** The current glob only covers `public/*.mjs` and `public/widget/*.mjs`.
It silently skips `public/shared/`, `public/hosted/`, `public/dev/`, and
`public/lib/` — including the shared config loaded by both client and server and
the entire hosted admin surface. These are never syntax-checked.

**Fix:** Replace the loop glob so it checks every `.mjs` under `public/`
recursively (e.g. `find public -name '*.mjs'`) in addition to `node --check server.js`.

**Acceptance:** `npm run check` runs `node --check` against `server.js` and every
`.mjs` file under `public/` (verify by temporarily breaking syntax in a
`public/hosted/*.mjs` file and confirming the check fails).

---

## TASK 3 — 🟠 Remove 4 dead exports

All four are exported but imported nowhere (verified across `.mjs`, `.js`, `.html`).

| Export | Location |
|---|---|
| `BIRD_PERCHES_BY_ID` | `public/shared/bird-perches.mjs:24` |
| `getSceneCountNoun` | `public/shared/site-config.mjs:544` |
| `renderDefinitionList` | `public/hosted/hosted-common.mjs:215` |
| `setValueIfIdle` | `public/hosted/hosted-common.mjs:148` |

**Fix:** Delete each export (and any now-unreferenced helpers/JSDoc they pull in).

**Acceptance:** Re-run a repo-wide grep for each name to confirm zero remaining
references after deletion. `npm run check` passes.

---

## TASK 4 — 🟡 De-duplicate `normalizeOrigin` across the CJS/ESM boundary

**Files:** `server.js` (~line 164) and `public/widget/utils.mjs`

**Problem:** Both define their own `normalizeOrigin`. This one is
security-relevant — it backs the WebSocket origin allowlist — so two
implementations that must stay behaviorally identical are a drift risk.
(`isPlainObject` and `randomSpawnX` are also duplicated; `randomSpawnX` is already
exported from `shared-constants.mjs` yet re-defined in `server.js:272`.)

**Fix:** Promote `normalizeOrigin` into `public/shared/` and import it in both the
server (via the existing dynamic-import bootstrap in `loadSharedModules`) and the
client. While there, have `server.js` consume the shared `randomSpawnX` instead of
its local copy.

**Caution:** The server is CommonJS and loads shared ESM modules via dynamic
`import()`. Confirm any newly shared module is browser/Node-agnostic (no
Node-only or DOM-only APIs), consistent with the other files in `public/shared/`.

**Acceptance:** Single source of truth for `normalizeOrigin`; origin allowlist
behavior unchanged; `npm run smoke` passes.

---

## TASK 5 — 🟡 Collapse repeated payload shapes in `server.js`

**File:** `server.js`

**Problem:**
- The `"reading"` broadcast object is built almost identically in three places
  (~lines 1730, 1852, 1966).
- The identity payload (`id, x, pose, propId, displayName, color, reading*…`) is
  hand-assembled in `snapshotIdentity`, `emitIdentityState`, and `getSceneStats`.

**Fix:** Extract a `broadcastReading(scene, identity, opts)` helper and a single
identity-serializer used by the three call sites. Removes ~30 lines and the risk of
the shapes drifting when a field is added.

**Acceptance:** Wire protocol output is byte-identical to before (compare
broadcast payloads); `npm run smoke` passes.

---

## TASK 6 — 🟢 Add a clarifying comment in `handleInit`

**File:** `server.js` (`handleInit`, ~line 1664)

**Problem:** The interplay between `client.joined` and `identity.joined` (the
reconnect early-return branch vs. the fresh-join branch) is correct but subtle and
took re-reading to confirm.

**Fix:** Add a one-line comment at the `if (identity.joined)` branch explaining
that this distinguishes a reconnecting identity (already joined) from a brand-new
join. No behavior change.

---

## Verified OK — no action needed (do not "fix")

- Listener balance in `connections.mjs` (4 add / 1 remove) and the inline
  `quietButton`/`expandButton` clicks in `townsquare.mjs`: not leaks — those
  listeners ride on DOM nodes that teardown / `root.replaceChildren()` detach, so
  they are GC'd.
- `site-config.mjs` at ~1056 lines is large but cohesive (field defs + CSS builder
  shared by both runtimes); leaving it intact is defensible.
