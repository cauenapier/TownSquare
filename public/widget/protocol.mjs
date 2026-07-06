/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage, setHistory } from "./chat.mjs";
import { applyBirdFlee, applyBirdSpawn, syncBirdsFromHello } from "./birds.mjs";
import { clearPresencePose, needsStandUp, playHighFivePair, playJump, playRaisedHand, setWalking } from "./gestures.mjs";
import {
  applyPeerState,
  applyProfileState,
  applyReadingState,
  applySelfState,
  removePeer,
  setStatusMessage,
  updateStatus,
} from "./presence.mjs";
import { getBrowserSecret, saveBrowserSecret } from "./utils.mjs";
import { solveChallenge } from "./pow.mjs";
import { MSG, GESTURE, BIRD_ACTION, CLOSE_REASON } from "../../shared/protocol.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const WALK_BUMP_MS = 120;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;
// Server-initiated closes that no amount of retrying will fix.
const PERMANENT_CLOSE_MESSAGES = new Map([
  [CLOSE_REASON.KICKED, "You were removed from the square."],
  [CLOSE_REASON.BLOCKED, "You can't join this square right now."],
  [CLOSE_REASON.INACTIVE, "You were away for a while and left the square. Refresh the page to rejoin."],
  [CLOSE_REASON.SITE_DISABLED, "This TownSquare isn't available right now."],
  [CLOSE_REASON.SITE_DISABLED_OR_UNKNOWN, "This TownSquare isn't available right now."],
  [CLOSE_REASON.ORIGIN_NOT_ALLOWED, "This page isn't registered to TownSquare yet."],
  [CLOSE_REASON.PLUS_REQUIRED, "Livestream overlays are available with TownSquare Plus."],
  [CLOSE_REASON.RATE_LIMITED, "Too many visitors are connecting from this network. Try again later."],
]);

function bumpWalking(presence) {
  setWalking(presence.avatar, true);
  clearTimeout(presence.walkTimer);
  presence.walkTimer = setTimeout(() => setWalking(presence.avatar, false), WALK_BUMP_MS);
}

function clearPeers(ctx) {
  for (const id of [...ctx.peers.keys()]) {
    removePeer(ctx, id);
  }
}

function presenceById(ctx, id) {
  return id === ctx.self.id ? ctx.self : ctx.peers.get(id);
}

function applyJump(ctx, id) {
  const presence = presenceById(ctx, id);
  if (!presence) return;
  clearPresencePose(presence, ctx.sceneProps);
  playJump(presence.avatar);
}

function applyRaiseHand(ctx, id) {
  const presence = presenceById(ctx, id);
  if (!presence) return;
  clearPresencePose(presence, ctx.sceneProps);
  playRaisedHand(presence.avatar);
}

function applyHighFive(ctx, id, targetId) {
  const initiator = presenceById(ctx, id);
  const target = presenceById(ctx, targetId);
  if (!initiator || !target) return;
  const standUpFirst = needsStandUp(initiator) || needsStandUp(target);
  for (const presence of [initiator, target]) {
    clearPresencePose(presence, ctx.sceneProps);
  }
  playHighFivePair(initiator, target, standUpFirst);
}

/**
 * @param {WebSocket} socket
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @returns {boolean}
 */
function sendToSocket(socket, type, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type, ...payload }));
  return true;
}

/**
 * @param {WidgetContext} ctx
 * @param {string} type
 * @param {Record<string, unknown>} [payload]
 * @returns {boolean}
 */
export function sendToServer(ctx, type, payload = {}) {
  return sendToSocket(ctx.socket, type, payload);
}

function handleChallenge(ctx, socket, message) {
  if (typeof message.salt !== "string" || typeof message.difficulty !== "number") return;
  ctx.challenge?.cancel();
  const challenge = solveChallenge({ salt: message.salt, difficulty: message.difficulty });
  ctx.challenge = challenge;
  challenge.promise.then((nonce) => {
    if (ctx.challenge === challenge) ctx.challenge = null;
    sendToSocket(socket, MSG.SOLVE, { nonce });
  }).catch(() => {
    if (ctx.challenge === challenge) ctx.challenge = null;
  });
}

