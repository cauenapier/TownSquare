/**
 * TownSquare embeddable widget — public mount API.
 *
 * Host pages import this module and call `mountTownSquare` on a DOM node.
 * Implementation lives under `public/widget/` and is split by concern so
 * new scene features can grow without turning the mount file into a monolith.
 */

import { createChatScope, setLocalTyping, submitChat } from "./widget/chat.mjs";
import { initBirds, destroyBirds, syncBirdPerches } from "./widget/birds.mjs";
import { initClouds, destroyClouds } from "./widget/clouds.mjs";
import { setupConnections, teardownConnections } from "./widget/connections.mjs";
import { setupMessageBoard, teardownMessageBoard } from "./widget/message-board.mjs";
import { CHARACTER_COLORS, DEFAULT_CHAT_THROTTLE_MS, MAX_X, MIN_X, randomSpawnX } from "./widget/constants.mjs";
import { createExpandController } from "./widget/expand.mjs";
import { MSG } from "./shared/protocol.mjs";
import {
  createAvatar,
  renderAvatar,
  renderProps,
  renderShell,
  wireHelpPanel,
  updatePose,
  updatePropEffects,
} from "./widget/dom.mjs";
import { watchCurrentPage } from "./widget/page-watch.mjs";
import { createWidgetPluginRuntime } from "./widget/plugins.mjs";
import {
  closeTrays,
  startGameLoop,
  stopGameLoop,
  triggerHighFive,
  triggerJump,
  unwireKeyboard,
  unwireStagePointer,
  wireKeyboard,
  wireStagePointer,
} from "./widget/movement.mjs";
import { setStatusMessage, updateStatus } from "./widget/presence.mjs";
import { wireSocket } from "./widget/protocol.mjs";
import {
  applySiteStyle,
  buildBirdPerches,
  buildSceneProps,
  DEFAULT_SCENE_CONFIG,
  sanitizeSceneConfig,
} from "./shared/site-config.mjs";
import {
  applyWidgetTheme,
  buildSocketUrl,
  getBrowserId,
  getStoredProfile,
  normalizeOrigin,
  readCurrentPage,
  resolveWidgetTheme,
  saveStoredProfile,
} from "./widget/utils.mjs";

/**
 * @typedef {Object} MountOptions
 * @property {string} [serverOrigin] TownSquare server origin for static assets and WebSocket traffic.
 * @property {string} [socketPath="/live"] WebSocket path on the server origin.
 * @property {string} [siteKey] Hosted TownSquare site key. Self-hosted embeds can omit it.
 * @property {{ benches?: number, trees?: number, lamps?: number, branches?: number, benchXs?: number[], treeXs?: number[], lampXs?: number[], branchXs?: number[] }} [scene] Scene prop counts and optional per-prop X positions (0..1).
 * @property {{ scene?: string, page?: string, surface?: string, ink?: string, accent?: string, treeTrunk?: string, treeCanopy?: string, other?: string, ground?: string }} [style] A single flat palette written as inline CSS variables on the mount root. Pass this only when you want JS to own the palette for the current `theme` (e.g. the live preview). Omit it to theme via CSS instead — set the same tokens (`--scene`, `--page`, `--surface`, `--ink`, `--you`, `--tree-trunk`, `--tree-canopy`, `--other`, `--ground`) on `#townsquare-root` in your own stylesheet; when `style` is absent the widget writes nothing inline so your rules win.
 * @property {string} [readingLabel] Explicit page label. Defaults to the page heading, then document title.
 * @property {string} [readingUrl] Explicit page URL. Defaults to the current browser URL.
 * @property {"auto" | "light" | "dark" | "host"} [theme="auto"] Widget palette. `auto` follows `prefers-color-scheme`; `host` follows common host-page dark mode signals.
 * @property {boolean} [preview=false] Static customization preview: fixed spawn, local prop settle, no socket, in-place scene/style updates via the mount handle.
 * @property {boolean} [solo=false] Live socket, but hide other visitors on the client.
 * @property {boolean} [watch=false] Livestream-overlay mode: live socket, render the real crowd (peers, birds, scene), but do not place or move a self avatar and send nothing. The Plus overlay page uses this mode.
 * @property {boolean} [simulate=false] Dev simulation harness: no socket and local prop settle (like `preview`), but peers and birds stay visible so the scene matches production. The caller drives simulated peers through the exposed `ctx`.
 * @property {import("./widget/bubble-layout.mjs").LayoutConfig} [layout] Live reading-experience dials read by the loop every frame. Omit in production to run on the defaults; the dev scene passes a mutable object its sliders edit in place.
 * @property {Array<{ side: "left"|"right", label?: string, url: string }>} [connections] Neighbouring towns linked at the stage edges. Each grows a signpost on its side that opens a "walk over" modal.
 * @property {{ enabled?: boolean, x?: number, variant?: string, accent?: string, title?: string, body?: string }} [messageBoard] Owner message board: a single clickable prop that opens a modal with the owner's note. Sanitized client-side; disabled when blank.
 * @property {Array<{ name: string, module: string }>} [pluginModules] Trusted widget feature modules registered by the TownSquare server.
 */

