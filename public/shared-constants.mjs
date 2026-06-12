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

export const CHARACTER_COLORS = [
  "#5f6b73",
  "#c8641f",
  "#3f7f63",
  "#3f6fb5",
  "#8a5fb1",
  "#b44f6f",
];

export const DEFAULT_CHARACTER_COLOR = CHARACTER_COLORS[0];

/** @returns {number} */
export function randomSpawnX() {
  return MIN_X + Math.random() * (MAX_X - MIN_X);
}
