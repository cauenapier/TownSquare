/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage } from "./chat.mjs";
import { applyBirdFlee, applyBirdSpawn, syncBirdsFromHello } from "./birds.mjs";
import { clearPresencePose, needsStandUp, playHighFivePair, playJump, playRaisedHand, setWalking } from "./dom.mjs";
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
import { setupMessageBoard } from "./message-board.mjs";
import { solveChallenge } from "./pow.mjs";
import { MSG, GESTURE, BIRD_ACTION } from "../shared/protocol.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * Apply an owner message board pushed by the server (hosted sites). Replaces any
 * board the widget mounted with, so admin edits take effect live without the
 * owner re-pasting the embed snippet. A disabled board tears the prop down.
 *
 * @param {WidgetContext} ctx
 * @param {import("../shared/site-config.mjs").MessageBoard} board
 */
function applyServerMessageBoard(ctx, board) {
  ctx.options = { ...ctx.options, messageBoard: board };
  setupMessageBoard(ctx);
}

function isSolo(ctx) {
  return ctx.options.solo === true;
}

const WALK_BUMP_MS = 120;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;
// Server-initiated closes that no amount of retrying will fix.
const PERMANENT_CLOSE_MESSAGES = new Map([
  ["kicked", "You were removed from the square."],
  ["blocked", "You can't join this square right now."],
  ["inactive", "You were away for a while and left the square. Refresh the page to rejoin."],
  ["site disabled", "This TownSquare isn't available right now."],
  ["site disabled or unknown", "This TownSquare isn't available right now."],
  ["origin not allowed", "This page isn't registered to TownSquare yet."],
  ["rate limited", "Too many visitors are connecting from this network. Try again later."],
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

function clearPresencePoseForAction(ctx, presence) {
  clearPresencePose(presence, ctx.sceneProps);
}

function presenceById(ctx, id) {
  return id === ctx.self.id ? ctx.self : ctx.peers.get(id);
}

function applyJump(ctx, id) {
  const presence = presenceById(ctx, id);
  if (!presence) return;
  clearPresencePoseForAction(ctx, presence);
  playJump(presence.avatar);
}

function applyRaiseHand(ctx, id) {
  const presence = presenceById(ctx, id);
  if (!presence) return;
  clearPresencePoseForAction(ctx, presence);
  playRaisedHand(presence.avatar);
}

function applyHighFive(ctx, id, targetId) {
  const initiator = presenceById(ctx, id);
  const target = presenceById(ctx, targetId);
  if (!initiator || !target) return;
  const standUpFirst = needsStandUp(initiator) || needsStandUp(target);
  for (const presence of [initiator, target]) {
    clearPresencePoseForAction(ctx, presence);
  }
  playHighFivePair(initiator, target, standUpFirst);
}

/**
 * Attach realtime handlers to the widget socket.
 *
 * @param {WidgetContext} ctx
 */
export function wireSocket(ctx) {
  const { browserId, self, peers } = ctx;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

  const connect = (socket = new WebSocket(ctx.socketUrl)) => {
    ctx.socket = socket;

    socket.addEventListener("open", () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      const init = {
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
      const siteKey = ctx.options.siteKey || ctx.root.dataset.townsquareSiteKey || "";
      if (!siteKey && ctx.options.scene) {
        socket.send(JSON.stringify({ type: MSG.SCENE_CONFIG, sceneConfig: ctx.options.scene }));
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

      // Per-site bot protection: solve the proof-of-work, then the server
      // replays our init and proceeds to the normal hello.
      if (message.type === MSG.CHALLENGE) {
        if (typeof message.salt !== "string" || typeof message.difficulty !== "number") return;
        solveChallenge({ salt: message.salt, difficulty: message.difficulty }).then((nonce) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: MSG.SOLVE, nonce }));
          }
        });
        return;
      }

      if (message.type === MSG.HELLO) {
        self.id = message.id;
        saveBrowserSecret(message.browserSecret);
        ctx.widgetPlugins?.setModules(message.pluginModules || ctx.options.pluginModules || []);
        if (typeof message.chatThrottleMs === "number") ctx.chatThrottleMs = message.chatThrottleMs;
        applySelfState(ctx, message);
        // Backlog seeds the hover tray only — it never pops a live bubble, so a
        // refresh doesn't replay everyone's last messages into the scene.
        for (const recent of message.messages || []) {
          recordMessage(self.avatar, recent);
        }
        if (!isSolo(ctx)) {
          for (const peer of message.peers) {
            applyPeerState(ctx, peer);
          }
        }
        syncBirdsFromHello(ctx, message.birds);
        // Hosted sites deliver the owner's message board over the socket so edits
        // apply live; only act when the server actually sent one (self-hosted
        // embeds keep whatever board they mounted with).
        if (message.messageBoard !== undefined) {
          applyServerMessageBoard(ctx, message.messageBoard);
        }
        updateStatus(ctx);
        return;
      }

      // Owner changed slow mode mid-session: keep the local cooldown in sync.
      if (message.type === MSG.CHAT_THROTTLE) {
        if (typeof message.ms === "number") ctx.chatThrottleMs = message.ms;
        return;
      }

      // Owner edited the message board mid-session: re-render it in place.
      if (message.type === MSG.MESSAGE_BOARD) {
        if (message.messageBoard !== undefined) {
          applyServerMessageBoard(ctx, message.messageBoard);
        }
        return;
      }

      if (message.type === MSG.BIRD) {
        if (message.action === BIRD_ACTION.SPAWN) {
          applyBirdSpawn(ctx, message);
        } else if (message.action === BIRD_ACTION.FLEE) {
          applyBirdFlee(ctx, message);
        }
        return;
      }

      if (message.type === MSG.JOIN) {
        if (!isSolo(ctx)) {
          applyPeerState(ctx, message.peer);
        }
        return;
      }

      if (message.type === MSG.LEAVE) {
        if (!isSolo(ctx)) {
          removePeer(ctx, message.id);
        }
        return;
      }

      if (message.type === MSG.MOVE) {
        if (message.id === self.id) {
          const hadPose = Boolean(self.pose);
          applySelfState(ctx, message);
          if (!self.pose && !hadPose) {
            bumpWalking(self);
          }
          return;
        }

        if (isSolo(ctx)) return;

        const peer = applyPeerState(ctx, message);
        if (!peer.pose) {
          bumpWalking(peer);
        }
        return;
      }

      if (message.type === MSG.ACTION) {
        if (message.id !== self.id && isSolo(ctx)) return;
        if (message.action === GESTURE.JUMP) {
          applyJump(ctx, message.id);
        } else if (message.action === GESTURE.RAISE_HAND) {
          applyRaiseHand(ctx, message.id);
        } else if (message.action === GESTURE.HIGH_FIVE) {
          applyHighFive(ctx, message.id, message.targetId);
        }
        return;
      }

      if (message.type === MSG.SAY) {
        if (message.id === self.id) {
          if (ctx.quiet) {
            recordMessage(self.avatar, { text: message.text, at: message.at });
            return;
          }
          sayMessage(self.avatar, { text: message.text, at: message.at });
          return;
        }

        if (isSolo(ctx)) return;

        const peer = peers.get(message.id);
        if (!peer) return;
        peer.avatar.el.classList.remove("townsquare-avatar--typing");
        if (ctx.quiet) {
          recordMessage(peer.avatar, { text: message.text, at: message.at });
          return;
        }
        sayMessage(peer.avatar, { text: message.text, at: message.at });
        return;
      }

      if (message.type === MSG.TYPING) {
        if (message.id === self.id || isSolo(ctx)) return;
        const peer = peers.get(message.id);
        peer?.avatar.el.classList.toggle("townsquare-avatar--typing", message.typing === true);
        return;
      }

      if (message.type === MSG.PROFILE) {
        if (message.id === self.id || !isSolo(ctx)) {
          applyProfileState(ctx, message);
        }
        return;
      }

      if (message.type === MSG.READING) {
        if (message.id === self.id || !isSolo(ctx)) {
          applyReadingState(ctx, message);
        }
        return;
      }

      // Unknown type: surface it rather than dropping the frame silently.
      console.warn("[townsquare] ignoring unknown message type:", message.type);
    });

    socket.addEventListener("close", (event) => {
      if (ctx.disposed) return;

      const wasJoined = Boolean(self.id);
      self.id = null;
      clearTimeout(ctx.typingTimer);
      ctx.typingTimer = null;
      self.typing = false;
      clearPeers(ctx);

      const permanentMessage = PERMANENT_CLOSE_MESSAGES.get(event.reason || "");
      if (permanentMessage) {
        setStatusMessage(ctx, permanentMessage);
        return;
      }

      if (event.reason === "full") {
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
