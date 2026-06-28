# TownSquare anti-bot plan

A practical anti-bot plan for TownSquare that raises abuse cost **without turning the widget into a checkpoint maze**.

This plan assumes the product goal stays the same: lightweight public presence first, conversation second. The square should still feel open.

## Product constraints

What we want:

- people can **see the square immediately**
- casual visitors can usually **move around with no friction**
- regular visitors should **rarely notice anti-bot systems**
- owners should get better protection against spam, raids, and notification abuse

What we do **not** want:

- captchas on page load for everyone
- mandatory accounts
- brittle fingerprinting as the primary trust signal
- moderation flows so heavy that they dominate the product

## Threat model

The main abuse cases are not "state actor" abuse. They are cheap internet abuse:

1. **scripted joiners**
   - raw WebSocket clients or headless browsers joining many times
2. **chat spam**
   - repeated short messages, ads, junk text, Unicode abuse, ASCII art flood
3. **notification abuse**
   - using chat to trigger owner Telegram notifications repeatedly
4. **identity churn**
   - coming back with fresh browser identities after mute/block
5. **soft raids**
   - many low-effort visitors piling in from a link and degrading the square without looking like a classic DDoS

## Design principles

### Invisible by default

Anti-bot controls should be mostly invisible to normal visitors. The strongest controls should trigger only when someone tries to become socially visible or starts looking suspicious.

### Gate actions, not presence

Presence is the product. The default should be:

- loading the widget: open
- watching the square: open
- simple movement: mostly open
- public speaking / profile visibility / repeat joins: more protected

### Cost ladders beat hard walls

TownSquare should add friction in layers:

- free
- cheap proof
- stronger proof
- owner moderation
- hard blocks

That preserves the vibe better than front-loading a captcha.

### Honest moderation

Use soft controls first:

- suppress reach
- delay trust
- lower visibility
- stop notifications

Only then:

- kick
- mute
- block

## Trust ladder

Treat visitors as moving through trust states instead of a simple allowed/blocked binary.

### 0. Observer

Capabilities:

- load square
- see others
- receive scene updates
- maybe minimal movement

Restrictions:

- cannot chat
- cannot set a public display name
- does not trigger owner notifications

### 1. Fresh visitor

Capabilities:

- move
- settle on props
- maybe lightweight emotes

Restrictions:

- chat and public name are gated
- stronger rate limits
- suspicious behavior is watched closely

Entry path:

- default first join after origin checks and low-cost admission checks

### 2. Lightly trusted visitor

Capabilities:

- basic chat
- visible display name
- normal cooldowns

Entry path:

- cheap proof-of-work passed
- short dwell time or natural interaction
- not tripping heuristics

### 3. Fully trusted visitor

Capabilities:

- normal experience
- fewer false-positive restrictions

Entry path:

- Turnstile pass before first public action
- or owner/manual trust
- or durable prior trust for the same browser identity

### 4. Restricted / shadow-restricted

Capabilities:

- may still see the square
- may still think actions worked locally

Restrictions:

- no public reach, no notifications, stricter rate limits

Entry path:

- heuristics triggered
- owner action
- repeated low-trust abuse

## Control stack

## 1) Edge and admission controls

These are the cheap, broad filters.

### Keep / strengthen

- strict origin admission for hosted scenes
- same-host default for self-hosted scenes
- connection caps
- payload caps
- per-IP join / identity / state / chat budgets
- heartbeat cleanup

### Add

- **per-site join budget** separate from generic connection budget
- **burst join limiter** for new identities per IP / subnet / ASN
- **adaptive join cost** under load
- **short-lived connection challenge** bound to the current socket

### Proof-of-work

Use PoW as a **first-cost screen**, not the whole bot strategy.

Recommended:

- keep it lightweight when traffic is calm
- increase difficulty only under abuse or spikes
- bind it to the current connection and expire it quickly
- solve before the visitor becomes socially visible

PoW is good against lazy scripts. It is not enough on its own.

## 2) Action gating

This is the main low-friction product move.

### Do not gate

- loading the widget
- watching
- most movement

### Gate before first public action

Require stronger trust before:

- first chat message
- first public display name
- repeated rapid rejoins
- outbound links in chat
- owner-notification-triggering messages

### Turnstile placement

Best default:

- **not on page load**
- **not for lurkers**
- **only before first chat / first public identity action / suspicious repeat admission**

That means most normal visitors see nothing, while bots trying to speak immediately pay a much higher cost.

### Degrade safely when untrusted

Before Turnstile or equivalent trust:

