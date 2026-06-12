/**
 * WebSocket wire-up and server message routing for the widget runtime.
 */

import { recordMessage, sayMessage } from "./chat.mjs";
import { setWalking } from "./dom.mjs";
import {
  applyPeerState,
  applySelfState,
  removePeer,
  updateStatus,
} from "./presence.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const WALK_BUMP_MS = 120;

function bumpWalking(presence) {
  setWalking(presence.avatar, true);
  clearTimeout(presence.walkTimer);
  presence.walkTimer = setTimeout(() => setWalking(presence.avatar, false), WALK_BUMP_MS);
}

/**
 * Attach realtime handlers to the widget socket.
 *
 * @param {WidgetContext} ctx
 */
export function wireSocket(ctx) {
  const { socket, browserId, self, peers, statusEl } = ctx;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "init", browserId, x: self.x }));
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
        const wasSitting = self.pose === "sitting";
        applySelfState(ctx, message);
        if (!self.pose && !wasSitting) {
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
  });

  socket.addEventListener("close", (event) => {
    statusEl.textContent = event.code === 1006 || event.reason === "full"
      ? "Square is full right now. Try again later."
      : "Disconnected. Refresh to rejoin the square.";
  });
}
