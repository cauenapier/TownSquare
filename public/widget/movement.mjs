/**
 * Keyboard and stage tap input, local movement animation, and prop settle requests.
 */

import { layoutBubbleColumns, layoutConfigFor } from "./bubble-layout.mjs";
import { HIGH_FIVE_DISTANCE, JUMP_MS, MAX_X, MIN_X, MOVEMENT_SPEED, PROP_SETTLE_MS, SEND_INTERVAL_MS } from "./constants.mjs";
import { clamp } from "./math.mjs";
import {
  playHighFive,
  playJump,
  playRaisedHand,
  renderAvatar,
  setFacing,
  setWalking,
  updatePose,
  updatePropEffects,
} from "./dom.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * @param {number} x
 * @returns {number}
 */
export function clampSelfX(x) {
  return clamp(x, MIN_X, MAX_X);
}

/**
 * @param {WidgetContext} ctx
 */
export function resetPropSettle(ctx) {
  ctx.self.propZoneEnteredAt = 0;
  ctx.self.settlePropId = null;
  ctx.self.settleRequested = false;
}

/**
 * @param {import("../shared/scene-props.mjs").SceneProp[]} sceneProps
 * @param {number} x
 * @returns {import("../shared/scene-props.mjs").SceneProp | undefined}
 */
function findSettleProp(sceneProps, x) {
  return sceneProps
    .filter((candidate) => candidate.pose && candidate.zoneRadius > 0)
    .find((candidate) => Math.abs(x - candidate.x) < candidate.zoneRadius);
}

/**
 * @param {import("../shared/scene-props.mjs").SceneProp} prop
 * @param {number} requestedX
 * @returns {number}
 */
function findNearestSeatX(prop, requestedX) {
  const seats = Array.isArray(prop.seats) && prop.seats.length > 0 ? prop.seats : [0];
  return seats
    .map((offset) => prop.x + offset)
    .reduce((best, seatX) => (
      Math.abs(seatX - requestedX) < Math.abs(best - requestedX) ? seatX : best
    ));
}

/**
 * @param {WidgetContext} ctx
 * @param {import("../shared/scene-props.mjs").SceneProp} prop
 */
function applyLocalPropSettle(ctx, prop) {
  const { self } = ctx;
  self.settleRequested = true;
  self.targetX = null;
  self.x = findNearestSeatX(prop, self.x);
  self.pose = prop.pose;
  self.propId = prop.id;
  renderAvatar(self.avatar, self.x);
  updatePose(self.avatar, self.pose);
  updatePropEffects(self.avatar, self.x, self.propId, ctx.sceneProps);
}

/**
 * @param {WidgetContext} ctx
 * @param {number} now
 */
export function maybeRequestPropSettle(ctx, now) {
  const { self, socket } = ctx;
  if (self.pose) return;

  const prop = findSettleProp(ctx.sceneProps, self.x);
  if (!prop) {
    resetPropSettle(ctx);
    return;
  }

  if (self.settlePropId !== prop.id) {
    self.propZoneEnteredAt = now;
    self.settlePropId = prop.id;
    self.settleRequested = false;
  }

  if (self.settleRequested || now - self.propZoneEnteredAt < PROP_SETTLE_MS) {
    return;
  }

  if (ctx.options.preview === true) {
    applyLocalPropSettle(ctx, prop);
    return;
  }

  if (socket.readyState !== WebSocket.OPEN) return;

  self.settleRequested = true;
  socket.send(JSON.stringify({ type: "settle", propId: prop.id }));
}

/**
 * @param {WidgetContext} ctx
 */
export function maybeSendMove(ctx) {
  const { self, socket } = ctx;
  const now = Date.now();
  const movedEnough = Math.abs(self.x - self.lastSentX) > 0.002;
  const waitedLongEnough = now - self.lastSendAt > SEND_INTERVAL_MS;

  if (socket.readyState !== WebSocket.OPEN || !movedEnough || !waitedLongEnough) {
    return;
  }

  self.lastSentX = self.x;
  self.lastSendAt = now;
  socket.send(JSON.stringify({ type: "move", x: self.x }));
}

