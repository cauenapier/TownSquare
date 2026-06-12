/**
 * Speech bubbles with per-message fade-out.
 *
 * Each line shows above the figure and disappears on its own timer, so a single
 * message simply appears and fades. When several land close together they stack
 * briefly: the newest stays solid while the older ones fade and shrink into
 * ghosts — but every bubble still expires individually, oldest first.
 */

import { BUBBLE_TTL_MS, GHOST_STACK_MAX, MAX_RECENT_MESSAGES } from "./constants.mjs";
import { createBubble, createTrayRow } from "./dom.mjs";

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 * @typedef {import("./dom.mjs").GhostMessage} GhostMessage
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const FADE_MS = 320;

// Monotonic speak order so overlapping bubble columns stack newest-on-top.
let speakOrder = 1;

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
    let className = "avatar__bubble";
    if (!(distance === 0 && message.solid)) {
      className += " avatar__bubble--ghost";
      if (distance >= 2) className += " avatar__bubble--far";
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
  message.el.classList.add("avatar__bubble--expiring");
  setTimeout(() => message.el.remove(), FADE_MS);
  renderGhostStack(avatar);
}

/**
 * Record a line into the character's recent history (the hover tray), capped at
 * MAX_RECENT_MESSAGES. Used for live lines and for backlog seeded on join — the
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
  avatar.history = avatar.history.slice(-MAX_RECENT_MESSAGES);

  avatar.trayList.replaceChildren(...avatar.history.map(createTrayRow));
  avatar.el.classList.toggle("avatar--has-history", avatar.history.length > 0);
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
  while (avatar.messages.length > GHOST_STACK_MAX) {
    const dropped = avatar.messages.shift();
    if (!dropped) break;
    clearTimeout(dropped.timer);
    dropped.el.remove();
  }

  entry.timer = setTimeout(() => expire(avatar, entry), BUBBLE_TTL_MS);
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
