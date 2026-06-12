/**
 * Shared timing, movement, and scene constants for the embeddable widget.
 */

import { PROPS } from "../scene-props.mjs";

export { PROPS };
export {
  CHARACTER_COLORS,
  DEFAULT_CHARACTER_COLOR,
  DISPLAY_NAME_MAX,
  MAX_RECENT_MESSAGES,
  MAX_X,
  MESSAGE_MAX,
  MIN_X,
  READING_LABEL_MAX,
  randomSpawnX,
} from "../shared-constants.mjs";

export const BUBBLE_TTL_MS = 6000;
export const BROWSER_ID_KEY = "townsquare-browser-id";
export const PROFILE_STORAGE_KEY = "townsquare-profile";
export const PROP_SETTLE_MS = 700;
/** Most bubbles kept visible in a figure's ghost stack (live + lingering ghosts). */
export const GHOST_STACK_MAX = 4;
export const MOVEMENT_SPEED = 0.22;
export const SEND_INTERVAL_MS = 45;

export const INTERACTIVE_PROPS = PROPS.filter((prop) => prop.pose && prop.zoneRadius > 0);
