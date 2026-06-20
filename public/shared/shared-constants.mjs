/**
 * Wire-protocol limits and the character palette shared by server and widget.
 *
 * The server (CommonJS) loads this module dynamically at startup, the same way
 * it loads scene-props.mjs, so both sides of the protocol stay in lockstep.
 */

export const MIN_X = 0.02;
export const MAX_X = 0.98;
export const MESSAGE_MAX = 140;
export const DISPLAY_NAME_MAX = 18;
export const READING_LABEL_MAX = 42;
export const MAX_RECENT_MESSAGES = 5;
export const HIGH_FIVE_DISTANCE = 0.07;

/**
 * Soccer ball — a shared kickable object. One per scene: any visitor who runs
 * into it kicks it away, harder and higher the faster they were moving (capped),
 * and the server rolls it on a fast tick (gravity arc + friction + edge bounce),
 * broadcasting its position while it moves and staying silent at rest. A rolling
 * ball that reaches a figure traps at their feet. Physics constants are shared so
 * the client can interpolate between server frames with matching numbers.
 */
export const BALL_TICK_MS = 50; // server simulation step (smoother than birds)
export const BALL_KICK_RADIUS = 0.05; // run within this of the ball to kick it
export const BALL_TRAP_RADIUS = 0.04; // a rolling ball this close to a figure stops at their feet
export const BALL_KICK_BASE = 0.12; // horizontal nudge at a slow walk
export const BALL_KICK_GAIN = 0.85; // extra horizontal per unit of figure speed
export const BALL_KICK_MAX = 0.5; // cap so a sprint still isn't a cannon
export const BALL_LOFT_BASE = 0.5; // small hop at a slow walk
export const BALL_LOFT_GAIN = 2.0; // extra loft per unit of figure speed
export const BALL_LOFT_MAX = 1.6; // cap on arc height
export const BALL_GRAVITY = 4.0; // downward accel (height-units/sec^2)
export const BALL_BOUNCE = 0.4; // vertical restitution on landing
export const BALL_EDGE_BOUNCE = 0.5; // horizontal restitution off the side walls
export const BALL_FRICTION = 0.9; // horizontal velocity retained per ground tick
export const BALL_REST_VX = 0.04; // |vx| below this on the ground -> at rest
export const BALL_REST_VY = 0.06; // |vy| below this on landing -> stop bouncing
export const BALL_START_X = 0.5; // ball seeds at mid-square

export const CHARACTER_COLORS = [
  "#5f6b73",
  "#c8641f",
  "#3f7f63",
  "#3f6fb5",
  "#8a5fb1",
  "#b44f6f",
];

export const DEFAULT_CHARACTER_COLOR = CHARACTER_COLORS[0];

/** Soft fills for the verified owner nameplate; first entry matches the stock gold tint. */
export const OWNER_BADGE_COLORS = [
  "#f2e8c8",
  "#fdf8f4",
  "#e8eef5",
  "#e5f0e8",
  "#f5e8ec",
  "#ebe5f2",
];

export const DEFAULT_OWNER_BADGE_COLOR = OWNER_BADGE_COLORS[0];

/**
 * @param {() => number} [random] Generator in [0, 1); pass a seeded one for reproducible scenes.
 * @returns {number}
 */
export function randomSpawnX(random = Math.random) {
  return MIN_X + random() * (MAX_X - MIN_X);
}
