/**
 * Soccer ball — the client view of the scene's shared, server-simulated ball.
 *
 * The server owns the physics (one ball per scene; kicked when a figure runs
 * into it, rolled with gravity arc + friction + edge bounce) and broadcasts the
 * ball's position as `{ type: "ball", x, y, vx, vy }` frames, with the current
 * position also seeded in the `hello` payload. This module just renders that:
 * `x` (0..1) maps to `left` like figures and birds, `y` (height units) lifts the
 * ball off the ground line. A short CSS transition smooths the 50ms frames.
 *
 * @typedef {import("./context.mjs").WidgetContext & { ballEl?: HTMLElement }} BallContext
 */

/** Pixels of lift per unit of ball height (y). Loft caps near 1.6 -> ~74px arc. */
const BALL_LIFT_PX = 46;

/**
 * @param {HTMLElement} stage
 * @returns {HTMLElement}
 */
function mountBall(stage) {
  const el = document.createElement("div");
  el.className = "townsquare__ball";
  el.setAttribute("aria-hidden", "true");
  stage.appendChild(el);
  return el;
}

/**
 * @param {BallContext} ctx
 */
export function initBall(ctx) {
  ctx.ballEl = mountBall(ctx.stage);
}

/**
 * Apply a ball position frame (from a `ball` message or the `hello` snapshot).
 * @param {BallContext} ctx
 * @param {{ x?: number, y?: number } | null | undefined} ball
 */
export function applyBallState(ctx, ball) {
  if (!ctx.ballEl || !ball || typeof ball.x !== "number") return;
  const lift = typeof ball.y === "number" ? Math.max(0, ball.y) * BALL_LIFT_PX : 0;
  ctx.ballEl.style.setProperty("--ball-x", String(ball.x));
  ctx.ballEl.style.setProperty("--ball-lift", `${lift.toFixed(1)}px`);
}

/**
 * @param {BallContext} ctx
 */
export function destroyBall(ctx) {
  ctx.ballEl?.remove();
  ctx.ballEl = undefined;
}
