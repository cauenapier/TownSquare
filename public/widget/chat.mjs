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
} from "./constants.mjs";
import { createBubble, createTrayRow } from "./dom.mjs";

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 * @typedef {import("./dom.mjs").GhostMessage} GhostMessage
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const FADE_MS = 320;

// Monotonic speak order so overlapping bubble columns stack newest-on-top.
let speakOrder = 1;
let expandedView = false;

function bubbleTtl() {
  return expandedView ? BUBBLE_TTL_EXPANDED_MS : BUBBLE_TTL_MS;
}

function ghostStackMax() {
  return expandedView ? GHOST_STACK_MAX_EXPANDED : GHOST_STACK_MAX;
}

function maxRecentMessages() {
  return expandedView ? MAX_RECENT_MESSAGES_EXPANDED : MAX_RECENT_MESSAGES;
}

/**
 * Switch chat linger/stack limits for expanded mode and refresh live bubbles.
 *
 * @param {boolean} expanded
 * @param {AvatarView[]} [avatars]
 */
export function setExpandedView(expanded, avatars = []) {
  expandedView = expanded;
  const ttl = bubbleTtl();
  const stackMax = ghostStackMax();
  const recentMax = maxRecentMessages();

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
      const farDistance = expandedView ? 3 : 2;
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
  avatar.history = avatar.history.slice(-maxRecentMessages());

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
  avatar.el.style.setProperty("--speak-order", String(speakOrder++));

  const el = createBubble(message.text);
  avatar.above.appendChild(el);

  /** @type {GhostMessage} */
  const entry = { el, solid: true, timer: null };
  avatar.messages.push(entry);

  // If lines pile up faster than they fade, cap the stack by dropping the oldest.
  while (avatar.messages.length > ghostStackMax()) {
    const dropped = avatar.messages.shift();
    if (!dropped) break;
    clearTimeout(dropped.timer);
    dropped.el.remove();
  }

  entry.timer = setTimeout(() => expire(avatar, entry), bubbleTtl());
  renderGhostStack(avatar);
}

/**
 * Send the local composer's text, then show it immediately on your own figure.
 *
 * @param {WidgetContext} ctx
 */
export function submitChat(ctx) {
  if (ctx.quiet) return;

  const { input } = ctx.self.avatar;
  if (!input) return;

  const text = input.value.trim();
  if (!text || ctx.socket.readyState !== WebSocket.OPEN) return;

  ctx.socket.send(JSON.stringify({ type: "say", text }));
  sayMessage(ctx.self.avatar, { text, at: Date.now() });
  input.value = "";
}
