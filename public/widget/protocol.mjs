/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage } from "./chat.mjs";
import { applyBirdFlee, applyBirdSpawn, syncBirdsFromHello } from "./birds.mjs";
import { applyBallState } from "./ball.mjs";
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

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

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
        type: "init",
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
        socket.send(JSON.stringify({ type: "sceneConfig", sceneConfig: ctx.options.scene }));
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

      if (message.type === "hello") {
        self.id = message.id;
        saveBrowserSecret(message.browserSecret);
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
        applyBallState(ctx, message.ball);
        updateStatus(ctx);
        return;
      }

      // Owner changed slow mode mid-session: keep the local cooldown in sync.
      if (message.type === "chatThrottle") {
        if (typeof message.ms === "number") ctx.chatThrottleMs = message.ms;
        return;
      }

      if (message.type === "bird") {
        if (message.action === "spawn") {
          applyBirdSpawn(ctx, message);
        } else if (message.action === "flee") {
          applyBirdFlee(ctx, message);
        }
        return;
      }

      if (message.type === "ball") {
        applyBallState(ctx, message);
        return;
      }

      if (message.type === "join") {
        if (!isSolo(ctx)) {
          applyPeerState(ctx, message.peer);
        }
        return;
      }

      if (message.type === "leave") {
        if (!isSolo(ctx)) {
          removePeer(ctx, message.id);
        }
        return;
      }

      if (message.type === "move") {
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

      if (message.type === "action") {
        if (message.id !== self.id && isSolo(ctx)) return;
        if (message.action === "jump") {
          applyJump(ctx, message.id);
        } else if (message.action === "raise-hand") {
          applyRaiseHand(ctx, message.id);
        } else if (message.action === "high-five") {
          applyHighFive(ctx, message.id, message.targetId);
        }
        return;
      }

      if (message.type === "say") {
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

      if (message.type === "typing") {
        if (message.id === self.id || isSolo(ctx)) return;
        const peer = peers.get(message.id);
        peer?.avatar.el.classList.toggle("townsquare-avatar--typing", message.typing === true);
        return;
      }

      if (message.type === "profile") {
        if (message.id === self.id || !isSolo(ctx)) {
          applyProfileState(ctx, message);
        }
        return;
      }

      if (message.type === "reading") {
        if (message.id === self.id || !isSolo(ctx)) {
          applyReadingState(ctx, message);
        }
      }
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
