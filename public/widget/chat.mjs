/**
 * Speech bubbles with per-message fade-out.
 *
 * Each line shows above the figure and disappears on its own timer, so a single
 * message simply appears and fades. When several land close together they stack
 * briefly: the newest stays solid while the older ones fade and shrink into
 * ghosts — but every bubble still expires individually, oldest first.
 */

import {
  BUBBLE_TTL_EXPANDED_MS,
  BUBBLE_TTL_MS,
  GHOST_STACK_MAX,
  GHOST_STACK_MAX_EXPANDED,
  MAX_RECENT_MESSAGES,
  MAX_RECENT_MESSAGES_EXPANDED,
  MESSAGE_MAX,
} from "./constants.mjs";
import { createBubble, createTrayRow } from "./dom.mjs";
import { MSG } from "../shared/protocol.mjs";

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 * @typedef {import("./dom.mjs").GhostMessage} GhostMessage
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const FADE_MS = 320;
const TYPING_IDLE_MS = 2500;

/**
 * Per-mount chat state. Kept off the module scope so two widgets on the same
 * page never share expanded-mode limits or a single speak-order counter — each
 * avatar holds a reference to its mount's scope via `avatar.chat`.
 *
 * @typedef {{ expandedView: boolean, speakOrder: number }} ChatScope
 * @returns {ChatScope}
 */
export function createChatScope() {
  // `speakOrder` is a monotonic counter so overlapping bubble columns stack
  // newest-on-top across every avatar in this mount.
  return { expandedView: false, speakOrder: 1 };
}

/**
 * Publish local composer activity, stopping automatically if input events cease.
 *
 * @param {WidgetContext} ctx
 * @param {boolean} typing
 */
export function setLocalTyping(ctx, typing) {
  clearTimeout(ctx.typingTimer);
  ctx.typingTimer = typing
    ? setTimeout(() => setLocalTyping(ctx, false), TYPING_IDLE_MS)
    : null;

  if (ctx.self.typing === typing) return;
  ctx.self.typing = typing;
  if (ctx.socket.readyState === WebSocket.OPEN && ctx.self.id) {
    ctx.socket.send(JSON.stringify({ type: MSG.TYPING, typing }));
  }
}

/** @param {ChatScope} scope */
function bubbleTtl(scope) {
  return scope.expandedView ? BUBBLE_TTL_EXPANDED_MS : BUBBLE_TTL_MS;
}

/** @param {ChatScope} scope */
function ghostStackMax(scope) {
  return scope.expandedView ? GHOST_STACK_MAX_EXPANDED : GHOST_STACK_MAX;
}

/** @param {ChatScope} scope */
function maxRecentMessages(scope) {
  return scope.expandedView ? MAX_RECENT_MESSAGES_EXPANDED : MAX_RECENT_MESSAGES;
}

/**
 * Switch chat linger/stack limits for expanded mode and refresh live bubbles.
 *
 * @param {ChatScope} scope This mount's chat state.
 * @param {boolean} expanded
 * @param {AvatarView[]} [avatars]
 */
export function setExpandedView(scope, expanded, avatars = []) {
  scope.expandedView = expanded;
  const ttl = bubbleTtl(scope);
  const stackMax = ghostStackMax(scope);
  const recentMax = maxRecentMessages(scope);

  for (const avatar of avatars) {
    for (const message of avatar.messages) {
      if (message.timer) clearTimeout(message.timer);
      message.timer = setTimeout(() => expire(avatar, message), ttl);
    }

    if (!expanded) {
      while (avatar.messages.length > stackMax) {
        const dropped = avatar.messages.shift();
        if (!dropped) break;
        clearTimeout(dropped.timer);
        dropped.el.remove();
      }
      if (avatar.history.length > recentMax) {
        avatar.history = avatar.history.slice(-recentMax);
        avatar.trayList.replaceChildren(...avatar.history.map(createTrayRow));
        avatar.el.classList.toggle("townsquare-avatar--has-history", avatar.history.length > 0);
      }
    }

    renderGhostStack(avatar);
  }
}

/**
 * Re-apply ghost classes by each bubble's distance from the newest line.
 * Bubbles that are fading out are left alone.
 *
 * @param {AvatarView} avatar
 */
function renderGhostStack(avatar) {
  const { messages } = avatar;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const distance = messages.length - 1 - i;
    let className = "townsquare-avatar__bubble";
    if (!(distance === 0 && message.solid)) {
      className += " townsquare-avatar__bubble--ghost";
      const farDistance = avatar.chat.expandedView ? 3 : 2;
      if (distance >= farDistance) className += " townsquare-avatar__bubble--far";
    }
    message.el.className = className;
  }
}

/**
 * Fade a single bubble out and drop it from the stack.
 *
 * @param {AvatarView} avatar
 * @param {GhostMessage} message
 */
