/**
 * Neighbouring-town connections: edge signposts and the "walk over" modal.
 *
 * A site owner links other towns to the left and/or right of the square. Each
 * side that has links grows a signpost at the stage edge; walking up to it (or
 * clicking it) opens a small modal listing the towns the visitor can travel to.
 */

import { MAX_X, MIN_X } from "./constants.mjs";
import { CONNECTION_SIDES, connectionsBySide, hostnameLabel } from "../shared/site-config.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 * @typedef {import("../shared/site-config.mjs").Connection} Connection
 */

/** How close to an edge the avatar must be for the signpost to invite a visit. */
const EDGE_ZONE = 0.14;

const SIDE_LABELS = { left: "west", right: "east" };
const SIDE_ARROWS = { left: "←", right: "→" };

// Line-art fingerpost: a post with a directional plank pointing outward toward
// the side it links to. Matches the stroked look of the scene props.
const SIGN_SVG = {
  left: `<svg viewBox="0 0 26 44" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path d="M20 3 L20 43"></path><path d="M20 10 L7 10 L2 14 L7 18 L20 18 Z"></path></svg>`,
  right: `<svg viewBox="0 0 26 44" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path d="M6 3 L6 43"></path><path d="M6 10 L19 10 L24 14 L19 18 L6 18 Z"></path></svg>`,
};

/**
 * Build the grouped connection map and render any signposts. Idempotent: tears
 * down a previous render first so it can be reused by updateConfig.
 *
 * @param {WidgetContext} ctx
 */
export function setupConnections(ctx) {
  teardownConnections(ctx);

  ctx.connectionsBySide = connectionsBySide(ctx.options.connections || []);
  ctx.signposts = { left: null, right: null };
  ctx.connectionsModal = null;
  ctx.nearSide = null;

  for (const side of CONNECTION_SIDES) {
    const connections = ctx.connectionsBySide[side];
    if (connections.length === 0) continue;
    ctx.signposts[side] = renderSignpost(ctx, side, connections);
  }
}

/**
 * @param {WidgetContext} ctx
 * @param {"left"|"right"} side
 * @param {Array<Connection>} connections
 * @returns {HTMLButtonElement}
 */
function renderSignpost(ctx, side, connections) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `townsquare-signpost townsquare-signpost--${side}`;
  button.setAttribute(
    "aria-label",
    `Visit ${connections.length} ${connections.length === 1 ? "town" : "towns"} to the ${SIDE_LABELS[side]}`,
  );

  const sign = document.createElement("span");
  sign.className = "townsquare-signpost__sign";
  sign.setAttribute("aria-hidden", "true");
  sign.innerHTML = SIGN_SVG[side];

  const hint = document.createElement("span");
  hint.className = "townsquare-signpost__hint";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = "press ↑ to visit";

  button.append(sign, hint);

  button.addEventListener("click", (event) => {
    // Keep the click from also registering as a walk-to-here tap on the stage.
    event.stopPropagation();
    openConnectionsModal(ctx, side);
  });

  ctx.stage.appendChild(button);
  return button;
}

/**
 * Per-frame: light up the signpost the avatar is standing next to so a keyboard
 * walker knows they can press ↑, and record which side is currently reachable.
 *
 * @param {WidgetContext} ctx
 */
export function updateConnectionProximity(ctx) {
  if (!ctx.signposts) return;

  const side = nearbySide(ctx);
  if (side === ctx.nearSide) return;
  ctx.nearSide = side;

  for (const key of CONNECTION_SIDES) {
    ctx.signposts[key]?.classList.toggle("townsquare-signpost--near", key === side);
  }
}

/**
 * @param {WidgetContext} ctx
 * @returns {"left"|"right"|null}
 */
function nearbySide(ctx) {
  if (!ctx.signposts) return null;
  const { x } = ctx.self;
  if (ctx.signposts.left && x <= MIN_X + EDGE_ZONE) return "left";
  if (ctx.signposts.right && x >= MAX_X - EDGE_ZONE) return "right";
  return null;
}

/**
 * The side the visitor can activate from the keyboard right now, if any.
 *
 * @param {WidgetContext} ctx
 * @returns {"left"|"right"|null}
 */
export function activeSignpostSide(ctx) {
  return ctx.nearSide || null;
}

/**
 * @param {WidgetContext} ctx
 * @param {"left"|"right"} side
 */
export function openConnectionsModal(ctx, side) {
  const connections = ctx.connectionsBySide?.[side];
  if (!connections || connections.length === 0) return;
  closeConnectionsModal(ctx);

  // The admin/customization preview mounts the real widget. Opening a town there
  // should not navigate the owner away from their own page mid-configuration, so
  // links open in a new tab instead of travelling in place.
  const newTab = ctx.options.preview === true || ctx.options.simulate === true;

  const overlay = document.createElement("div");
  overlay.className = "townsquare-connections";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `Towns to the ${SIDE_LABELS[side]}`);

  const backdrop = document.createElement("div");
  backdrop.className = "townsquare-connections__backdrop";

  const panel = document.createElement("div");
  panel.className = "townsquare-connections__panel";

  const head = document.createElement("div");
  head.className = "townsquare-connections__head";

  const title = document.createElement("span");
  title.className = "townsquare-connections__title";
  title.textContent = `Towns to the ${SIDE_LABELS[side]}`;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "townsquare-connections__close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";

  head.append(title, close);

  const list = document.createElement("ul");
  list.className = "townsquare-connections__list";

  for (const connection of connections) {
    const item = document.createElement("li");

    const link = document.createElement("a");
    link.className = "townsquare-connections__item";
    link.href = connection.url;
    link.rel = "noopener";
    if (newTab) link.target = "_blank";

    const name = document.createElement("span");
    name.className = "townsquare-connections__item-name";
    name.textContent = connection.label;

    const host = document.createElement("span");
    host.className = "townsquare-connections__item-host";
    host.textContent = hostnameLabel(connection.url);

    const go = document.createElement("span");
    go.className = "townsquare-connections__item-go";
    go.textContent = `walk over ${SIDE_ARROWS[side]}`;

    link.append(name, host, go);
    item.appendChild(link);
    list.appendChild(item);
  }

  panel.append(head, list);
  overlay.append(backdrop, panel);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeConnectionsModal(ctx);
    }
  };

  backdrop.addEventListener("click", () => closeConnectionsModal(ctx));
  close.addEventListener("click", () => closeConnectionsModal(ctx));
  window.addEventListener("keydown", onKeyDown, true);

  ctx.app.appendChild(overlay);
  // Return focus to the signpost on close (matters when opened via the keyboard).
  ctx.connectionsModal = { overlay, onKeyDown, trigger: ctx.signposts?.[side] || null };
  close.focus();
}

/**
 * @param {WidgetContext} ctx
 */
export function closeConnectionsModal(ctx) {
  const modal = ctx.connectionsModal;
  if (!modal) return;
  window.removeEventListener("keydown", modal.onKeyDown, true);
  modal.overlay.remove();
  ctx.connectionsModal = null;
  if (modal.trigger?.isConnected) modal.trigger.focus();
}

/**
 * @param {WidgetContext} ctx
 */
export function teardownConnections(ctx) {
  closeConnectionsModal(ctx);
  if (ctx.signposts) {
    ctx.signposts.left?.remove();
    ctx.signposts.right?.remove();
  }
  ctx.signposts = null;
  ctx.connectionsBySide = null;
  ctx.nearSide = null;
}
