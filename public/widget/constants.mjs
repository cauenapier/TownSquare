/**
 * Shared timing, movement, and scene constants for the embeddable widget.
 */

import { PROPS } from "../scene-props.mjs";

export { PROPS };

export const BUBBLE_TTL_MS = 6000;
export const BROWSER_ID_KEY = "townsquare-browser-id";
export const PROFILE_STORAGE_KEY = "townsquare-profile";
export const PROP_SETTLE_MS = 700;
export const MAX_RECENT_MESSAGES = 5;
export const DISPLAY_NAME_MAX = 18;
export const READING_LABEL_MAX = 42;
/** Most bubbles kept visible in a figure's ghost stack (live + lingering ghosts). */
export const GHOST_STACK_MAX = 4;
export const MOVEMENT_SPEED = 0.22;
export const SEND_INTERVAL_MS = 45;
export const MIN_X = 0.02;
export const MAX_X = 0.98;
export const CHARACTER_COLORS = [
  "#c8641f",
  "#3f7f63",
  "#3f6fb5",
  "#8a5fb1",
  "#b44f6f",
  "#5f6b73",
];

/** @returns {number} */
export function randomSpawnX() {
  return MIN_X + Math.random() * (MAX_X - MIN_X);
}

export const INTERACTIVE_PROPS = PROPS.filter((prop) => prop.pose && prop.zoneRadius > 0);
