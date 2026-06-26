/**
 * The TownSquare realtime protocol vocabulary — the single source of truth for
 * WebSocket message `type` values (and the `action` sub-verbs) shared by the
 * browser widget and the Node server. Importing these on both sides makes a
 * rename fail loudly at the import instead of silently dropping frames.
 */

/** WebSocket message types. */
export const MSG = Object.freeze({
  // client → server
  INIT: "init",
  MOVE: "move",
  SETTLE: "settle",
  SAY: "say",
  TYPING: "typing",
  ACTION: "action",
  PROFILE: "profile",
  READING: "reading",
  SCENE_CONFIG: "sceneConfig",
  SOLVE: "solve",
  // server → client
  HELLO: "hello",
  JOIN: "join",
  LEAVE: "leave",
  CHALLENGE: "challenge",
  CHAT_THROTTLE: "chatThrottle",
  BIRD: "bird",
});

/** `action`-message gesture verbs. */
export const GESTURE = Object.freeze({
  JUMP: "jump",
  RAISE_HAND: "raise-hand",
  HIGH_FIVE: "high-five",
});

/** `bird`-message verbs. */
export const BIRD_ACTION = Object.freeze({
  SPAWN: "spawn",
  FLEE: "flee",
});
