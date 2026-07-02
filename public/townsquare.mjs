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
import { wireKeyboardInset } from "./widget/keyboard-inset.mjs";
import { MSG } from "./shared/protocol.mjs";
import { createAvatar, destroyAvatar } from "./widget/avatar.mjs";
import {
  renderAvatar,
  renderProps,
  updatePose,
  updatePropEffects,
} from "./widget/gestures.mjs";
import { watchCurrentPage } from "./widget/page-watch.mjs";
import { createWidgetPluginRuntime } from "./widget/plugins.mjs";
import { renderShell, wireHelpPanel } from "./widget/shell.mjs";
import {
  closeTrays,
  wireGameLoop,
  triggerHighFive,
  triggerJump,
  unwireKeyboard,
  unwireStagePointer,
  wireKeyboard,
  wireStagePointer,
} from "./widget/movement.mjs";
import { setStatusMessage, updateStatus } from "./widget/presence.mjs";
import { sendToServer, wireSocket } from "./widget/protocol.mjs";
import { setQuiet } from "./widget/quiet.mjs";
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
 * @property {{ sky?: string, groundFill?: string, surface?: string, ink?: string, accent?: string, treeTrunk?: string, treeCanopy?: string, other?: string, groundLine?: string }} [style] A single flat palette written as inline CSS variables on the mount root (legacy keys `scene`, `page`, and `ground` are still read). Pass this only when you want JS to own the palette for the current `theme` (e.g. the live preview). Omit it to theme via CSS instead — set the same tokens (`--scene`, `--ground-fill`, `--surface`, `--ink`, `--you`, `--tree-trunk`, `--tree-canopy`, `--other`, `--ground-line`; the pre-rename names `--page`/`--ground` still work) on `#townsquare-root` in your own stylesheet; when `style` is absent the widget writes nothing inline so your rules win.
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

// Hosted sites receive their scene from the server on connect, so we start them
// empty rather than flashing the stock default props before the real scene
// arrives. Self-hosted embeds with no server config keep the stock default.
const EMPTY_SCENE_CONFIG = { benches: 0, trees: 0, lamps: 0, birds: 0 };

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
 * @param {import("./widget/context.mjs").WidgetContext} ctx
 * @param {{ scene?: unknown, style?: MountOptions["style"], styleConfig?: Record<string, any>, connections?: unknown, messageBoard?: unknown }} patch
 * @param {{ respectInline?: boolean, sendSceneConfig?: boolean }} [options]
 */