function handleHello(ctx, _socket, message) {
  ctx.widgetPlugins?.setModules(message.pluginModules || ctx.options.pluginModules || []);
  if (typeof message.chatThrottleMs === "number") ctx.chatThrottleMs = message.chatThrottleMs;
  // A spectator hello carries no self identity, so skip own-avatar setup.
  if (!ctx.watch) {
    ctx.self.id = message.id;
    saveBrowserSecret(message.browserSecret);
    applySelfState(ctx, message);
    // Backlog seeds the hover tray only — it never pops a live bubble, so a
    // refresh doesn't replay everyone's last messages into the scene.
    setHistory(ctx.self.avatar, []);
    for (const recent of message.messages || []) {
      recordMessage(ctx.self.avatar, recent);
    }
  }
  if (!ctx.solo) {
    for (const peer of message.peers) {
      applyPeerState(ctx, peer);
    }
  }
  // Hosted sites deliver scene, connections, and the message board over the
  // socket so admin edits apply live without re-pasting the snippet. Apply
  // before birds so their perches exist. Inline overrides are respected inside
  // applyLiveConfig.
  ctx.applyLiveConfig?.({
    scene: message.scene,
    // Overlays receive the site appearance (plus any overlay-only overrides)
    // over the socket; on-page embeds theme via their pasted snippet and omit this.
    styleConfig: message.styleConfig,
    connections: message.connections,
    messageBoard: message.messageBoard,
  });
  syncBirdsFromHello(ctx, message.birds);
  updateStatus(ctx);
}

function handleChatThrottle(ctx, _socket, message) {
  if (typeof message.ms === "number") ctx.chatThrottleMs = message.ms;
}

function handleScene(ctx, _socket, message) {
  ctx.applyLiveConfig?.({ scene: message.scene });
}

function handleConnections(ctx, _socket, message) {
  ctx.applyLiveConfig?.({ connections: message.connections });
}

function handleMessageBoard(ctx, _socket, message) {
  ctx.applyLiveConfig?.({ messageBoard: message.messageBoard });
}

function handleBird(ctx, _socket, message) {
  if (message.action === BIRD_ACTION.SPAWN) {
    applyBirdSpawn(ctx, message);
  } else if (message.action === BIRD_ACTION.FLEE) {
    applyBirdFlee(ctx, message);
  }
}

function handleJoin(ctx, _socket, message) {
  if (!ctx.solo) {
    applyPeerState(ctx, message.peer);
  }
}

function handleLeave(ctx, _socket, message) {
  if (!ctx.solo) {
    removePeer(ctx, message.id);
  }
}

function handleMove(ctx, _socket, message) {
  if (message.id === ctx.self.id) {
    const hadPose = Boolean(ctx.self.pose);
    applySelfState(ctx, message);
    if (!ctx.self.pose && !hadPose) {
      bumpWalking(ctx.self);
    }
    return;
  }

  if (ctx.solo) return;

  const peer = applyPeerState(ctx, message);
  if (!peer.pose) {
    bumpWalking(peer);
  }
}

function handleAction(ctx, _socket, message) {
  if (message.id !== ctx.self.id && ctx.solo) return;
  if (message.action === GESTURE.JUMP) {
    applyJump(ctx, message.id);
  } else if (message.action === GESTURE.RAISE_HAND) {
    applyRaiseHand(ctx, message.id);
  } else if (message.action === GESTURE.HIGH_FIVE) {
    applyHighFive(ctx, message.id, message.targetId);
  }
}

function handleSay(ctx, _socket, message) {
  if (message.id === ctx.self.id) {
    if (ctx.quiet) {
      recordMessage(ctx.self.avatar, { text: message.text, at: message.at });
      return;
    }
    sayMessage(ctx.self.avatar, { text: message.text, at: message.at });
    return;
  }

  if (ctx.solo) return;

  const peer = ctx.peers.get(message.id);
  if (!peer) return;
  peer.avatar.el.classList.remove("townsquare-avatar--typing");
  if (ctx.quiet) {
    recordMessage(peer.avatar, { text: message.text, at: message.at });
    return;
  }
  sayMessage(peer.avatar, { text: message.text, at: message.at });
}

