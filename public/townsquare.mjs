/**
 * TownSquare embeddable widget — public mount API.
 *
 * Host pages import this module and call `mountTownSquare` on a DOM node.
 * Implementation lives under `public/widget/` and is split by concern so
 * new scene features can grow without turning the mount file into a monolith.
 */

import { submitChat } from "./widget/chat.mjs";
import { initBirds, destroyBirds } from "./widget/birds.mjs";
import { CHARACTER_COLORS, MAX_X, MIN_X, randomSpawnX } from "./widget/constants.mjs";
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
import {
  closeTrays,
  startGameLoop,
  stopGameLoop,
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
  DEFAULT_SITE_STYLE,
  sanitizeSceneConfig,
  sanitizeSiteStyle,
} from "./site-config.mjs";
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
 * @property {{ benches?: number, trees?: number, lamps?: number, birds?: number, benchXs?: number[], treeXs?: number[], lampXs?: number[] }} [scene] Scene prop counts and optional per-prop X positions (0..1).
 * @property {{ scene?: string, page?: string, surface?: string, ink?: string, accent?: string, other?: string, ground?: string }} [style] CSS-token overrides.
 * @property {string} [readingLabel] Explicit page label. Defaults to the page heading, then document title.
 * @property {string} [readingUrl] Explicit page URL. Defaults to the current browser URL.
 * @property {"auto" | "light" | "dark"} [theme="auto"] Widget palette. `auto` follows `prefers-color-scheme`; use `dark` when the host page has a manual dark toggle.
 * @property {boolean} [preview=false] Static registration-style preview: fixed spawn position, no live socket, and in-place scene/style updates via the mount handle.
 * @property {boolean} [solo=false] Live socket, but hide other visitors. Useful for registration/admin previews on shared default scenes.
 */

/**
 * @typedef {Object} TownSquareHandle
 * @property {(config?: { scene?: MountOptions["scene"], style?: MountOptions["style"] }) => void} updateConfig Refresh scene props and/or style tokens without remounting.
 * @property {() => void} destroy Tear down listeners, animation, socket, and mounted DOM.
 */

const PREVIEW_SPAWN_X = (MIN_X + MAX_X) / 2;

