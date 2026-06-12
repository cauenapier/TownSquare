/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage } from "./chat.mjs";
import { setWalking } from "./dom.mjs";
import {
  applyPeerState,
  applySelfState,
  removePeer,
  setStatusMessage,
  updateStatus,
} from "./presence.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const WALK_BUMP_MS = 120;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

/** @type {Set<string>} */
const PERMANENT_CLOSE_REASONS = new Set([
  "full",
  "kicked",
  "blocked",
  "site disabled",
  "site disabled or unknown",
  "origin not allowed",
]);

/**
 * @param {CloseEvent} event
 * @returns {boolean}
 */
function shouldReconnect(event) {
  const reason = event.reason || "";
  if (PERMANENT_CLOSE_REASONS.has(reason)) {
    return false;
  }
  if (event.code === 4003) {
    return false;
  }
  return true;
}

/**
 * @param {number} attempt
 * @returns {number}
 */
function reconnectDelayMs(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
}

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

/**
 * Drop peers the server no longer reports after a reconnect handshake.
 *
 * @param {WidgetContext} ctx
 * @param {Array<{ id: string }>} peers
 */
function syncPeersFromHello(ctx, peers) {
  const peerIds = new Set(peers.map((peer) => peer.id));
  for (const id of ctx.peers.keys()) {
    if (!peerIds.has(id)) {
      removePeer(ctx, id);
    }
  }
}

/**
 * Attach realtime handlers to the widget socket.
 *
 * @param {WidgetContext} ctx
 */
export function wireSocket(ctx) {
  const { browserId, self, peers } = ctx;
  let opened = false;
  let reconnectAttempt = 0;

  const clearReconnectTimer = () => {
    if (!ctx.reconnectTimer) return;
    clearTimeout(ctx.reconnectTimer);
    ctx.reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    clearReconnectTimer();
    if (ctx.disposed) return;

    setStatusMessage(ctx, "Reconnecting…");
    const delay = reconnectDelayMs(reconnectAttempt);
    reconnectAttempt += 1;
    ctx.reconnectTimer = setTimeout(connect, delay);
  };

  const handleMessage = (event) => {
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
      syncPeersFromHello(ctx, message.peers || []);
      // Backlog seeds the hover tray only — it never pops a live bubble, so a
      // refresh doesn't replay everyone's last messages into the scene.
      for (const recent of message.messages || []) {
        recordMessage(self.avatar, recent);
      }
      for (const peer of message.peers || []) {
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
    }
  };

  const handleOpen = () => {
    opened = true;
    reconnectAttempt = 0;
    ctx.socket.send(JSON.stringify({ type: "init", browserId, x: self.x }));
  };

  const handleError = () => {
    if (!self.id) {
      setStatusMessage(ctx, "Couldn't connect to TownSquare. Check your connection and try again.");
    }
  };

  const handleClose = (event) => {
    if (ctx.disposed) return;

    if (shouldReconnect(event)) {
      scheduleReconnect();
      return;
    }

    setStatusMessage(ctx, describeDisconnectMessage(event, {
      joined: Boolean(self.id),
      opened,
    }));
  };

  function connect() {
    opened = false;
    ctx.socket = new WebSocket(ctx.socketUrl);
    ctx.socket.addEventListener("open", handleOpen);
    ctx.socket.addEventListener("error", handleError);
    ctx.socket.addEventListener("message", handleMessage);
    ctx.socket.addEventListener("close", handleClose);
  }

  ctx.reconnectTimer = null;
  connect();
}