- allow movement
- suppress public chat delivery
- suppress Telegram notifications
- suppress public display-name changes
- keep stricter chat cooldowns

## 3) Abuse-specific heuristics

Heuristics should **reduce reach**, not instantly ban, unless behavior is extreme.

### Join heuristics

Signals:

- repeated fresh identities from one IP/subnet/ASN
- identical fast join cadence
- many joins with no dwell time
- many joins that attempt public action immediately

Responses:

- raise join cost
- require Turnstile
- place joins into restricted trust state
- temporary silent admission freeze for that source

### Movement / presence heuristics

Signals:

- mechanically identical movement patterns
- impossible cadence across many identities
- synchronized behavior bursts
- instant prop-settle or repeated scripted loops

Responses:

- stricter state rate limits
- stop promotion from fresh -> trusted
- mark source as suspicious for a cooling period

### Chat heuristics

Signals:

- first action after join is chat
- repeated identical or near-identical messages
- high-entropy junk / zalgo / oversized Unicode weirdness
- aggressive multi-line / ASCII-art payloads
- ad-like domains or repeated self-promo phrases
- all-caps flood / copy-paste spam
- too many distinct identities pushing the same text

Responses:

- shadow-drop or quarantine message
- auto-mute fresh identity
- strip links or downgrade to plain text
- disable owner notifications for that identity
- escalate to Turnstile requirement

### Identity-churn heuristics

Signals:

- blocked or muted behavior returning immediately under new browser IDs
- same network source repeatedly creating short-lived identities
- same text/profile pattern reappearing after moderation

Responses:

- temporary IP/subnet trust downgrade
- require stronger proof on re-entry
- let owners block broader source buckets if needed

## 4) Moderation tools

The current moderation tools are useful, but anti-bot work should add softer controls.

### Add first

- **shadow mute / shadow drop** for suspicious fresh visitors
- **notification suppression** for untrusted or heuristic-flagged visitors
- **recent-message / recent-join context** in admin
- **source-level audit hints** (same IP bucket / same subnet / same ASN if available)
- **"require verification for public actions" toggle** per site

### Add later if needed

- timed source cooldowns
- per-site strict mode during raids
- optional link allow/block policy
- optional invite-only speaking mode for high-traffic moments
- global source-share limits during bursts (example: one source producing an extreme share of recent chat)
- exact-match repeat suppression (`same message N times in M seconds`)
- much stricter cooldowns for color changes, jumps, and other low-value high-noise actions
- community-assisted spam marking that can feed temporary text-pattern suppression after review thresholds

### Review notes: useful later-stage heuristics

These are worth keeping in the plan, but **not as the first implementation slice**.

#### A. "One source sent most of the recent chat"

Good idea as a **raid/spam burst heuristic**.

Recommended use:

- only apply when total recent message volume is above a minimum floor
- treat it as a suspicion score, not an instant permanent block
- prefer temporary mute / trust downgrade / notification suppression

Reason:

A tiny quiet square can be dominated by one real human naturally. The heuristic gets much better when used only during actual bursts.

#### B. "If three users mark it as spam, block similar messages for 24h"

Potentially useful, but should be designed carefully.

Recommended use:

- treat user reports as one signal in a moderation score
- use temporary quarantine / review / pattern cooldown first
- start with exact-match or near-exact-match suppression, not broad semantic matching
- scope it per site, with expiration and admin visibility

Reason:

This can work well against obvious raids, but broad "similarity" blocking can create false positives and can itself be gamed.

#### C. "Forbid exact same message more than N times per M seconds"

Yes. This is low-risk and should probably be part of the standard chat heuristics.

Recommended use:

- per identity
- per source bucket
- optionally across the whole site during burst conditions

Reason:

This is cheap, understandable, and directly targets common spam behavior.

#### D. "Rate limit color change and jump much more"

Yes. Good idea.

Recommended use:

- stricter cooldowns for cosmetics and noisy movement actions than for ordinary walking
- even stricter cooldowns while still in fresh/untrusted state

Reason:

These actions are low-value for genuine conversation but high-value for attention spam, so they are good places to add friction.

### Candidate thresholds to revisit later

These are **starting points for discussion**, not final values.

#### Message-share burst heuristic

Possible rule:

- only evaluate once the square has seen at least `10-20` messages in the last `60s`
- if one source produces more than `60-70%` of those messages, downgrade trust for `5-15m`
- default response should be: suppress notifications first, then temporary mute if the burst continues

#### Exact-repeat suppression

Possible rule:

