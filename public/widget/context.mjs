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
 * @property {number | null} targetX Pointer-selected walk destination; null when none.
 * @property {number} lastSentX
 * @property {number} lastSendAt
 * @property {number} lastSayAt
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
 * @property {boolean} isOwner
 * @property {string} badgeColor
 * @property {Record<string, any>} plugins Namespaced server plugin data.
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
 * @property {boolean} isOwner
 * @property {string} badgeColor
 * @property {Record<string, any>} plugins Namespaced server plugin data.
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
 * @property {import("./chat.mjs").ChatScope} chat Per-mount chat state shared by all avatars.
 * @property {Array<import("../shared/scene-props.mjs").SceneProp>} sceneProps
 * @property {Map<string, import("../shared/scene-props.mjs").SceneProp>} propsById
 * @property {Map<string, import("../shared/bird-perches.mjs").BirdPerch>} birdPerchesById
 * @property {number} chatThrottleMs Slow-mode cooldown from the server.
 * @property {ReturnType<import("./plugins.mjs").createWidgetPluginRuntime>} widgetPlugins
 * @property {ReturnType<typeof setTimeout> | null} reconnectTimer
 * @property {ReturnType<typeof setTimeout> | null} typingTimer
 * @property {ReturnType<typeof setTimeout> | null} [cooldownHintTimer]
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
 * @property {(event: PointerEvent) => void} onStagePointerDown
 * @property {(event: PointerEvent) => void} onStagePointerMove
 * @property {(event: PointerEvent) => void} onStagePointerUp
 * @property {(event: PointerEvent) => void} onStagePointerCancel
 * @property {(event: MouseEvent) => void} onStageClick
 * @property {Map<number, import("./birds.mjs").BirdView>} [birds]
 * @property {HTMLElement} [birdLayer]
 * @property {HTMLElement} [cloudLayer]
 * @property {{ left: Array<import("../shared/site-config.mjs").Connection>, right: Array<import("../shared/site-config.mjs").Connection> } | null} [connectionsBySide]
 * @property {{ left: HTMLButtonElement | null, right: HTMLButtonElement | null } | null} [signposts]
 * @property {{ overlay: HTMLElement, onKeyDown: (event: KeyboardEvent) => void, trigger: HTMLButtonElement | null } | null} [connectionsModal]
 * @property {"left"|"right"|null} [nearSide] Edge whose signpost the avatar can currently activate.
 * @property {{ board: import("../shared/site-config.mjs").MessageBoard, signature: string, button: HTMLButtonElement, modal: { overlay: HTMLElement, onKeyDown: (event: KeyboardEvent) => void, trigger: HTMLButtonElement | null } | null } | null} [messageBoard]
 * @property {{ scene: boolean, connections: boolean, messageBoard: boolean }} [inlineConfig] Which config fields the host pinned inline (power-user overrides that live updates must not touch).
 * @property {(config?: { scene?: unknown, connections?: unknown, messageBoard?: unknown }) => void} [applyLiveConfig] Apply server-pushed config, honouring inline overrides.
 */

export {};
