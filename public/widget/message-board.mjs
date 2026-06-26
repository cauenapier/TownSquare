/**
 * Owner message board: a single clickable prop carrying a note for visitors.
 *
 * The site owner places one board (position, art variant, accent colour) and
 * writes a title + body. Clicking the board opens a small modal showing that
 * message — the same overlay shape as the neighbouring-town connections modal.
 * A "!" badge rides the board until the visitor has opened the *current*
 * message; read-state is remembered per-site in localStorage so it survives
 * reloads but reappears whenever the owner edits the text.
 */

import { createMessageBoardProp, sanitizeMessageBoard } from "../shared/site-config.mjs";
import {
  getMessageBoardRead,
  messageBoardSignature,
  setMessageBoardRead,
} from "./utils.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * Build (or rebuild) the message board from the current options. Idempotent: it
 * tears down any previous render first so it can be reused by updateConfig.
 *
 * @param {WidgetContext} ctx
 */
export function setupMessageBoard(ctx) {
  teardownMessageBoard(ctx);

  const board = sanitizeMessageBoard(ctx.options.messageBoard || {});
  const prop = createMessageBoardProp(board);
  if (!prop) return;

  ctx.messageBoard = {
    board,
    signature: messageBoardSignature(board.title, board.body),
    button: renderBoard(ctx, prop),
    modal: null,
  };
  refreshUnreadBadge(ctx);
}

/**
 * @param {WidgetContext} ctx
 * @param {ReturnType<typeof createMessageBoardProp>} prop
 * @returns {HTMLButtonElement}
 */
function renderBoard(ctx, prop) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `townsquare-board townsquare-board--${prop.variant}`;
  button.style.left = `${(prop.x * 100).toFixed(2)}%`;
  button.style.width = `${prop.width}px`;
  button.style.height = `${prop.height}px`;
  if (prop.accent) button.style.setProperty("--board-accent", prop.accent);
  button.setAttribute("aria-label", "Read the message board");

  const art = document.createElement("span");
  art.className = "townsquare-board__art";
  art.setAttribute("aria-hidden", "true");
  art.innerHTML = prop.svg;

  const badge = document.createElement("span");
  badge.className = "townsquare-board__badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = "!";

  button.append(art, badge);

  button.addEventListener("click", (event) => {
    // Keep the click from also registering as a walk-to-here tap on the stage.
    event.stopPropagation();
    openMessageBoardModal(ctx);
  });

  ctx.stage.appendChild(button);
  return button;
}

/**
 * Show or hide the "!" badge based on whether the visitor has opened the message
 * the board is currently showing.
 *
 * @param {WidgetContext} ctx
 */
function refreshUnreadBadge(ctx) {
  const state = ctx.messageBoard;
  if (!state) return;
  const siteKey = ctx.options.siteKey || ctx.root?.dataset?.townsquareSiteKey || "";
  const unread = getMessageBoardRead(siteKey) !== state.signature;
  state.button.classList.toggle("townsquare-board--unread", unread);
}

/**
 * @param {WidgetContext} ctx
 */
export function openMessageBoardModal(ctx) {
  const state = ctx.messageBoard;
  if (!state) return;
  closeMessageBoardModal(ctx);

  const { board } = state;

  const overlay = document.createElement("div");
  overlay.className = "townsquare-board-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", board.title || "Message board");
  if (board.accent) overlay.style.setProperty("--board-accent", board.accent);

  const backdrop = document.createElement("div");
  backdrop.className = "townsquare-board-modal__backdrop";

  const panel = document.createElement("div");
  panel.className = "townsquare-board-modal__panel";

  const head = document.createElement("div");
  head.className = "townsquare-board-modal__head";

  const title = document.createElement("span");
  title.className = "townsquare-board-modal__title";
  title.textContent = board.title || "Message board";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "townsquare-board-modal__close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";

  head.append(title, close);

  const bodyEl = document.createElement("p");
  bodyEl.className = "townsquare-board-modal__body";
  // Preserve the owner's line breaks; textContent keeps the message inert (no HTML).
  bodyEl.textContent = board.body;

  panel.append(head, bodyEl);
  overlay.append(backdrop, panel);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMessageBoardModal(ctx);
    }
  };

  backdrop.addEventListener("click", () => closeMessageBoardModal(ctx));
  close.addEventListener("click", () => closeMessageBoardModal(ctx));
  window.addEventListener("keydown", onKeyDown, true);

  ctx.app.appendChild(overlay);
  state.modal = { overlay, onKeyDown, trigger: state.button };
  close.focus();

  // Opening the board counts as reading the message it currently shows.
  const siteKey = ctx.options.siteKey || ctx.root?.dataset?.townsquareSiteKey || "";
  setMessageBoardRead(siteKey, state.signature);
  refreshUnreadBadge(ctx);
}

/**
 * @param {WidgetContext} ctx
 */
export function closeMessageBoardModal(ctx) {
  const modal = ctx.messageBoard?.modal;
  if (!modal) return;
  window.removeEventListener("keydown", modal.onKeyDown, true);
  modal.overlay.remove();
  ctx.messageBoard.modal = null;
  if (modal.trigger?.isConnected) modal.trigger.focus();
}

/**
 * @param {WidgetContext} ctx
 */
export function teardownMessageBoard(ctx) {
  closeMessageBoardModal(ctx);
  ctx.messageBoard?.button?.remove();
  ctx.messageBoard = null;
}
