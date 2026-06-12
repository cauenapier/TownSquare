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
  renderBench,
  renderShell,
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
 * @property {string} [instructions] Status-row helper text shown beside the visitor count.
 * @property {string} [hint] Footer hint shown below the scene.
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

  const { app, stage, status: statusEl } = renderShell(root, options);

  renderBench(stage);

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
    statusEl,
    self: {
      id: null,
      x: 0.5,
      movingLeft: false,
      movingRight: false,
      lastSentX: 0.5,
      lastSendAt: 0,
      pose: null,
      propId: null,
      benchZoneEnteredAt: 0,
      benchRequested: false,
      avatar: createAvatar({
        isSelf: true,
        onSubmitChat: () => submitChat(ctx),
      }),
      walkTimer: null,
    },
    socket: new WebSocket(socketUrl),
    disposed: false,
    lastFrameAt: performance.now(),
    frameHandle: null,
    onKeyDown: () => {},
    onKeyUp: () => {},
  };

  stage.appendChild(ctx.self.avatar.el);
  renderAvatar(ctx.self.avatar, ctx.self.x);
  updatePose(ctx.self.avatar, ctx.self.pose);
  updateStatus(ctx);

  wireSocket(ctx);
  wireKeyboard(ctx);
  startGameLoop(ctx);

  return {
    destroy() {
      ctx.disposed = true;
      stopGameLoop(ctx);
      unwireKeyboard(ctx);
      ctx.socket.close();
      root.replaceChildren();
    },
  };
}
