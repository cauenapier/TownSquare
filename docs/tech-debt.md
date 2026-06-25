# TownSquare — Technical Debt Tracker

Generated from a 4-agent codebase audit on 2026-06-25. Tracks known technical
debt and remediation status. Update the **Status** column as items land.

Status legend: 🔴 not started · 🟡 in progress · ✅ done · ⏭️ deferred/won't-fix

---

## 🔴 TOP PRIORITY (fix first)

| # | Item | Location | Status |
|---|------|----------|--------|
| T1 | One unguarded throw kills every connection — no `try/catch` around request dispatch / `handleClientMessage`, no `process.on('uncaughtException'/'unhandledRejection')`, no SIGTERM drain | `server.js:2536`, `server.js:3091` | ✅ |
| T2 | No CI; security-sensitive core (router, registration, admin-token hashing/auth, WS identity/presence, IP limits) has zero unit tests. `node --test` covers only the plugin manager | no `.github/`; `server.js` | ✅ |
| T3 | Synchronous full-registry `saveSites()` (`fs.writeFileSync` of entire sites array) on the WS/admin hot path blocks the event loop | `server.js:2255-2270` | ✅ |
| T4 | Admin token transported in URL (`?adminToken=`/`#adminToken=`) and persisted to `localStorage` for 30 days | `hosted/hosted-admin-session.mjs:55-67`, `hosted-common.mjs:162-195` | ✅ |
| T5 | Plugin registration runs at module top-level with no `try/catch` — one malformed plugin crashes boot (crash-loop under `Restart=always`) | `server.js:11`, `server/plugins.js:25-68` | ✅ |

## 🟠 HIGH PRIORITY

### Structure / monolith
| # | Item | Location | Status |
|---|------|----------|--------|
| H1 | `server.js` is a ~3,200-line god file mixing 8+ responsibilities; `server/` exists as intended home. Extract static/sites-store/rate-limit/scene/ws-handlers/admin-routes | `server.js` | 🔴 |
| H2 | `dom.mjs` is 968 lines; `createAvatar` ~360 lines bundling DOM + profile form + animations | `public/widget/dom.mjs:317-676` | 🔴 |
| H3 | `mountTownSquare` is a ~290-line god function; teardown correctness depends on hand-synced lists | `public/townsquare.mjs:154-442` | 🔴 |
| H4 | `site-config.mjs` (1,048 lines) fuses pure server sanitizers with browser-only DOM code (76 `document`/`FormData`/rAF refs); forces server to keep divergent stub sanitizers swapped in async at boot | `shared/site-config.mjs`, `server.js:188-193` | 🔴 |

### Reliability / leaks
| # | Item | Location | Status |
|---|------|----------|--------|
| H5 | Replaced WebSockets leak on reconnect — old socket listeners not removed/closed; `destroy()` only closes latest. Double-mount unsafe (module-level `chat.mjs` state; unrestored `history.pushState` patch) | `protocol.mjs:97`, `townsquare.mjs:438`, `chat.mjs:31-32`, `page-watch.mjs:65-98` | 🔴 |
| H6 | Unbounded in-memory growth — per-IP-per-scene activity map and scenes never bounded (leak + rate-limit-state amplification) | `server.js:968-1010` | 🔴 |
| H7 | Leave timers fire against deleted scenes — not cleared on site/scene deletion or shutdown | `server.js:3050-3053` | 🔴 |

### Security
| # | Item | Location | Status |
|---|------|----------|--------|
| H8 | Path-traversal guard uses fragile `startsWith(PUBLIC_DIR)` (sibling `publicEVIL` passes) | `server.js:770-782` | 🔴 |
| H9 | Unauthenticated Plausible event proxy with attacker-influenced `x-forwarded-for`; no rate limit on `/api/event` | `server.js:728-749` | 🔴 |
| H10 | `innerHTML` XSS footguns on admin data + `<a href>` built from server data; `escapeHtml` doesn't strip `javascript:`. No CSP / `X-Frame-Options` on admin pages | `hosted/hosted-admin.mjs:677,693,827,848,855,894` | 🔴 |
| H11 | Identity secret mismatch silently forks an ephemeral identity instead of rejecting — bypasses IP identity caps, orphans identities | `server.js:1930-1946` | 🔴 |

### Infra
| # | Item | Location | Status |
|---|------|----------|--------|
| H12 | Dockerfile omits `server/` and `plugins/` (required by `server.js:6-8`) → `MODULE_NOT_FOUND`. No `HEALTHCHECK` despite `/healthz` | `Dockerfile:8-9` | 🔴 |
| H13 | Orphaned plugin smoke-test fixture — nothing loads `server/fixtures/feature-plugin.js`; `npm run smoke:plugins` can't pass on clean checkout | `scripts/plugin-smoke-test.js`, `server/fixtures/feature-plugin.js` | ✅ |