/**
 * @typedef {Object} TownSquareHandle
 * @property {(config?: { scene?: MountOptions["scene"], style?: MountOptions["style"], connections?: MountOptions["connections"], messageBoard?: MountOptions["messageBoard"] }) => void} updateConfig Refresh scene props, style tokens, neighbour connections, and/or the message board without remounting.
 * @property {() => void} destroy Tear down listeners, animation, socket, and mounted DOM.
 * @property {import("./widget/context.mjs").WidgetContext} ctx Live mount context. Exposed for the dev simulation harness to drive peers; host pages should not touch it.
 */

const PREVIEW_SPAWN_X = (MIN_X + MAX_X) / 2;
const MOBILE_KEYBOARD_SCROLL_GAP = 12;
const MOBILE_KEYBOARD_MIN_HEIGHT = 60;

// Hosted sites receive their scene from the server on connect, so we start them
// empty rather than flashing the stock default props before the real scene
// arrives. Self-hosted embeds with no server config keep the stock default.
const EMPTY_SCENE_CONFIG = { benches: 0, trees: 0, lamps: 0, birds: 0 };

/**
 * @param {VisualViewport | undefined} viewport
 */
function getKeyboardInset(viewport) {
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

/**
 * When a docked mobile input focuses near the bottom of a long page, browsers
 * keep the input reachable but may still leave the square's lower edge behind
 * the virtual keyboard. Scroll the page just enough to reveal the whole widget.
 *
 * @param {HTMLElement} app
 * @param {VisualViewport | undefined} viewport
 * @param {boolean} expanded
 */
function revealAppAboveKeyboard(app, viewport, expanded) {
  if (!(app instanceof HTMLElement) || !viewport) return;
  if (!(document.activeElement instanceof HTMLElement) || !app.contains(document.activeElement)) return;
  const keyboardInset = getKeyboardInset(viewport);
  if (keyboardInset < MOBILE_KEYBOARD_MIN_HEIGHT) return;
  if (expanded) {
    const visibleBottom = viewport.offsetTop + viewport.height;
    const overlap = app.getBoundingClientRect().bottom + MOBILE_KEYBOARD_SCROLL_GAP - visibleBottom;
    if (overlap > 0) {
      app.scrollBy({ top: overlap, behavior: "auto" });
    }
    return;
  }
  const appBottom = window.scrollY + app.getBoundingClientRect().bottom;
  const visibleBottom = window.scrollY + viewport.offsetTop + viewport.height;
  const overlap = appBottom + MOBILE_KEYBOARD_SCROLL_GAP - visibleBottom;
  if (overlap > 0) {
    window.scrollBy({ top: overlap, behavior: "auto" });
  }
}

/**
 * @param {import("./widget/context.mjs").WidgetContext} ctx
 * @param {ReturnType<typeof sanitizeSceneConfig>} sceneConfig
 */
// Resolve the concrete light/dark palette to write inline for a socket-delivered
// site palette (overlay mode). `applySiteStyle` writes one flat palette, so
// `auto`/`host` themes — which normally switch via CSS — are collapsed to a
// concrete mode here, following the theme attribute or `prefers-color-scheme`.
function resolveStyleMode(root, options) {
  const theme = resolveWidgetTheme(root, options);
  if (theme === "light" || theme === "dark") return theme;
  const attr = root.dataset.townsquareTheme;
  if (attr === "light" || attr === "dark") return attr;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

function refreshScene(ctx, sceneConfig) {
  const sceneProps = buildSceneProps(sceneConfig);
  const birdPerches = buildBirdPerches(sceneProps);
  ctx.sceneProps = sceneProps;
  ctx.propsById = new Map(sceneProps.map((prop) => [prop.id, prop]));
  ctx.birdPerchesById = new Map(birdPerches.map((perch) => [perch.id, perch]));
  for (const el of ctx.stage.querySelectorAll(".prop")) {
    el.remove();
  }
  renderProps(ctx.stage, sceneProps);
  updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId, ctx.sceneProps);
  for (const peer of ctx.peers.values()) {
    updatePropEffects(peer.avatar, peer.x, peer.propId, ctx.sceneProps);
  }
  syncBirdPerches(ctx);
}

/**
 * Mount a TownSquare widget into any host page.
 *
 * The host page provides a DOM node. TownSquare owns scene rendering, input,
 * chat UI, and the realtime connection inside that mount root.
 *
 * @param {HTMLElement} root
 * @param {MountOptions} [options]
 * @returns {TownSquareHandle}
 */
export function mountTownSquare(root, options = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("TownSquare mount root must be an HTMLElement");
  }

  const serverOrigin = normalizeOrigin(
    options.serverOrigin
    || root.dataset.townsquareServerOrigin
    || window.location.origin,
  );
  const siteKey = options.siteKey || root.dataset.townsquareSiteKey || "";
  // Livestream overlay: connect read-only. The widget renders the live crowd but
  // never places the viewer in the scene, and the server never counts it.
  const watch = options.watch === true;
  const socketUrl = buildSocketUrl(serverOrigin, options.socketPath || "/live", siteKey, { watch });
  // Which config fields the host declared inline. The dashboard delivers scene /
  // connections / message board live by siteKey, but any field declared here is a
  // deliberate power-user override that wins and is never overwritten live.
  const inlineConfig = {
    scene: options.scene !== undefined,
    style: options.style !== undefined,
    connections: options.connections !== undefined,
    messageBoard: options.messageBoard !== undefined,
  };
  // Hosted sites (siteKey, real socket) fill the scene from the server's `hello`,
  // so start empty unless the host pinned a scene inline.
  const serverDrivenScene = Boolean(siteKey) && !(options.preview === true || options.simulate === true);
  const initialScene = options.scene
    || (serverDrivenScene ? EMPTY_SCENE_CONFIG : DEFAULT_SCENE_CONFIG);
  const sceneConfig = sanitizeSceneConfig(initialScene);
  const sceneProps = buildSceneProps(sceneConfig);
  const birdPerches = buildBirdPerches(sceneProps);
  const browserId = getBrowserId();
  const profile = getStoredProfile();
  const { readingLabel, readingUrl } = readCurrentPage(root, options);
  const readingActive = document.visibilityState === "visible" && document.hasFocus();
  const preview = options.preview === true;
  const solo = options.solo === true;
  // The dev simulation harness mounts the real widget but runs without a server:
  // no socket, prop-settle resolves locally (as in preview), yet peers and birds
  // stay on screen so the scene behaves exactly like production.
  const simulate = options.simulate === true;
  const localOnly = preview || simulate;
  const spawnX = preview || solo || simulate ? PREVIEW_SPAWN_X : randomSpawnX();
  const peers = new Map();
  // Per-mount chat state, shared by every avatar in this mount (and never across
  // mounts), so two widgets on one page keep independent bubble limits.
  const chatScope = createChatScope();
  const coarsePointer = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;

  const unwatchTheme = applyWidgetTheme(root, resolveWidgetTheme(root, options));
  root.replaceChildren();

  const {
    app,
    stage,
    statusRow,
    status: statusEl,
    enableToggle,
    enableToggleLabel,
    expandButton,
    helpButton,
    helpScrim,
    helpPanel,
    jumpButton,
    highFiveButton,
    toolbar,
  } = renderShell(root);

  // Only write palette tokens inline when the host explicitly passes `style`
  // (e.g. the live registration/admin preview). Otherwise leave theming to the
  // cascade — tokens.css defaults plus any host stylesheet rules on
  // #townsquare-root — so inline styles never beat host CSS.
  if (options.style) {
    applySiteStyle(root, options.style);
  }
  renderProps(stage, sceneProps);

  /** @type {import("./widget/context.mjs").WidgetContext} */
  const ctx = {
    root,
    options,
    inlineConfig,
    serverOrigin,
    socketUrl,
    browserId,
    peers,
    chat: chatScope,
    sceneProps,
    propsById: new Map(sceneProps.map((prop) => [prop.id, prop])),
    birdPerchesById: new Map(birdPerches.map((perch) => [perch.id, perch])),
    app,
    stage,
    statusRowEl: statusRow,
    statusEl,
    enableToggle,
    expandButton,
    // Chat cooldown (slow mode); the server sends the live value in `hello` and
    // again whenever an owner changes it.
    chatThrottleMs: DEFAULT_CHAT_THROTTLE_MS,
    self: {
      id: null,
      x: spawnX,
      movingLeft: false,
      movingRight: false,
      targetX: null,
      lastSentX: spawnX,
      lastSendAt: 0,
      lastSayAt: 0,
      lastJumpAt: 0,
      lastHighFiveAt: 0,
      pose: null,
      propId: null,
      displayName: profile.displayName,
      color: profile.color,
      readingLabel,
      readingUrl,
      readingActive,
      typing: false,
      isOwner: false,
      badgeColor: "",
      plugins: {},
      propZoneEnteredAt: 0,
      settlePropId: null,
      settleRequested: false,
      avatar: createAvatar({
        isSelf: true,
        profile: { ...profile, readingLabel, readingUrl, readingActive },
        colors: CHARACTER_COLORS,
        chatScope,
        onProfileChange: (nextProfile) => {
          const saved = saveStoredProfile(nextProfile);
          ctx.self.displayName = saved.displayName;
          ctx.self.color = saved.color;
          if (ctx.socket.readyState === WebSocket.OPEN && ctx.self.id) {
            ctx.socket.send(JSON.stringify({ type: MSG.PROFILE, ...saved }));
          }
        },
        onSubmitChat: () => submitChat(ctx),
        onTypingChange: (typing) => setLocalTyping(ctx, typing),
        // Chat always lives in the fixed bottom bar, never floating under the
        // (moving) figure: that float overlapped peer name tags and clipped at
        // screen edges. The bar's space is already reserved (--ts-toolbar-reserve).
        toolbarHost: toolbar,
      }),
      walkTimer: null,
    },
    socket: localOnly
      ? { readyState: WebSocket.CLOSED, close() {}, send() {} }
      : new WebSocket(socketUrl),
    reconnectTimer: null,
    typingTimer: null,
    quiet: false,
    expanded: false,
    disposed: false,
    lastFrameAt: performance.now(),
    frameHandle: null,
    onKeyDown: () => {},
    onKeyUp: () => {},
    onStagePointerDown: () => {},
    onStagePointerMove: () => {},
    onStagePointerUp: () => {},
    onStagePointerCancel: () => {},
    onStageClick: () => {},
  };

  ctx.widgetPlugins = createWidgetPluginRuntime(ctx);

  const expandController = createExpandController({
    app,
    expandButton,
    chatScope,
    getAvatars: () => [ctx.self.avatar, ...Array.from(ctx.peers.values(), (peer) => peer.avatar)],
    onChange: (expanded) => {
      ctx.expanded = expanded;
      if (coarsePointer && viewport) {
        window.requestAnimationFrame(onViewportChange);
      }
    },
  });
  const setExpanded = expandController.setExpanded;

  const setQuiet = (quiet) => {
    ctx.quiet = quiet;
    if (quiet) setLocalTyping(ctx, false);
    if (quiet) setExpanded(false);
    ctx.app.classList.toggle("townsquare--quiet", quiet);
    ctx.enableToggle.checked = !quiet;
    ctx.enableToggle.setAttribute("aria-label", quiet ? "TownSquare disabled" : "TownSquare enabled");
    ctx.enableToggle.title = quiet ? "Enable TownSquare" : "Disable TownSquare";
    ctx.self.movingLeft = false;
    ctx.self.movingRight = false;
    ctx.self.avatar.composer?.reset();
    if (ctx.self.avatar.composer && ctx.self.avatar.plate) {
      ctx.self.avatar.composer.hidden = true;
      ctx.self.avatar.plate.hidden = false;
    }
  };

  enableToggle.addEventListener("change", () => setQuiet(!enableToggle.checked));
  expandButton.addEventListener("click", () => {
    setExpanded(!expandController.isExpanded());
  });
  const onJumpClick = () => triggerJump(ctx);
  const onHighFiveClick = () => triggerHighFive(ctx);
  jumpButton.addEventListener("click", onJumpClick);
  highFiveButton.addEventListener("click", onHighFiveClick);
  // Gather the action buttons into the bottom toolbar beside the docked composer
  // and pencil (createAvatar already placed those). Moving the nodes keeps their
  // click listeners intact. Final bar order: input, pencil, jump, hi5.
  toolbar.append(jumpButton, highFiveButton);
  const unwireHelpPanel = wireHelpPanel(helpButton, helpScrim, helpPanel, enableToggleLabel);

  const unwatchPage = watchCurrentPage(ctx);

  // While the virtual keyboard is up, expose how much of the layout viewport it
  // hides so the docked composer can ride above it in expanded mode. On long
  // mobile pages, also nudge the document scroll so the square's lower edge is
  // not left behind the keyboard while an input inside it is focused.
  const viewport = window.visualViewport;
  const onViewportChange = () => {
    const hidden = getKeyboardInset(viewport);
    const keyboardVisible = hidden >= MOBILE_KEYBOARD_MIN_HEIGHT;
    app.style.setProperty("--ts-keyboard", `${Math.round(hidden)}px`);
    app.style.setProperty(
      "--ts-keyboard-scroll-room",
      keyboardVisible && expandController.isExpanded() ? `${Math.round(hidden)}px` : "0px",
    );
    revealAppAboveKeyboard(app, viewport, expandController.isExpanded());
  };
  const onAppFocusIn = () => {
    window.requestAnimationFrame(onViewportChange);
  };
  if (coarsePointer && viewport) {
    viewport.addEventListener("resize", onViewportChange);
    viewport.addEventListener("scroll", onViewportChange);
    app.addEventListener("focusin", onAppFocusIn);
    onViewportChange();
  }

  if (!preview) {
    initBirds(ctx);
    initClouds(ctx);
  }
  // Watch (overlay) mode is a passive viewer: it renders the real crowd but
  // never shows or moves a self avatar.
  if (!watch) {
    stage.appendChild(ctx.self.avatar.el);
    renderAvatar(ctx.self.avatar, ctx.self.x);
    updatePose(ctx.self.avatar, ctx.self.pose);
  }
  ctx.widgetPlugins.setModules(options.pluginModules || []);
  if (localOnly) {
    setStatusMessage(ctx, null);
  } else {
    updateStatus(ctx);
  }

  // Apply config the server pushes live (in `hello` and on owner edits). Each
  // field is honoured only when the host did not pin it inline — an inline value
  // is a power-user override that stays in the host's control.
  ctx.applyLiveConfig = ({ scene, styleConfig, connections, messageBoard } = {}) => {
    if (scene !== undefined && !ctx.inlineConfig.scene) {
      const sceneConfig = sanitizeSceneConfig(scene);
      ctx.options = { ...ctx.options, scene: sceneConfig };
      refreshScene(ctx, sceneConfig);
    }
    // Livestream overlay: the site's appearance palette (with any overlay-only
    // overrides already merged server-side) arrives over the socket, since the
    // overlay page carries no pasted style snippet. Pick the palette for the
    // active theme and write it inline. A power-user inline `style` still wins.
    if (styleConfig && !ctx.inlineConfig.style) {
      const mode = resolveStyleMode(root, ctx.options);
      const palette = styleConfig[mode] || styleConfig.dark || styleConfig.light;
      if (palette) {
        ctx.options = { ...ctx.options, style: palette };
        applySiteStyle(root, palette);
      }
    }
    if (connections !== undefined && !ctx.inlineConfig.connections) {
      ctx.options = { ...ctx.options, connections };
      setupConnections(ctx);
    }
    if (messageBoard !== undefined && !ctx.inlineConfig.messageBoard) {
      ctx.options = { ...ctx.options, messageBoard };
      setupMessageBoard(ctx);
    }
  };

  if (!localOnly) {
    wireSocket(ctx);
  }
  setupConnections(ctx);
  setupMessageBoard(ctx);
  // Overlay viewers take no input; the game loop still runs to animate peers.
  if (!watch) {
    wireKeyboard(ctx);
    wireStagePointer(ctx);
  }
  startGameLoop(ctx);

  return {
    ctx,
    updateConfig({ scene, style, connections, messageBoard } = {}) {
      if (scene) {
        const sceneConfig = sanitizeSceneConfig(scene);
        ctx.options = { ...ctx.options, scene: sceneConfig };
        refreshScene(ctx, sceneConfig);
        const siteKey = ctx.options.siteKey || ctx.root.dataset.townsquareSiteKey || "";
        if (!preview && !siteKey && ctx.socket.readyState === WebSocket.OPEN) {
          ctx.socket.send(JSON.stringify({ type: MSG.SCENE_CONFIG, sceneConfig }));
        }
      }
      if (style) {
        ctx.options = { ...ctx.options, style };
        applySiteStyle(root, style);
      }
      if (connections !== undefined) {
        ctx.options = { ...ctx.options, connections };
        setupConnections(ctx);
      }
      if (messageBoard !== undefined) {
        ctx.options = { ...ctx.options, messageBoard };
        setupMessageBoard(ctx);
      }
    },
    destroy() {
      ctx.disposed = true;
      unwatchTheme();
      stopGameLoop(ctx);
      destroyBirds(ctx);
      destroyClouds(ctx);
      ctx.widgetPlugins.destroy();
      unwireKeyboard(ctx);
      unwireStagePointer(ctx);
      unwireHelpPanel();
      teardownConnections(ctx);
      teardownMessageBoard(ctx);
      jumpButton.removeEventListener("click", onJumpClick);
      highFiveButton.removeEventListener("click", onHighFiveClick);
      closeTrays(ctx);
      unwatchPage();
      if (coarsePointer && viewport) {
        viewport.removeEventListener("resize", onViewportChange);
        viewport.removeEventListener("scroll", onViewportChange);
        app.removeEventListener("focusin", onAppFocusIn);
      }
      expandController.destroy();
      clearTimeout(ctx.reconnectTimer);
      ctx.reconnectTimer = null;
      clearTimeout(ctx.typingTimer);
      ctx.typingTimer = null;
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
