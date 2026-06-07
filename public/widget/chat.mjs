/**
 * Chat bubbles, message history, and local composer submission.
 */

import { BUBBLE_TTL_MS, MAX_RECENT_MESSAGES } from "./constants.mjs";
import { renderTrayMessageRow } from "./dom.mjs";

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * @param {AvatarView} avatar
 */
export function syncTray(avatar) {
  avatar.el.classList.toggle("avatar--has-history", avatar.messages.length > 0);
  avatar.tray.hidden = avatar.messages.length === 0;
  avatar.trayList.replaceChildren(...avatar.messages.map(renderTrayMessageRow));
}

/**
 * @param {AvatarView} avatar
 * @param {{ text: string, at?: number }} message
 */
export function addMessage(avatar, message) {
  avatar.messages.push({
    text: message.text,
    at: typeof message.at === "number" ? message.at : Date.now(),
  });
  avatar.messages = avatar.messages.slice(-MAX_RECENT_MESSAGES);
  syncTray(avatar);
}

/**
 * @param {AvatarView} avatar
 * @param {string} text
 */
export function showBubble(avatar, text) {
  avatar.bubble.textContent = text;
  avatar.bubble.hidden = false;
  clearTimeout(avatar.bubbleTimer);
  avatar.bubbleTimer = setTimeout(() => {
    avatar.bubble.hidden = true;
  }, BUBBLE_TTL_MS);
}

/**
 * Send a chat message from the local composer and update local UI immediately.
 *
 * @param {WidgetContext} ctx
 * @param {HTMLInputElement} input
 * @param {HTMLFormElement} composer
 */
export function submitChat(ctx, input, composer) {
  const text = input.value.trim();
  if (!text || ctx.socket.readyState !== WebSocket.OPEN) return;

  ctx.socket.send(JSON.stringify({ type: "say", text }));
  addMessage(ctx.self.avatar, { text, at: Date.now() });
  showBubble(ctx.self.avatar, text);
  input.value = "";
  composer.hidden = true;
  const toggle = composer.parentElement?.querySelector(".avatar__chat-toggle");
  toggle?.setAttribute("aria-expanded", "false");
}