## Cross-cutting themes
| # | Item | Location | Status |
|---|------|----------|--------|
| C1 | Protocol contract duplicated as inline string literals on both sides; no shared module; unknown types dropped silently. Same for admin action-name strings and forked sanitizers/`parseBlockedWords` | `protocol.mjs`, `movement.mjs`, `chat.mjs` vs `server.js` | 🔴 |
| C2 | No linter/formatter/type-check; manual-discipline safety everywhere (teardown lists, `escapeHtml` wrapping, hand-rolled `.env` parser, scattered magic numbers) | repo-wide; `server.js:140` | 🔴 |

## Confirmed solid (no action)
- Secrets hygiene clean (only `*.example` committed; `.data`/live env untracked; admin tokens salted-hashed, timing-safe compare).
- Plugin **runtime** error isolation (per-hook try/catch, async `.catch`, 64KB cap, deep-freeze).
- Deploy script (atomic symlink flip, health-check retry, isolated git index snapshot).
- nginx/systemd hardening; `public/map*.mjs` modules.

---

## Remediation log

Sequence: T2 (tests+CI) and T1 (crash safety) first — they make later refactors
safe — then T5/T4 (boot-crash + auth), T3, then the structural splits (H1, H4).

| Date | Item(s) | Notes |
|------|---------|-------|
| 2026-06-25 | — | Audit complete; tracker created on branch `worktree-tech-debt-cleanup` |
| 2026-06-25 | T1 ✅ | Wrapped HTTP dispatch (`handleHttpRequest`) and WS `handleClientMessage` in try/catch (faulty handler closes only its own socket); added `uncaughtException`/`unhandledRejection` logging guards, a `server.on("error")` fatal-bind handler, and a SIGTERM/SIGINT drain that flushes pending saves and closes sockets cleanly. Verified via SIGTERM test. |
| 2026-06-25 | T3 ✅ | Debounced hot-path registry writes: `touchSite` now schedules a coalesced save (`scheduleSitesSave`, 1s) instead of a synchronous full-file `writeFileSync`. Critical writes (registration, deletion, migration) stay durable/synchronous. Added `flushSites()` used by the shutdown drain. |
| 2026-06-25 | T5 ✅ | Per-plugin registration isolation in `plugins/index.js` (one bad plugin is logged and skipped, not fatal) + defense-in-depth try/catch around the top-level `registerPublicPlugins()` call. |
| 2026-06-25 | T2 🟡 | Added `.github/workflows/ci.yml` running `npm ci` + `npm run check` + `npm test` on push/PR (closes the "no CI" gap). Extracted admin-token helpers into `server/auth-tokens.js` with 7 unit tests. **Remaining:** extract more pure helpers (input sanitizers, origin/config validation, identity) from `server.js` into testable modules; make `scripts/smoke-test.js` self-contained (it currently needs an already-running server + specific env, and fails identically on `main`). |
| 2026-06-25 | T4 ✅ | Replaced token-in-body/`localStorage` admin auth with HttpOnly session cookies. New `server/admin-sessions.js` (in-memory, expiry + capacity bounded, clock/RNG-injectable, 9 unit tests). `/api/admin/login` mints an `HttpOnly; SameSite=Strict; Path=/api/admin` cookie (12h, or 30d with remember-me); `/api/admin/site` + `/api/admin/action` authenticate via cookie (token still accepted as one-time bootstrap, which upgrades to a cookie). Added `/api/admin/logout`; sessions are revoked on token-reset and site-delete. Client (`hosted-admin-session.mjs`) no longer persists the raw token — only the non-secret siteKey. Verified end-to-end: cookie-only auth, cross-site rejection, expiry, logout + reset revocation. |
| 2026-06-25 | T2 ✅ | Finished: extracted pure input sanitizers into `server/sanitize.js` (5 unit tests). Made both smoke tests self-contained — they now spawn their own server on an OS-assigned free port with an isolated temp data dir (fixing the long-standing "tests the wrong server on :8787" problem), and run in CI. Added `TOWNSQUARE_EXTRA_PLUGINS` plugin-injection hook so the plugin smoke test loads the `test-feature` fixture (resolves **H13**). Total unit tests now 30 (was 10); full pipeline (`check` + `test` + `smoke` + `smoke:plugins`) green. |
| 2026-06-25 | H13 ✅ | Plugin smoke fixture is now loadable via `TOWNSQUARE_EXTRA_PLUGINS`; `npm run smoke:plugins` passes on a clean checkout and gates in CI. Documented in `docs/plugins.md`. |

**Validation:** `npm run check` clean, `npm test` 10/10 pass, server boots and `/healthz` ok, SIGTERM exits cleanly. Full `scripts/smoke-test.js` reaches a pre-existing env-coupled failure (401 on a WS-auth subtest) that reproduces identically on `main` — not introduced by these changes.
