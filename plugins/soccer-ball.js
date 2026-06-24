"use strict";

/**
 * Soccer ball — the first interactive scene-entity plugin.
 *
 * One server-authoritative ball per scene. Any visitor who runs into it kicks
 * it away, harder and higher the faster they were moving (capped); the server
 * rolls it on the shared entity tick (gravity arc + friction + edge bounce) and
 * broadcasts its position only while it moves. A rolling ball that reaches a
 * figure traps at their feet. Clients never send ball messages — they kick by
 * moving — so the ball is fully server-driven via the scene-entity contract
 * (see docs/plugins.md and docs/ideas/scene-entity-plugins.md).
 *
 * All physics lives here; the widget module only renders the x/y the server
 * sends, so the client needs none of these constants.
 */
const BALL = {
  START_X: 0.5, // seeds at mid-square
  KICK_RADIUS: 0.05, // run within this of the ball to kick it
  TRAP_RADIUS: 0.04, // a rolling ball this close to a figure stops at their feet
  KICK_BASE: 0.12, // horizontal nudge at a slow walk
  KICK_GAIN: 0.85, // extra horizontal per unit of figure speed
  KICK_MAX: 0.5, // cap so a sprint still isn't a cannon
  LOFT_BASE: 0.5, // small hop at a slow walk
  LOFT_GAIN: 2.0, // extra loft per unit of figure speed
  LOFT_MAX: 1.6, // cap on arc height
  GRAVITY: 4.0, // downward accel (height-units/sec^2)
  BOUNCE: 0.4, // vertical restitution on landing
  EDGE_BOUNCE: 0.5, // horizontal restitution off the side walls
  FRICTION: 0.9, // horizontal velocity retained per ground tick
  REST_VX: 0.04, // |vx| below this on the ground -> at rest
  REST_VY: 0.06, // |vy| below this on landing -> stop bouncing
};

const FRAME_KEY = "soccer-ball";

function frame(state) {
  return { x: state.x, y: state.y };
}

/**
 * Kick the ball away from a figure that ran into it — harder and higher the
 * faster the figure was moving (capped). Returns true if it kicked.
 */
function kick(state, playerX, speed) {
  if (Math.abs(playerX - state.x) >= BALL.KICK_RADIUS) return false;
  const dir = state.x < playerX ? -1 : 1;
  state.vx = dir * Math.min(BALL.KICK_BASE + speed * BALL.KICK_GAIN, BALL.KICK_MAX);
  state.vy = Math.min(BALL.LOFT_BASE + speed * BALL.LOFT_GAIN, BALL.LOFT_MAX);
  return true;
}

function createSoccerBallPlugin() {
  return {
    name: FRAME_KEY,
    widgetModule: "/widget/plugins/soccer-ball.mjs",

    sceneEntity: {
      create() {
        return { x: BALL.START_X, y: 0, vx: 0, vy: 0 };
      },

      snapshot({ state }) {
        return frame(state);
      },

      tick({ state, figures, bounds, dtMs, emit }) {
        if (state.vx === 0 && state.vy === 0 && state.y === 0) return;
        const dt = (dtMs || 50) / 1000;
        const minX = bounds?.minX ?? 0;
        const maxX = bounds?.maxX ?? 1;

        // Horizontal travel + edge bounce.
        state.x += state.vx * dt;
        if (state.x < minX) {
          state.x = minX;
          state.vx = -state.vx * BALL.EDGE_BOUNCE;
        } else if (state.x > maxX) {
          state.x = maxX;
          state.vx = -state.vx * BALL.EDGE_BOUNCE;
        }

        // Vertical: gravity arc + landing bounce.
        state.y += state.vy * dt;
        state.vy -= BALL.GRAVITY * dt;
        if (state.y <= 0) {
          state.y = 0;
          if (state.vy < 0) state.vy = -state.vy * BALL.BOUNCE;
          if (Math.abs(state.vy) < BALL.REST_VY) state.vy = 0;
        }

        // Rolling friction + trap, only while on the ground.
        if (state.y === 0) {
          state.vx *= BALL.FRICTION;
          if (Math.abs(state.vx) < BALL.REST_VX) state.vx = 0;
          if (state.vx !== 0) {
            for (const figure of figures || []) {
              if (Math.abs(figure.x - state.x) < BALL.TRAP_RADIUS) {
                state.x = figure.x;
                state.vx = 0;
                state.vy = 0;
                break;
              }
            }
          }
        }

        emit(frame(state));
      },
    },

    onSceneMove({ state, x, speed, emit }) {
      if (!state) return;
      if (kick(state, x, speed)) emit(frame(state));
    },
  };
}

module.exports = { createSoccerBallPlugin };