- same identity sending the exact same message more than `2-3` times in `20-30s` -> block or shadow-drop
- same source bucket sending the exact same message more than `3-5` times in `30-60s` -> temporary source cooldown
- during raid mode, allow a site-wide exact-match suppression window of `10-30m`

#### Community spam marking

Possible rule:

- require at least `3` independent trusted reporters
- only trigger automatic suppression if the square has enough active humans to make brigading less trivial
- begin with exact-match or near-exact-match suppression for `1-24h`
- always expose the triggered rule in admin so the owner can clear it

#### Color / jump / nuisance-action cooldowns

Possible rule:

- color change: `5-10s` cooldown for trusted, `15-30s` for fresh visitors
- jump or similar attention action: `2-5s` cooldown for trusted, `5-10s` for fresh visitors
- if nuisance actions are spammed anyway, temporarily freeze that action class for the source for `1-5m`

#### Important caution

These controls are best used as **temporary cooling mechanisms**, not hard permanent bans.

The product risk here is false positives in small, quiet squares. So the safer default is:

- short-lived suppression
- trust downgrade
- notification suppression
- clear admin visibility

## 5) Notifications

Telegram notifications are part of the abuse surface.

Recommended policy:

- **never notify on completely fresh, untrusted identities**
- only notify after trust promotion, or after a small dwell threshold
- collapse repeated notifications from the same source into summaries
- add a cooldown per identity and per source
- suppress notifications for heuristic-flagged messages even if the local chat stays visible pending review

This matters a lot because notification spam hurts even when the public square itself stays usable.

## 6) Durable trust without accounts

No account system is needed yet, but TownSquare should remember useful trust.

Possible durable signals:

- existing browserId + browserSecret with prior clean history
- prior successful Turnstile pass for the same browser identity
- owner allow/trust action
- time-based trust aging: clean history makes future friction lower

Do **not** over-invest in invasive fingerprinting. It is brittle and unpleasant.

## 7) Rollout plan

## Current live conclusion

The live redteam result matters for prioritization:

- PoW is already real and working
- wrong-origin attempts are rejected
- but a custom script can still solve PoW, wait briefly, and speak
- so the next work should focus on **first public action gating** and **notification suppression**, not on replacing page-load behavior

In plain terms: the current system already stops the laziest bots, but it does **not yet stop a slightly smarter spam bot**.

## Concrete implementation plan

This is the practical build order for the current codebase.

### Slice A — fresh visitors stay socially quiet by default

Goal:

- a fresh visitor can still load, watch, and move
- a fresh visitor cannot immediately become publicly visible in the highest-value ways

Behavior:

- fresh visitors keep normal passive access
- first public chat is blocked, shadow-dropped, or held until trust promotion
- first public display name is hidden from others until trust promotion
- fresh visitors do not trigger Telegram notifications

Likely server touchpoints:

- `server.js`
  - visitor trust state on identity/client records
  - `handleInit`
  - `handleSay`
  - `handleProfile`
  - notification gating path / plugin dispatch
- plugin notification code
  - suppress fresh / suspicious message fanout

Replay expectations to enable after this lands:

- `EXPECT_FRESH_CHAT_BLOCK=1`
- `EXPECT_PUBLIC_NAME_GATE=1`

### Slice B — trust promotion for first public action

Goal:

- keep the square open for watching
- add stronger proof only when someone tries to speak or become publicly visible

Behavior:

- if a visitor tries first chat or first public name change while still fresh:
  - require a stronger proof step
  - after success, promote them to a trusted state
  - for a while after that, let them use the square normally

Recommended proof order:

1. existing PoW if enabled
2. Turnstile only for first public action or suspicious re-entry
3. durable short-lived trust after success

Likely touchpoints:

- `server.js`
  - trust transitions
  - temporary pending-action state
- `public/widget/protocol.mjs`
  - challenge / promotion flow
- widget UI files
  - minimal copy for "verify before speaking"

### Slice C — suspicious fresh chat stops reaching the owner

Goal:

- spam should fail quietly before it becomes an owner pain problem

Behavior:

- suspicious fresh messages can be:
  - dropped
  - locally acknowledged but not delivered
  - delivered in-square but not notified off-site
- repeated low-trust abuse reduces source trust further

Likely touchpoints:

- `server.js`
  - heuristic scoring / cooling window
  - per-source trust downgrade
- Telegram notification plugin
  - per-identity and per-source cooldowns
  - suppression for fresh / suspicious states

### Slice D — moderation gets better visibility, not just harder bans

Goal:

- site owners should understand what is happening without doing forensic work

Behavior:

