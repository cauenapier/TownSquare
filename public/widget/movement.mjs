/**
 * Keyboard input, local movement animation, and prop settle requests.
 */

import { layoutBubbleColumns } from "./bubble-layout.mjs";
import { BENCH, BENCH_SETTLE_MS, MAX_X, MIN_X, MOVEMENT_SPEED, SEND_INTERVAL_MS } from "./constants.mjs";
import { renderAvatar, setFacing, setWalking, updatePose } from "./dom.mjs";

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
export function resetBenchSettle(ctx) {
  ctx.self.benchZoneEnteredAt = 0;
  ctx.self.benchRequested = false;
}

/**
 * @param {WidgetContext} ctx
 * @param {number} now
 */
export function maybeRequestBenchSettle(ctx, now) {
  const { self, socket } = ctx;
  if (self.pose === "sitting") return;
  if (socket.readyState !== WebSocket.OPEN) return;

  const isNearBench = Math.abs(self.x - BENCH.x) < BENCH.zoneRadius;
  if (!isNearBench) {
    resetBenchSettle(ctx);
    return;
  }

  if (!self.benchZoneEnteredAt) {
    self.benchZoneEnteredAt = now;
  }

  if (self.benchRequested || now - self.benchZoneEnteredAt < BENCH_SETTLE_MS) {
    return;
  }

  self.benchRequested = true;
  socket.send(JSON.stringify({ type: "settle", propId: BENCH.id }));
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
    resetBenchSettle(ctx);
    ctx.self.pose = null;
    ctx.self.propId = null;
    updatePose(ctx.self.avatar, ctx.self.pose);
    ctx.self.x = clampSelfX(ctx.self.x + direction * MOVEMENT_SPEED * dt);
    renderAvatar(ctx.self.avatar, ctx.self.x);
    setFacing(ctx.self.avatar, direction < 0);
    setWalking(ctx.self.avatar, true);
    maybeSendMove(ctx);
  } else {
    setWalking(ctx.self.avatar, false);
    maybeRequestBenchSettle(ctx, now);
  }

  layoutBubbleColumns(ctx.stage, [ctx.self, ...ctx.peers.values()], ctx.self.x);

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
