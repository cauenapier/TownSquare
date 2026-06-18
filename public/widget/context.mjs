/**
 * Shared runtime context passed between widget modules during a mount.
 *
 * Keeping mount state in one object avoids hidden closure coupling and makes
 * new modules easy to add without rewriting the orchestrator.
 */

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 */

/**
 * @typedef {Object} SelfState
 * @property {string | null} id
 * @property {number} x
 * @property {boolean} movingLeft
 * @property {boolean} movingRight
 * @property {number | null} targetX Tap-to-walk destination; null when none.
 * @property {number} lastSentX
 * @property {number} lastSendAt
 * @property {number} lastJumpAt
 * @property {number} lastHighFiveAt
 * @property {string | null} pose
 * @property {string | null} propId
 * @property {string} displayName
 * @property {string} color
 * @property {string} readingLabel
 * @property {string} readingUrl
 * @property {boolean} readingActive
 * @property {boolean} typing
 * @property {number} propZoneEnteredAt
 * @property {string | null} settlePropId
 * @property {boolean} settleRequested
 * @property {AvatarView} avatar
 * @property {ReturnType<typeof setTimeout> | null} walkTimer
 */

/**
 * @typedef {Object} PeerState
 * @property {string} id
 * @property {number} x
 * @property {string | null} pose
 * @property {string | null} propId
 * @property {string} displayName
 * @property {string} color
 * @property {string} readingLabel
 * @property {string} readingUrl
 * @property {boolean} readingActive
 * @property {AvatarView} avatar
 * @property {ReturnType<typeof setTimeout> | null} walkTimer
 */

/**
 * @typedef {Object} WidgetContext
 * @property {HTMLElement} root
 * @property {import("../townsquare.mjs").MountOptions} options
 * @property {string} serverOrigin
 * @property {string} socketUrl
 * @property {string} browserId
 * @property {Map<string, PeerState>} peers
 * @property {Array<import("../shared/scene-props.mjs").SceneProp>} sceneProps
 * @property {Map<string, import("../shared/scene-props.mjs").SceneProp>} propsById
 * @property {Map<string, import("../shared/bird-perches.mjs").BirdPerch>} birdPerchesById
 * @property {ReturnType<typeof setTimeout> | null} reconnectTimer
 * @property {ReturnType<typeof setTimeout> | null} typingTimer
 * @property {HTMLElement} app
 * @property {HTMLElement} stage
 * @property {HTMLElement} statusRowEl
 * @property {HTMLElement} statusEl
 * @property {HTMLButtonElement} quietButton
 * @property {HTMLButtonElement} expandButton
 * @property {SelfState} self
 * @property {WebSocket} socket
 * @property {boolean} quiet
 * @property {boolean} expanded
 * @property {boolean} disposed
 * @property {number} lastFrameAt
 * @property {number | null} frameHandle
 * @property {(event: KeyboardEvent) => void} onKeyDown
 * @property {(event: KeyboardEvent) => void} onKeyUp
 * @property {(event: MouseEvent) => void} onStageClick
 * @property {Map<number, import("./birds.mjs").BirdView>} [birds]
 * @property {HTMLElement} [birdLayer]
 */

export {};