function applyConfig(ctx, patch = {}, { respectInline = false, sendSceneConfig = false } = {}) {
  const inline = respectInline ? ctx.inlineConfig : {};

  if (patch.scene !== undefined && !inline.scene) {
    const sceneConfig = sanitizeSceneConfig(patch.scene);
    ctx.options = { ...ctx.options, scene: sceneConfig };
    refreshScene(ctx, sceneConfig);
    if (sendSceneConfig && !ctx.preview && !ctx.siteKey) {
      sendToServer(ctx, MSG.SCENE_CONFIG, { sceneConfig });
    }
  }

  if (patch.style && !inline.style) {
    ctx.options = { ...ctx.options, style: patch.style };
    applySiteStyle(ctx.root, patch.style);
  }

  // Livestream overlay: the site's appearance palette (with any overlay-only
  // overrides already merged server-side) arrives over the socket, since the
  // overlay page carries no pasted style snippet. Pick the palette for the
  // active theme and write it inline. A power-user inline `style` still wins.
  if (patch.styleConfig && !inline.style) {
    const mode = resolveStyleMode(ctx.root, ctx.options);
    const palette = patch.styleConfig[mode] || patch.styleConfig.dark || patch.styleConfig.light;
    if (palette) {
      ctx.options = { ...ctx.options, style: palette };
      applySiteStyle(ctx.root, palette);
    }
  }

  if (patch.connections !== undefined && !inline.connections) {
    ctx.options = { ...ctx.options, connections: patch.connections };
    setupConnections(ctx);
  }

  if (patch.messageBoard !== undefined && !inline.messageBoard) {
    ctx.options = { ...ctx.options, messageBoard: patch.messageBoard };
    setupMessageBoard(ctx);
  }
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
  const preview = options.preview === true;
  const solo = options.solo === true;
  // The dev simulation harness mounts the real widget but runs without a server:
  // no socket, prop-settle resolves locally (as in preview), yet peers and birds
  // stay on screen so the scene behaves exactly like production.
  const simulate = options.simulate === true;
  const localOnly = preview || simulate;
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
  const serverDrivenScene = Boolean(siteKey) && !localOnly;
  const initialScene = options.scene
    || (serverDrivenScene ? EMPTY_SCENE_CONFIG : DEFAULT_SCENE_CONFIG);
  const browserId = getBrowserId();
  const profile = getStoredProfile();
  const { readingLabel, readingUrl } = readCurrentPage(root, options);
  const readingActive = document.visibilityState === "visible" && document.hasFocus();
  const spawnX = preview || solo || simulate ? PREVIEW_SPAWN_X : randomSpawnX();
  const peers = new Map();
  // Per-mount chat state, shared by every avatar in this mount (and never across
  // mounts), so two widgets on one page keep independent bubble limits.
  const chatScope = createChatScope();

  const resolvedTheme = resolveWidgetTheme(root, options);
  const unwatchTheme = applyWidgetTheme(root, resolvedTheme);
  const disposers = [unwatchTheme];
  // Host embeds theme via pasted CSS variables (--scene/--ground-fill/
  // --ground-line, or their legacy names --page/--ground) rather
  // than an inline `style` palette, so nothing else flips on the scene paint.
  // Mark the surface here so widget.css paints the flat sky/ground from those
  // variables; the pasted snippet only sets the tokens, never repaints the
  // stage. (The inline-`style` path — live preview, overlay — sets this in
  // applySiteStyle instead.)
  if (resolvedTheme === "host") {
    root.dataset.townsquareSurface = "";
  }
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

  /** @type {import("./widget/context.mjs").WidgetContext} */
  const ctx = {
    root,
    options,
    inlineConfig,
    serverOrigin,
    socketUrl,
    siteKey,
    preview,
    simulate,
    localOnly,
    solo,
    watch,
    browserId,
    peers,
    chat: chatScope,
    sceneProps: [],
    propsById: new Map(),
    birdPerchesById: new Map(),
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
          if (ctx.self.id) {
            sendToServer(ctx, MSG.PROFILE, saved);
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
    challenge: null,
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
  disposers.push(() => ctx.widgetPlugins.destroy());
  // Initial scene/style setup uses the same path as later config updates. Run it
  // before appending the self avatar so prop rendering stays behind figures.
  applyConfig(ctx, { scene: initialScene, style: options.style });

  let refreshKeyboardInset = () => {};
  const expandController = createExpandController({
    app,
    expandButton,
    chatScope,
    getAvatars: () => [ctx.self.avatar, ...Array.from(ctx.peers.values(), (peer) => peer.avatar)],
    onChange: (expanded) => {
      ctx.expanded = expanded;
      refreshKeyboardInset();
    },
  });
  disposers.push(() => expandController.destroy());
  const setExpanded = expandController.setExpanded;

  const disposeKeyboardInset = wireKeyboardInset(ctx, expandController);
  refreshKeyboardInset = disposeKeyboardInset.refresh;
  disposers.push(disposeKeyboardInset);

  const onEnableToggleChange = () => setQuiet(ctx, !enableToggle.checked, setExpanded);
  enableToggle.addEventListener("change", onEnableToggleChange);
  disposers.push(() => enableToggle.removeEventListener("change", onEnableToggleChange));

  const onExpandClick = () => {
    setExpanded(!expandController.isExpanded());
  };
  expandButton.addEventListener("click", onExpandClick);
  disposers.push(() => expandButton.removeEventListener("click", onExpandClick));

  const onJumpClick = () => triggerJump(ctx);
  const onHighFiveClick = () => triggerHighFive(ctx);
  jumpButton.addEventListener("click", onJumpClick);
  highFiveButton.addEventListener("click", onHighFiveClick);
  disposers.push(() => jumpButton.removeEventListener("click", onJumpClick));
  disposers.push(() => highFiveButton.removeEventListener("click", onHighFiveClick));
  // Gather the action buttons into the bottom toolbar beside the docked composer
  // and pencil (createAvatar already placed those). Moving the nodes keeps their
  // click listeners intact. Final bar order: input, pencil, jump, hi5.
  toolbar.append(jumpButton, highFiveButton);
  const unwireHelpPanel = wireHelpPanel(helpButton, helpScrim, helpPanel, enableToggleLabel);
  disposers.push(unwireHelpPanel);

  const unwatchPage = watchCurrentPage(ctx);
  disposers.push(unwatchPage);

  if (!preview) {
    initBirds(ctx);
    initClouds(ctx);
    disposers.push(() => destroyBirds(ctx));
    disposers.push(() => destroyClouds(ctx));
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

  // Apply config the server pushes live (in `hello` and on owner edits). Inline
  // values are power-user overrides that stay in the host's control.
  ctx.applyLiveConfig = (config = {}) => applyConfig(ctx, config, { respectInline: true });

  if (!localOnly) {
    wireSocket(ctx);
  }
  setupConnections(ctx);
  disposers.push(() => teardownConnections(ctx));
  setupMessageBoard(ctx);
  disposers.push(() => teardownMessageBoard(ctx));
  // Overlay viewers take no input; the game loop still runs to animate peers.
  if (!watch) {
    wireKeyboard(ctx);
    wireStagePointer(ctx);
    disposers.push(() => unwireKeyboard(ctx));
    disposers.push(() => unwireStagePointer(ctx));
  }
  disposers.push(wireGameLoop(ctx));
  disposers.push(() => closeTrays(ctx));

  return {
    ctx,
    updateConfig({ scene, style, connections, messageBoard } = {}) {
      applyConfig(ctx, { scene, style, connections, messageBoard }, { sendSceneConfig: true });
    },
    destroy() {
      ctx.disposed = true;
      for (let i = disposers.length - 1; i >= 0; i -= 1) {
        disposers[i]();
      }
      clearTimeout(ctx.reconnectTimer);
      ctx.reconnectTimer = null;
      ctx.challenge?.cancel();
      ctx.challenge = null;
      clearTimeout(ctx.typingTimer);
      ctx.typingTimer = null;
      clearTimeout(ctx.cooldownHintTimer);
      ctx.cooldownHintTimer = null;
      clearTimeout(ctx.self.walkTimer);
      ctx.self.walkTimer = null;
      destroyAvatar(ctx.self.avatar);
      for (const peer of ctx.peers.values()) {
        clearTimeout(peer.walkTimer);
        peer.walkTimer = null;
        destroyAvatar(peer.avatar);
      }
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
