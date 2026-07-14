# Anti-bot direction

TownSquare should remain easy to observe and use while making scripted public
abuse expensive and low-yield. This is a decision record for remaining work, not
an implementation specification.

## Current controls

The current implementation is discoverable in `server.js`, `.env.example`, the
Nginx examples, and `scripts/bot-replay-test.js`:

- hosted-scene origin validation;
- per-IP/per-site identity, join, state-action, and chat budgets;
- temporary quarantine after synchronized actions across identities;
- per-scene connection limits and optional reverse-proxy join limits;
- optional per-site proof-of-work before joining;
- a minimum human chat delay after joining;
- a global Telegram notification budget;
- browser identity secrets, persisted site blocks, mutes, and hidden visitors.

These controls stop unsophisticated replays and cap floods. They do not prove a
visitor is human: the real replay harness demonstrates that a custom client can
solve proof-of-work, wait, and then chat.

## Product constraints

- Passive presence and movement should stay low-friction.
- Add friction at valuable public actions, not every page load.
- Prefer reversible, scoped degradation over broad denial.
- Do not introduce invasive fingerprinting or imply that browser-ID bans are
  permanent.
- Any heuristic must have a real-client and adversarial replay test.

## Remaining decisions

The highest-value next slice is trust around a visitor's first public action:

1. Decide whether a fresh visitor's first chat or public name is held, dropped,
   or challenged.
2. Suppress off-site notifications for messages that are not trusted enough to
   reach the public scene.
3. If stronger proof is needed, challenge on the first public action and remember
   a short-lived successful result; do not challenge passive observers.
4. Expose only actionable trust/suppression reasons to site owners.
5. Add adaptive source cooldowns or a raid mode only if real incidents justify
   their complexity.

Turnstile, shared reputation, adaptive proof-of-work, and cross-site trust remain
options rather than commitments. Each would add external dependency or policy
cost and needs a concrete incident or product decision first.

## Validation contract

`scripts/bot-replay-test.js` exercises real HTTP and WebSocket behavior. Its
expectation flags preserve today's baseline while allowing a stricter first-action
policy to be developed explicitly. Any future trust gate must continue to prove:

- allowed visitors can join, observe, move, and eventually chat;
- wrong-origin and over-budget clients fail;
- challenges admit the real widget;
- newly gated actions do not leak to peers or notifications;
- returning trusted visitors avoid repeated friction.