// Block re-jumping until the current jump animation finishes.
const JUMP_COOLDOWN_MS = JUMP_MS;
const HIGH_FIVE_COOLDOWN_MS = 360;

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target instanceof Element && target.closest("[contenteditable]"));
}

/**
 * @param {WidgetContext} ctx
 */
function clearSelfPoseForAction(ctx) {
  resetPropSettle(ctx);
  ctx.self.pose = null;
  ctx.self.propId = null;
  updatePose(ctx.self.avatar, ctx.self.pose);
  updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId, ctx.sceneProps);
  setWalking(ctx.self.avatar, false);
}

/**
 * @param {WidgetContext} ctx
 */
export function triggerJump(ctx) {
  if (ctx.quiet) return;

  const now = Date.now();
  if (now - ctx.self.lastJumpAt < JUMP_COOLDOWN_MS) return;
  ctx.self.lastJumpAt = now;

  clearSelfPoseForAction(ctx);
  playJump(ctx.self.avatar);

  if (ctx.socket.readyState === WebSocket.OPEN) {
    ctx.socket.send(JSON.stringify({ type: "action", action: "jump" }));
  }
}

/**
 * @param {WidgetContext} ctx
 * @returns {import("./context.mjs").PeerState | null}
 */
function nearestRaisedHandPeer(ctx) {
  let match = null;
  let bestDistance = HIGH_FIVE_DISTANCE;
  for (const peer of ctx.peers.values()) {
    if (!peer.avatar.el.classList.contains("townsquare-avatar--raised-hand")) continue;
    const distance = Math.abs(peer.x - ctx.self.x);
    if (distance > bestDistance) continue;
    match = peer;
    bestDistance = distance;
  }
  return match;
}

/**
 * @param {WidgetContext} ctx
 */
export function triggerHighFive(ctx) {
  if (ctx.quiet) return;

  const now = Date.now();
  if (now - ctx.self.lastHighFiveAt < HIGH_FIVE_COOLDOWN_MS) return;
  ctx.self.lastHighFiveAt = now;

  clearSelfPoseForAction(ctx);

  const peer = nearestRaisedHandPeer(ctx);
  if (peer) {
    setFacing(ctx.self.avatar, peer.x < ctx.self.x);
    setFacing(peer.avatar, ctx.self.x < peer.x);
    playHighFive(ctx.self.avatar);
    playHighFive(peer.avatar);
    if (ctx.socket.readyState === WebSocket.OPEN) {
      ctx.socket.send(JSON.stringify({ type: "action", action: "high-five", targetId: peer.id }));
    }
    return;
  }

  playRaisedHand(ctx.self.avatar);
  if (ctx.socket.readyState === WebSocket.OPEN) {
    ctx.socket.send(JSON.stringify({ type: "action", action: "raise-hand" }));
  }
}

/**
 * @param {WidgetContext} ctx
 * @param {number} now
 */
export function tick(ctx, now) {
  if (ctx.disposed) return;

  const dt = Math.min(0.05, (now - ctx.lastFrameAt) / 1000);
  ctx.lastFrameAt = now;

  if (ctx.quiet) {
    ctx.self.movingLeft = false;
    ctx.self.movingRight = false;
    ctx.self.targetX = null;
    setWalking(ctx.self.avatar, false);
    ctx.frameHandle = requestAnimationFrame((nextNow) => tick(ctx, nextNow));
    return;
  }

  // Held arrow keys always win over a pending tap destination.
  const held = Number(ctx.self.movingRight) - Number(ctx.self.movingLeft);
  if (held !== 0) {
    ctx.self.targetX = null;
  }

  let direction = held;
  let arrived = false;
  if (direction === 0 && ctx.self.targetX !== null) {
    const delta = ctx.self.targetX - ctx.self.x;
    direction = delta < 0 ? -1 : 1;
    arrived = Math.abs(delta) <= MOVEMENT_SPEED * dt;
  }

  if (direction !== 0) {
    resetPropSettle(ctx);
    ctx.self.pose = null;
    ctx.self.propId = null;
    updatePose(ctx.self.avatar, ctx.self.pose);
    ctx.self.x = clampSelfX(arrived ? ctx.self.targetX : ctx.self.x + direction * MOVEMENT_SPEED * dt);
    if (arrived) {
      ctx.self.targetX = null;
    }
    renderAvatar(ctx.self.avatar, ctx.self.x);
    setFacing(ctx.self.avatar, direction < 0);
    updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId, ctx.sceneProps);
    setWalking(ctx.self.avatar, true);
    maybeSendMove(ctx);
  } else {
    setWalking(ctx.self.avatar, false);
    updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId, ctx.sceneProps);
    maybeRequestPropSettle(ctx, now);
  }

  layoutBubbleColumns(
    ctx.stage,
    ctx.options.preview === true || ctx.options.solo === true ? [ctx.self] : [ctx.self, ...ctx.peers.values()],
    ctx.self.x,
    layoutConfigFor(undefined, ctx.expanded),
  );

  ctx.frameHandle = requestAnimationFrame((nextNow) => tick(ctx, nextNow));
}

