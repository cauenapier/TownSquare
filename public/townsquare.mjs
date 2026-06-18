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
import { createExpandController } from "./widget/expand.mjs";
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
 * @property {{ scene?: string, page?: string, surface?: string, ink?: string, accent?: string, other?: string, ground?: string }} [style] A single flat palette written as inline CSS variables on the mount root. Pass this only when you want JS to own the palette for the current `theme` (e.g. the live preview). Omit it to theme via CSS instead — set the same tokens (`--scene`, `--page`, `--surface`, `--ink`, `--you`, `--other`, `--ground`) on `#townsquare-root` in your own stylesheet; when `style` is absent the widget writes nothing inline so your rules win.
 * @property {string} [readingLabel] Explicit page label. Defaults to the page heading, then document title.
 * @property {string} [readingUrl] Explicit page URL. Defaults to the current browser URL.
 * @property {"auto" | "light" | "dark" | "host"} [theme="auto"] Widget palette. `auto` follows `prefers-color-scheme`; `host` follows common host-page dark mode signals.
 * @property {boolean} [preview=false] Static customization preview: fixed spawn, local prop settle, no socket, in-place scene/style updates via the mount handle.
 * @property {boolean} [solo=false] Live socket, but hide other visitors on the client.
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

  const unwatchTheme = applyWidgetTheme(root, resolveWidgetTheme(root, options));
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
    jumpButton,
    highFiveButton,
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
      lastHighFiveAt: 0,
      pose: null,
      propId: null,
      displayName: profile.displayName,
      color: profile.color,
      readingLabel,
      readingUrl,
      readingActive,
      isOwner: false,
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

  const expandController = createExpandController({
    app,
    expandButton,
    getAvatars: () => [ctx.self.avatar, ...Array.from(ctx.peers.values(), (peer) => peer.avatar)],
    onChange: (expanded) => { ctx.expanded = expanded; },
  });
  const setExpanded = expandController.setExpanded;

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
    setExpanded(!expandController.isExpanded());
  });
  const onJumpClick = () => triggerJump(ctx);
  const onHighFiveClick = () => triggerHighFive(ctx);
  jumpButton.addEventListener("click", onJumpClick);
  highFiveButton.addEventListener("click", onHighFiveClick);
  const unwireHelpPanel = wireHelpPanel(helpButton, helpPanel);

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
        ctx.options = { ...ctx.options, style };
        applySiteStyle(root, style);
      }
    },
    destroy() {
      ctx.disposed = true;
      unwatchTheme();
      stopGameLoop(ctx);
      destroyBirds(ctx);
      unwireKeyboard(ctx);
      unwireStagePointer(ctx);
      unwireHelpPanel();
      jumpButton.removeEventListener("click", onJumpClick);
      highFiveButton.removeEventListener("click", onHighFiveClick);
      closeTrays(ctx);
      unwatchPage();
      if (coarsePointer && viewport) {
        viewport.removeEventListener("resize", onViewportChange);
        viewport.removeEventListener("scroll", onViewportChange);
      }
      expandController.destroy();
      clearTimeout(ctx.reconnectTimer);
      ctx.reconnectTimer = null;
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