- admin can see whether a visitor is:
  - fresh
  - trusted
  - suspicious
  - muted/shadow-muted
- admin can see why notifications were suppressed
- repeated churn from the same source bucket is visible as a pattern, not as unrelated random visitors

Likely touchpoints:

- `server.js`
  - moderation log payloads
  - admin JSON responses
- hosted admin UI files
  - badges / labels / recent-event hints

### Slice E — source cooldowns and stricter anti-raid mode

Goal:

- make repeated abuse expensive without affecting ordinary traffic most of the time

Behavior:

- repeated fresh joins from the same source raise cost
- repeated public-action attempts from suspicious sources require stronger proof
- sites can optionally enable a stricter speaking mode during raids

This should come **after** slices A-C, not before. Otherwise you spend complexity budget on admission while leaving owner pain mostly unchanged.

## Visitor impact in plain language

### For ordinary visitors

Most people should notice almost nothing.

Expected experience:

- the widget still opens normally
- people can still look around normally
- movement should still feel open
- most people will only ever see a verification step if they try to say something publicly for the first time

In other words: **watching stays easy; speaking may require one extra step the first time.**

### For suspicious or spammy visitors

Their experience gets worse fast.

Expected impact:

- they may appear to succeed locally while their spam goes nowhere
- they may get a verification step before speaking
- repeated re-entry attempts become slower and less useful
- notification abuse stops paying off

### For regular returning visitors

Once someone has already behaved normally and passed any needed check, future friction should be lower.

That means the system should feel like:

- first-time caution
- then mostly normal use

not like a captcha every visit.

## Site owner impact in plain language

### Good changes owners should feel

- fewer spam pings on Telegram
- fewer drive-by trolls who can instantly talk
- less need to manually block the same person over and over under new names
- clearer moderation signals in admin

### Tradeoffs owners should expect

- a few legitimate first-time visitors may need one extra check before their first public message
- some edge cases may need manual trust or unmute when heuristics are too cautious
- moderation becomes a bit more stateful: not just "allowed or banned," but also fresh, trusted, and suspicious

That tradeoff is worth it because it moves friction away from **everyone** and concentrates it on **high-risk moments**.

## Recommended delivery order

If only a limited amount of work gets done soon, do it in this order:

1. suppress Telegram notifications for fresh / suspicious visitors
2. gate first public chat
3. gate first public display name
4. add trust promotion after verification
5. add moderation/admin visibility for trust state
6. add stricter source cooldowns and anti-raid mode

That order gives the best protection-per-friction ratio.

## Now

- trust ladder in server model
- gate first public actions instead of gating page load
- suppress Telegram notifications for fresh visitors
- shadow-drop / quarantine suspicious fresh chat
- add replay script and local validation matrix
- admin visibility for suspicious joins and repeated source patterns

## Next

- Turnstile before first public action
- adaptive PoW difficulty under load
- heuristic-driven source cooldowns
- per-site stricter anti-raid mode

## Later

- stronger network-source controls if needed
- optional reputation sharing between TownSquares
- optional "speaking is gated, observing is open" presets per site

## Recommended default policy

If we want the best balance of openness and abuse resistance, the default hosted policy should be:

- widget loads with no challenge
- movement stays available
- fresh identities are **not yet trusted to speak publicly**
- first chat or first visible name change requires proof
- cheap PoW happens first when enabled
- Turnstile appears only when needed for the first public action or suspicious re-entry
- fresh visitors never trigger Telegram notifications
- suspicious fresh messages are shadow-dropped rather than loudly rejected

That keeps the square feeling open while protecting the owner and the crowd.

## Validation plan

The anti-bot work should ship with a replay harness that proves:

1. same-origin / allowed-origin visitors can still join
2. wrong-origin visitors cannot join
3. per-IP identity caps still work
4. fresh visitors can observe/move without friction
5. fresh visitors cannot use newly gated public actions unless promoted
6. challenge/PoW flows still admit legitimate clients
7. trusted visitors can still chat normally
8. suspicious spam flows are suppressed without breaking normal conversation
9. Telegram notifications are not emitted for fresh / suspicious identities

The replay harness should support both:

- **today's baseline behavior**
- **future stricter expectations** via env flags as anti-bot features land

See `scripts/bot-replay-test.js`.

## Success criteria

We should call this successful if:

- normal visitors rarely notice the anti-bot system
- drive-by scripts stop being able to speak cheaply
- repeated bot/spam attempts become expensive and low-yield
- owners receive far fewer abusive Telegram pings
- the square still feels playful and open when traffic is healthy
