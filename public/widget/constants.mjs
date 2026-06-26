/**
 * Shared timing and movement constants for the embeddable widget.
 */

export {
  CHARACTER_COLORS,
  DEFAULT_CHARACTER_COLOR,
  DISPLAY_NAME_MAX,
  HIGH_FIVE_DISTANCE,
  MAX_RECENT_MESSAGES,
  MAX_X,
  MESSAGE_MAX,
  MIN_X,
  READING_LABEL_MAX,
  randomSpawnX,
} from "../shared/shared-constants.mjs";

/** Fallback chat cooldown before the server's live value arrives in `hello`. */
export const DEFAULT_CHAT_THROTTLE_MS = 500;
export const BUBBLE_TTL_MS = 6000;
/** Bubble linger time in expanded (fullscreen) mode — more room to read the scene. */
export const BUBBLE_TTL_EXPANDED_MS = 12_000;
/** URL hash flag that reveals the owner-claim hint ("You're visitor #N"). */
export const OWNER_SETUP_HASH = "townsquare-owner";
export const BROWSER_ID_KEY = "townsquare-browser-id";
export const BROWSER_SECRET_KEY = "townsquare-browser-secret";
export const PROFILE_STORAGE_KEY = "townsquare-profile";
/** Prefix for the per-site "last read message board message" marker. */
export const MESSAGE_BOARD_READ_KEY = "townsquare-msgboard-read";
export const PROP_SETTLE_MS = 700;
/** Most bubbles kept visible in a figure's ghost stack (live + lingering ghosts). */
export const GHOST_STACK_MAX = 4;
/** Ghost stack cap in expanded mode — the taller stage can carry more lines. */
export const GHOST_STACK_MAX_EXPANDED = 7;
/** Hover-tray history cap in expanded mode. */
export const MAX_RECENT_MESSAGES_EXPANDED = 10;
export const MOVEMENT_SPEED = 0.22;
export const SEND_INTERVAL_MS = 45;
export const RAISED_HAND_MS = 5000;
export const HIGH_FIVE_MS = 760;
/** Time for a seated/resting figure to stand before an action animation; matches widget.css pose transition. */
export const POSE_STAND_MS = 220;
/** Jump animation length; matches the jump keyframe in widget.css. Doubles as the re-jump cooldown. */
export const JUMP_MS = 560;