function expire(avatar, message) {
  const index = avatar.messages.indexOf(message);
  if (index !== -1) avatar.messages.splice(index, 1);
  message.el.classList.add("townsquare-avatar__bubble--expiring");
  setTimeout(() => message.el.remove(), FADE_MS);
  renderGhostStack(avatar);
}

/**
 * Record a line into the character's recent history (the hover tray), capped by
 * mode. Used for live lines and for backlog seeded on join — the latter
 * latter populates history without ever popping a live bubble.
 *
 * @param {AvatarView} avatar
 * @param {{ text: string, at?: number }} message
 */
export function recordMessage(avatar, message) {
  avatar.history.push({
    text: message.text,
    at: typeof message.at === "number" ? message.at : Date.now(),
  });
  avatar.history = avatar.history.slice(-maxRecentMessages(avatar.chat));

  avatar.trayList.replaceChildren(...avatar.history.map(createTrayRow));
  avatar.el.classList.toggle("townsquare-avatar--has-history", avatar.history.length > 0);
}

/**
 * A freshly spoken line: it becomes the live bubble and everything older fades.
 * Each bubble runs its own fade timer, so they clear individually, oldest first.
 *
 * @param {AvatarView} avatar
 * @param {{ text: string, at?: number }} message
 */
export function sayMessage(avatar, message) {
  recordMessage(avatar, message);

  for (const existing of avatar.messages) existing.solid = false;
  avatar.el.style.setProperty("--speak-order", String(avatar.chat.speakOrder++));

  const el = createBubble(message.text);
  avatar.above.appendChild(el);

  /** @type {GhostMessage} */
  const entry = { el, solid: true, timer: null };
  avatar.messages.push(entry);

  // If lines pile up faster than they fade, cap the stack by dropping the oldest.
  while (avatar.messages.length > ghostStackMax(avatar.chat)) {
    const dropped = avatar.messages.shift();
    if (!dropped) break;
    clearTimeout(dropped.timer);
    dropped.el.remove();
  }

  entry.timer = setTimeout(() => expire(avatar, entry), bubbleTtl(avatar.chat));
  renderGhostStack(avatar);
}

/**
 * Show "Wait Ns…" above the composer for the remaining cooldown, keeping the
 * typed text in place. Auto-clears once the cooldown lapses.
 *
 * @param {WidgetContext} ctx
 * @param {number} remainingMs
 */
function showCooldownHint(ctx, remainingMs) {
  const { hint } = ctx.self.avatar;
  if (!hint) return;
  hint.textContent = `Wait ${Math.max(1, Math.ceil(remainingMs / 1000))}s…`;
  hint.hidden = false;
  clearTimeout(ctx.cooldownHintTimer);
  ctx.cooldownHintTimer = setTimeout(() => hideCooldownHint(ctx), remainingMs + 150);
}

/** @param {WidgetContext} ctx */
function hideCooldownHint(ctx) {
  clearTimeout(ctx.cooldownHintTimer);
  ctx.cooldownHintTimer = null;
  const { hint } = ctx.self.avatar;
  if (hint) hint.hidden = true;
}

/**
 * Send the local composer's text, then show it immediately on your own figure.
 *
 * Slow mode is enforced here too: if the cooldown has not elapsed we keep the
 * typed text and tell the sender how long to wait, rather than letting the
 * server silently drop the line (which the sender's local echo would otherwise
 * hide from them).
 *
 * @param {WidgetContext} ctx
 * @returns {boolean} Whether the line was sent. `false` (e.g. slow-mode block)
 *   tells the composer to keep its text and stay open.
 */
export function submitChat(ctx) {
  if (ctx.quiet) return false;

  const { input } = ctx.self.avatar;
  if (!input) return false;

  // Mirror the server's cap (sanitizeMessage: trim + slice to MESSAGE_MAX) so
  // the optimistic local echo matches exactly what the server stores and
  // re-broadcasts, instead of briefly showing an over-length line we sent.
  const text = input.value.trim().slice(0, MESSAGE_MAX);
  if (!text) return false;

  // Local-only modes (preview/dev simulate) have no server to echo the line
  // back, so they show it directly. Live modes still need an open socket.
  const localOnly = ctx.options.preview === true || ctx.options.simulate === true;
  if (!localOnly && ctx.socket.readyState !== WebSocket.OPEN) return false;

  // Slow mode is a client-side UX concern, so it applies in local modes too
  // (it lets the /dev sandbox exercise the "wait" hint without a server).
  const cooldown = ctx.chatThrottleMs || 0;
  const now = Date.now();
  if (cooldown > 0 && ctx.self.lastSayAt && now - ctx.self.lastSayAt < cooldown) {
    showCooldownHint(ctx, cooldown - (now - ctx.self.lastSayAt));
    return false;
  }

  if (ctx.socket.readyState === WebSocket.OPEN) {
    ctx.socket.send(JSON.stringify({ type: MSG.SAY, text }));
  }
  sayMessage(ctx.self.avatar, { text, at: now });
  ctx.self.lastSayAt = now;
  input.value = "";
  hideCooldownHint(ctx);
  return true;
}
