/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage } from "./chat.mjs";
import { setWalking } from "./dom.mjs";
import {
  applyPeerState,
  applyProfileState,
  applySelfState,
  removePeer,
  setStatusMessage,
  updateStatus,
} from "./presence.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const WALK_BUMP_MS = 120;
const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;
const PERMANENT_CLOSE_REASONS = new Set([
  "kicked",
  "blocked",
  "site disabled",
  "site disabled or unknown",
  "origin not allowed",
]);

/**
 * @param {CloseEvent} event
 * @param {{ joined: boolean, opened: boolean }} state
 * @returns {string}
 */
function describeDisconnectMessage(event, { joined, opened }) {
  const reason = event.reason || "";

  if (reason === "full") {
    return "Square is full right now. Try again later.";
  }
  if (reason === "kicked") {
    return "You were removed from the square.";
  }
  if (reason === "blocked") {
    return "You can't join this square right now.";
  }
  if (reason === "site disabled" || reason === "site disabled or unknown") {
    return "This TownSquare isn't available right now.";
  }
  if (reason === "origin not allowed") {
    return "This page isn't registered to TownSquare yet.";
  }

  if (!opened || (!joined && event.code === 1006)) {
    return "Couldn't connect to TownSquare. Check your connection and try again.";
  }

  return "Disconnected. Refresh to rejoin the square.";
}

function bumpWalking(presence) {
  setWalking(presence.avatar, true);
  clearTimeout(presence.walkTimer);
  presence.walkTimer = setTimeout(() => setWalking(presence.avatar, false), WALK_BUMP_MS);
}

function isPermanentDisconnect(event) {
  return PERMANENT_CLOSE_REASONS.has(event.reason || "");
}

function clearPeers(ctx) {
  for (const id of [...ctx.peers.keys()]) {
    removePeer(ctx, id);
  }
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
    let opened = false;
    ctx.socket = socket;

    socket.addEventListener("open", () => {
      opened = true;
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      socket.send(JSON.stringify({
        type: "init",
        browserId,
        x: self.x,
        displayName: self.displayName,
        color: self.color,
      }));
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
        applySelfState(ctx, message);
        // Backlog seeds the hover tray only — it never pops a live bubble, so a
        // refresh doesn't replay everyone's last messages into the scene.
        for (const recent of message.messages || []) {
          recordMessage(self.avatar, recent);
        }
        for (const peer of message.peers) {
          applyPeerState(ctx, peer);
        }
        updateStatus(ctx);
        return;
      }

      if (message.type === "join") {
        applyPeerState(ctx, message.peer);
        return;
      }

      if (message.type === "leave") {
        removePeer(ctx, message.id);
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

        const peer = applyPeerState(ctx, message);
        if (!peer.pose) {
          bumpWalking(peer);
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

        const peer = peers.get(message.id);
        if (!peer) return;
        if (ctx.quiet) {
          recordMessage(peer.avatar, { text: message.text, at: message.at });
          return;
        }
        sayMessage(peer.avatar, { text: message.text, at: message.at });
        return;
      }

      if (message.type === "profile") {
        applyProfileState(ctx, message);
      }
    });

    socket.addEventListener("close", (event) => {
      if (ctx.disposed) return;

      const wasJoined = Boolean(self.id);
      self.id = null;
      clearPeers(ctx);

      if (isPermanentDisconnect(event)) {
        setStatusMessage(ctx, describeDisconnectMessage(event, {
          joined: wasJoined,
          opened,
        }));
        return;
      }

      setStatusMessage(ctx, wasJoined ? "Disconnected. Reconnecting…" : "Connecting…");
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
