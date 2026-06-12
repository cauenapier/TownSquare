/**
 * Keyboard input, local movement animation, and prop settle requests.
 */

import { layoutBubbleColumns } from "./bubble-layout.mjs";
import { INTERACTIVE_PROPS, MAX_X, MIN_X, MOVEMENT_SPEED, PROP_SETTLE_MS, SEND_INTERVAL_MS } from "./constants.mjs";
import { renderAvatar, setFacing, setWalking, updatePose, updatePropEffects } from "./dom.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * @param {number} x
 * @returns {number}
 */
export function clampSelfX(x) {
  return Math.max(MIN_X, Math.min(MAX_X, x));
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
 * @param {WidgetContext} ctx
 * @param {number} now
 */
export function maybeRequestPropSettle(ctx, now) {
  const { self, socket } = ctx;
  if (self.pose) return;
  if (socket.readyState !== WebSocket.OPEN) return;

  const prop = INTERACTIVE_PROPS.find((candidate) => (
    Math.abs(self.x - candidate.x) < candidate.zoneRadius
  ));
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

/**
 * @param {WidgetContext} ctx
 */
export function markLayoutDirty(ctx) {
  ctx.layoutDirty = true;
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
    setWalking(ctx.self.avatar, false);
    ctx.frameHandle = requestAnimationFrame((nextNow) => tick(ctx, nextNow));
    return;
  }

  const direction = Number(ctx.self.movingRight) - Number(ctx.self.movingLeft);
  if (direction !== 0) {
    resetPropSettle(ctx);
    ctx.self.pose = null;
    ctx.self.propId = null;
    updatePose(ctx.self.avatar, ctx.self.pose);
    ctx.self.x = clampSelfX(ctx.self.x + direction * MOVEMENT_SPEED * dt);
    renderAvatar(ctx.self.avatar, ctx.self.x);
    setFacing(ctx.self.avatar, direction < 0);
    updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId);
    setWalking(ctx.self.avatar, true);
    maybeSendMove(ctx);
  } else {
    setWalking(ctx.self.avatar, false);
    updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId);
    maybeRequestPropSettle(ctx, now);
  }

  const presences = [ctx.self, ...ctx.peers.values()];
  const moving = ctx.self.movingLeft || ctx.self.movingRight;
  const hasBubbles = presences.some((presence) => presence.avatar.above.childElementCount > 0);
  if (hasBubbles && (moving || ctx.layoutDirty)) {
    layoutBubbleColumns(ctx.stage, presences, ctx.self.x);
    ctx.layoutDirty = false;
  }

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
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft") ctx.self.movingLeft = true;
    if (event.key === "ArrowRight") ctx.self.movingRight = true;
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