function handleTyping(ctx, _socket, message) {
  if (message.id === ctx.self.id || ctx.solo) return;
  const peer = ctx.peers.get(message.id);
  peer?.avatar.el.classList.toggle("townsquare-avatar--typing", message.typing === true);
}

function handleProfile(ctx, _socket, message) {
  if (message.id === ctx.self.id || !ctx.solo) {
    applyProfileState(ctx, message);
  }
}

function handleReading(ctx, _socket, message) {
  if (message.id === ctx.self.id || !ctx.solo) {
    applyReadingState(ctx, message);
  }
}

const MESSAGE_HANDLERS = {
  [MSG.CHALLENGE]: handleChallenge,
  [MSG.HELLO]: handleHello,
  [MSG.CHAT_THROTTLE]: handleChatThrottle,
  [MSG.SCENE]: handleScene,
  [MSG.CONNECTIONS]: handleConnections,
  [MSG.MESSAGE_BOARD]: handleMessageBoard,
  [MSG.BIRD]: handleBird,
  [MSG.JOIN]: handleJoin,
  [MSG.LEAVE]: handleLeave,
  [MSG.MOVE]: handleMove,
  [MSG.ACTION]: handleAction,
  [MSG.SAY]: handleSay,
  [MSG.TYPING]: handleTyping,
  [MSG.PROFILE]: handleProfile,
  [MSG.READING]: handleReading,
};

for (const type of Object.keys(MESSAGE_HANDLERS)) {
  if (!Object.values(MSG).includes(type)) {
    throw new Error(`MESSAGE_HANDLERS has unknown message type "${type}" (not in shared protocol)`);
  }
}

/**
 * Attach realtime handlers to the widget socket.
 *
 * @param {WidgetContext} ctx
 */
export function wireSocket(ctx) {
  const { browserId, self } = ctx;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

  const connect = (socket = new WebSocket(ctx.socketUrl)) => {
    ctx.socket = socket;

    socket.addEventListener("open", () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      const init = ctx.watch
        ? { type: MSG.INIT }
        : {
            type: MSG.INIT,
            browserId,
            browserSecret: getBrowserSecret(),
            x: self.x,
            displayName: self.displayName,
            color: self.color,
            readingLabel: self.readingLabel,
            readingUrl: self.readingUrl,
            readingActive: self.readingActive,
          };
      socket.send(JSON.stringify(init));
      if (!ctx.watch && !ctx.siteKey && ctx.options.scene) {
        sendToSocket(socket, MSG.SCENE_CONFIG, { sceneConfig: ctx.options.scene });
      }
    });

    socket.addEventListener("error", () => {
      if (!self.id) {
        setStatusMessage(ctx, "Couldn't connect to TownSquare. Reconnecting…");
      }
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!message || typeof message !== "object") {
        return;
      }

      const handler = MESSAGE_HANDLERS[message.type];
      if (!handler) {
        // Unknown type: surface it rather than dropping the frame silently.
        console.warn("[townsquare] ignoring unknown message type:", message.type);
        return;
      }
      handler(ctx, socket, message);
    });

    socket.addEventListener("close", (event) => {
      if (ctx.disposed) return;

      const wasJoined = Boolean(self.id);
      self.id = null;
      ctx.challenge?.cancel();
      ctx.challenge = null;
      clearTimeout(ctx.typingTimer);
      ctx.typingTimer = null;
      self.typing = false;
      clearPeers(ctx);

      const permanentMessage = PERMANENT_CLOSE_MESSAGES.get(event.reason || "");
      if (permanentMessage) {
        setStatusMessage(ctx, permanentMessage);
        return;
      }

      if (event.reason === CLOSE_REASON.FULL) {
        setStatusMessage(ctx, "Square is full right now. Retrying…");
      } else {
        setStatusMessage(ctx, wasJoined ? "Disconnected. Reconnecting…" : "Connecting…");
      }
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      clearTimeout(ctx.reconnectTimer);
      ctx.reconnectTimer = setTimeout(() => {
        ctx.reconnectTimer = null;
        if (!ctx.disposed) {
          connect();
        }
      }, delay);
    });
  };

  connect(ctx.socket);
}