/**
 * @param {import("./widget/context.mjs").WidgetContext} ctx
 * @param {ReturnType<typeof sanitizeSceneConfig>} sceneConfig
 */
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
  const socketUrl = buildSocketUrl(serverOrigin, options.socketPath || "/live", siteKey);
  const sceneConfig = sanitizeSceneConfig(options.scene || DEFAULT_SCENE_CONFIG);
  const sceneProps = buildSceneProps(sceneConfig);
  const birdPerches = buildBirdPerches(sceneProps);
  const browserId = getBrowserId();
  const profile = getStoredProfile();
  const { readingLabel, readingUrl } = readCurrentPage(root, options);
  const readingActive = document.visibilityState === "visible" && document.hasFocus();
  const preview = options.preview === true;
  const solo = options.solo === true;
  const spawnX = preview || solo ? PREVIEW_SPAWN_X : randomSpawnX();
  const peers = new Map();
  const coarsePointer = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;

  applyWidgetTheme(root, resolveWidgetTheme(root, options));
  root.replaceChildren();

  const {
    app,
    stage,
    statusRow,
    status: statusEl,
    quietButton,
    expandButton,
    helpButton,
    helpPanel,
  } = renderShell(root);

  applySiteStyle(root, sanitizeSiteStyle(options.style || DEFAULT_SITE_STYLE));
  renderProps(stage, sceneProps);

  /** @type {import("./widget/context.mjs").WidgetContext} */
  const ctx = {
    root,
    options,
    serverOrigin,
    socketUrl,
    browserId,
    peers,
    sceneProps,
    propsById: new Map(sceneProps.map((prop) => [prop.id, prop])),
    birdPerchesById: new Map(birdPerches.map((perch) => [perch.id, perch])),
    app,
    stage,
    statusRowEl: statusRow,
    statusEl,
    quietButton,
    expandButton,
    self: {
      id: null,
      x: spawnX,
      movingLeft: false,
      movingRight: false,
      targetX: null,
      lastSentX: spawnX,
      lastSendAt: 0,
      lastJumpAt: 0,
      pose: null,
      propId: null,
      displayName: profile.displayName,
      color: profile.color,
      readingLabel,
      readingUrl,
      readingActive,
      propZoneEnteredAt: 0,
      settlePropId: null,
      settleRequested: false,
      avatar: createAvatar({
        isSelf: true,
        profile: { ...profile, readingLabel, readingUrl, readingActive },
        colors: CHARACTER_COLORS,
        onProfileChange: (nextProfile) => {
          const saved = saveStoredProfile(nextProfile);
          ctx.self.displayName = saved.displayName;
          ctx.self.color = saved.color;
          if (ctx.socket.readyState === WebSocket.OPEN && ctx.self.id) {
            ctx.socket.send(JSON.stringify({ type: "profile", ...saved }));
          }
        },
        onSubmitChat: () => submitChat(ctx),
        composerHost: coarsePointer ? app : undefined,
      }),
      walkTimer: null,
    },
    socket: preview
      ? { readyState: WebSocket.CLOSED, close() {}, send() {} }
      : new WebSocket(socketUrl),
    reconnectTimer: null,
    quiet: false,
    expanded: false,
    disposed: false,
    lastFrameAt: performance.now(),
    frameHandle: null,
    onKeyDown: () => {},
    onKeyUp: () => {},
    onStageClick: () => {},
  };

  // Expanded mode overlays the host page, so lock its scroll while open and
  // restore whatever inline overflow it had before.
  let hostBodyOverflow = "";

  const setExpanded = (expanded) => {
    if (expanded !== ctx.expanded) {
      if (expanded) {
        hostBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = hostBodyOverflow;
      }
    }
    ctx.expanded = expanded;
    ctx.app.classList.toggle("townsquare--expanded", expanded);
    ctx.expandButton.classList.toggle("townsquare__control--active", expanded);
    ctx.expandButton.setAttribute("aria-pressed", String(expanded));
    ctx.expandButton.setAttribute("aria-label", expanded ? "Collapse widget" : "Expand widget");
  };

  const setQuiet = (quiet) => {
    ctx.quiet = quiet;
    if (quiet) setExpanded(false);
    ctx.app.classList.toggle("townsquare--quiet", quiet);
    ctx.quietButton.classList.toggle("townsquare__control--active", quiet);
    ctx.quietButton.setAttribute("aria-pressed", String(quiet));
    ctx.quietButton.setAttribute("aria-label", quiet ? "Turn quiet mode off" : "Turn quiet mode on");
    ctx.self.movingLeft = false;
    ctx.self.movingRight = false;
    ctx.self.avatar.composer?.reset();
    if (ctx.self.avatar.composer && ctx.self.avatar.plate) {
      ctx.self.avatar.composer.hidden = true;
      ctx.self.avatar.plate.hidden = false;
    }
  };

  quietButton.addEventListener("click", () => setQuiet(!ctx.quiet));
  expandButton.addEventListener("click", () => {
    setExpanded(!ctx.expanded);
  });
  const unwireHelpPanel = wireHelpPanel(helpButton, helpPanel);

  const onWindowKeyDown = (event) => {
    if (event.key !== "Escape" || !ctx.expanded) return;
    if (event.target instanceof HTMLInputElement) return;
    setExpanded(false);
  };
  window.addEventListener("keydown", onWindowKeyDown);

  const unwatchPage = watchCurrentPage(ctx);

  // While the virtual keyboard is up, expose how much of the layout viewport it
  // hides so the docked composer can ride above it in expanded mode.
  const viewport = window.visualViewport;
  const onViewportChange = () => {
    if (!viewport) return;
    const hidden = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    app.style.setProperty("--ts-keyboard", `${Math.round(hidden)}px`);
  };
  if (coarsePointer && viewport) {
    viewport.addEventListener("resize", onViewportChange);
    viewport.addEventListener("scroll", onViewportChange);
  }

  if (!preview) {
    initBirds(ctx);
  }
  stage.appendChild(ctx.self.avatar.el);
  renderAvatar(ctx.self.avatar, ctx.self.x);
  updatePose(ctx.self.avatar, ctx.self.pose);
  if (preview) {
    setStatusMessage(ctx, null);
  } else {
    updateStatus(ctx);
  }

  if (!preview) {
    wireSocket(ctx);
  }
  wireKeyboard(ctx);
  wireStagePointer(ctx);
  startGameLoop(ctx);

  return {
    updateConfig({ scene, style } = {}) {
      if (scene) {
        const sceneConfig = sanitizeSceneConfig(scene);
        ctx.options = { ...ctx.options, scene: sceneConfig };
        refreshScene(ctx, sceneConfig);
        const siteKey = ctx.options.siteKey || ctx.root.dataset.townsquareSiteKey || "";
        if (!preview && !siteKey && ctx.socket.readyState === WebSocket.OPEN) {
          ctx.socket.send(JSON.stringify({ type: "sceneConfig", sceneConfig }));
        }
      }
      if (style) {
        const styleConfig = sanitizeSiteStyle(style);
        ctx.options = { ...ctx.options, style: styleConfig };
        applySiteStyle(root, styleConfig);
      }
    },
    destroy() {
      ctx.disposed = true;
      stopGameLoop(ctx);
      destroyBirds(ctx);
      unwireKeyboard(ctx);
      unwireStagePointer(ctx);
      unwireHelpPanel();
      closeTrays(ctx);
      window.removeEventListener("keydown", onWindowKeyDown);
      unwatchPage();
      if (coarsePointer && viewport) {
        viewport.removeEventListener("resize", onViewportChange);
        viewport.removeEventListener("scroll", onViewportChange);
      }
      setExpanded(false);
      clearTimeout(ctx.reconnectTimer);
      ctx.reconnectTimer = null;
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
