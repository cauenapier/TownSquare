/**
 * Soccer ball — the client view of the scene's shared, server-simulated ball.
 *
 * The server owns the physics (one ball per scene, kicked when a figure runs
 * into it) and streams `{ type: "plugin", plugin: "soccer-ball", x, y }` frames
 * via the scene-entity contract, with the current position seeded in `hello`.
 * This module just renders that: `x` (0..1) maps to `left` like figures and
 * birds, `y` (height units) lifts the ball off the ground line. A short CSS
 * transition smooths the server's 50ms frames. `--ball-fill` / `--ball-ink` are
 * overridable so a customized square can re-skin it.
 */

// Pixels of lift per unit of ball height (y). Loft caps near 1.6 -> ~74px arc.
const BALL_LIFT_PX = 46;
const BALL_DIAMETER_PX = 13;
const BALL_CIRCUMFERENCE_PX = Math.PI * BALL_DIAMETER_PX;

export function mountWidgetPlugin({ stage }) {
  let previousX = null;
  let rotation = 0;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `
    position: absolute;
    left: calc(var(--ball-x, 0.5) * 100%);
    bottom: calc(var(--ts-ground-level) + var(--ball-lift, 0px));
    width: ${BALL_DIAMETER_PX}px;
    height: ${BALL_DIAMETER_PX}px;
    border-radius: 50%;
    transform: translateX(-50%) rotate(var(--ball-rotation, 0deg));
    transition: left 55ms linear, bottom 55ms linear, transform 55ms linear;
    z-index: 1;
    pointer-events: none;
    border: 1px solid color-mix(in oklab, var(--ball-ink, #1a1a1a) 70%, transparent);
    background:
      radial-gradient(circle at 50% 50%, var(--ball-ink, #1a1a1a) 0 2px, transparent 2.6px),
      radial-gradient(circle at 26% 32%, var(--ball-ink, #1a1a1a) 0 1.3px, transparent 1.7px),
      radial-gradient(circle at 74% 32%, var(--ball-ink, #1a1a1a) 0 1.3px, transparent 1.7px),
      radial-gradient(circle at 30% 74%, var(--ball-ink, #1a1a1a) 0 1.3px, transparent 1.7px),
      radial-gradient(circle at 72% 72%, var(--ball-ink, #1a1a1a) 0 1.3px, transparent 1.7px),
      var(--ball-fill, #fff);
  `;
  stage.appendChild(el);

  return {
    applyEntity(frame) {
      if (!frame || typeof frame.x !== "number") return;
      const lift = typeof frame.y === "number" ? Math.max(0, frame.y) * BALL_LIFT_PX : 0;
      if (previousX !== null) {
        const distancePx = (frame.x - previousX) * stage.clientWidth;
        rotation += distancePx / BALL_CIRCUMFERENCE_PX * 360;
        el.style.setProperty("--ball-rotation", `${rotation.toFixed(1)}deg`);
      }
      previousX = frame.x;
      el.style.setProperty("--ball-x", String(frame.x));
      el.style.setProperty("--ball-lift", `${lift.toFixed(1)}px`);
    },
    destroy() {
      el.remove();
    },
  };
}