/**
 * @param {WidgetContext} ctx
 */
export function startGameLoop(ctx) {
  ctx.lastFrameAt = performance.now();
  ctx.frameHandle = requestAnimationFrame((now) => tick(ctx, now));
}

/**
 * @param {WidgetContext} ctx
 */
export function stopGameLoop(ctx) {
  if (ctx.frameHandle !== null) {
    cancelAnimationFrame(ctx.frameHandle);
    ctx.frameHandle = null;
  }
}

/**
 * @param {WidgetContext} ctx
 */
export function wireKeyboard(ctx) {
  ctx.onKeyDown = (event) => {
    if (ctx.quiet) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "ArrowLeft") ctx.self.movingLeft = true;
    if (event.key === "ArrowRight") ctx.self.movingRight = true;
    if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "j") {
      triggerJump(ctx);
    }
    if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "h") {
      triggerHighFive(ctx);
    }
  };

  ctx.onKeyUp = (event) => {
    if (event.key === "ArrowLeft") ctx.self.movingLeft = false;
    if (event.key === "ArrowRight") ctx.self.movingRight = false;
  };

  window.addEventListener("keydown", ctx.onKeyDown);
  window.addEventListener("keyup", ctx.onKeyUp);
}

/**
 * @param {WidgetContext} ctx
 */
export function unwireKeyboard(ctx) {
  window.removeEventListener("keydown", ctx.onKeyDown);
  window.removeEventListener("keyup", ctx.onKeyUp);
}

/**
 * @param {WidgetContext} ctx
 */
export function closeTrays(ctx) {
  for (const peer of ctx.peers.values()) {
    peer.avatar.el.classList.remove("townsquare-avatar--tray-open");
    peer.avatar.el.classList.remove("townsquare-avatar--label-open");
  }
}

/**
 * Tap input on the stage: tapping ground walks there, tapping a character
 * toggles their recent-message tray. Click fires for both mouse and touch and
 * is suppressed by the browser during scroll gestures, so page scrolling
 * through the embed keeps working.
 *
 * @param {WidgetContext} ctx
 */
export function wireStagePointer(ctx) {
  ctx.onStageClick = (event) => {
    if (ctx.quiet) return;

    const target = event.target instanceof Element ? event.target : null;
    const avatarEl = target?.closest(".townsquare-avatar");
    if (avatarEl) {
      // Self taps are handled by the nameplate/composer; peers toggle the tray.
      if (avatarEl.classList.contains("townsquare-avatar--self")) return;
      const open = !avatarEl.classList.contains("townsquare-avatar--tray-open")
        && !avatarEl.classList.contains("townsquare-avatar--label-open");
      closeTrays(ctx);
      if (open) {
        avatarEl.classList.add("townsquare-avatar--label-open");
      }
      if (open && avatarEl.classList.contains("townsquare-avatar--has-history")) {
        avatarEl.classList.add("townsquare-avatar--tray-open");
      }
      return;
    }

    closeTrays(ctx);
    const rect = ctx.stage.getBoundingClientRect();
    if (rect.width <= 0) return;
    ctx.self.targetX = clampSelfX((event.clientX - rect.left) / rect.width);
  };

  ctx.stage.addEventListener("click", ctx.onStageClick);
}

/**
 * @param {WidgetContext} ctx
 */
export function unwireStagePointer(ctx) {
  ctx.stage.removeEventListener("click", ctx.onStageClick);
}
