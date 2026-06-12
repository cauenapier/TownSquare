/**
 * TownSquare embeddable widget — public mount API.
 *
 * Host pages import this module and call `mountTownSquare` on a DOM node.
 * Implementation lives under `public/widget/` and is split by concern so
 * new scene features can grow without turning the mount file into a monolith.
 */

import { submitChat } from "./widget/chat.mjs";
import {
  createAvatar,
  renderAvatar,
  renderProps,
  renderShell,
  wireHelpPanel,
  updatePose,
} from "./widget/dom.mjs";
import { startGameLoop, stopGameLoop, unwireKeyboard, wireKeyboard } from "./widget/movement.mjs";
import { updateStatus } from "./widget/presence.mjs";
import { wireSocket } from "./widget/protocol.mjs";
import { buildSocketUrl, getBrowserId, normalizeOrigin } from "./widget/utils.mjs";

/**
 * @typedef {Object} MountOptions
 * @property {string} [serverOrigin] TownSquare server origin for static assets and WebSocket traffic.
 * @property {string} [socketPath="/live"] WebSocket path on the server origin.
 * @property {string} [siteKey] Hosted TownSquare site key. Self-hosted embeds can omit it.
 */

/**
 * @typedef {Object} TownSquareHandle
 * @property {() => void} destroy Tear down listeners, animation, socket, and mounted DOM.
 */

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
  const browserId = getBrowserId();
  const peers = new Map();

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

  renderProps(stage);

  /** @type {import("./widget/context.mjs").WidgetContext} */
  const ctx = {
    root,
    options,
    serverOrigin,
    socketUrl,
    browserId,
    peers,
    app,
    stage,
    statusRowEl: statusRow,
    statusEl,
    quietButton,
    expandButton,
    self: {
      id: null,
      x: 0.5,
      movingLeft: false,
      movingRight: false,
      lastSentX: 0.5,
      lastSendAt: 0,
      pose: null,
      propId: null,
      propZoneEnteredAt: 0,
      settlePropId: null,
      settleRequested: false,
      avatar: createAvatar({
        isSelf: true,
        onSubmitChat: () => submitChat(ctx),
      }),
      walkTimer: null,
    },
    socket: new WebSocket(socketUrl),
    quiet: false,
    expanded: false,
    disposed: false,
    layoutDirty: true,
    stageResizeObserver: null,
    lastFrameAt: performance.now(),
    frameHandle: null,
    onKeyDown: () => {},
    onKeyUp: () => {},
  };

  const setExpanded = (expanded) => {
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

  stage.appendChild(ctx.self.avatar.el);
  renderAvatar(ctx.self.avatar, ctx.self.x);
  updatePose(ctx.self.avatar, ctx.self.pose);
  updateStatus(ctx);

  wireSocket(ctx);
  wireKeyboard(ctx);
  ctx.stageResizeObserver = new ResizeObserver(() => {
    ctx.layoutDirty = true;
  });
  ctx.stageResizeObserver.observe(stage);
  startGameLoop(ctx);

  return {
    destroy() {
      ctx.disposed = true;
      stopGameLoop(ctx);
      unwireKeyboard(ctx);
      unwireHelpPanel();
      ctx.stageResizeObserver?.disconnect();
      ctx.stageResizeObserver = null;
      setExpanded(false);
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
