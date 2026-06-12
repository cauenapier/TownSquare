/**
 * Local and remote visitor state: peers, poses, and status text.
 */

import { recordMessage } from "./chat.mjs";
import { createAvatar, renderAvatar, setFacing, updatePose, updatePropEffects } from "./dom.mjs";
import { markLayoutDirty } from "./movement.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 * @typedef {import("./context.mjs").PeerState} PeerState
 */

/**
 * @param {WidgetContext} ctx
 * @param {string | null} message
 */
export function setStatusMessage(ctx, message) {
  if (!message) {
    ctx.statusRowEl.hidden = true;
    ctx.statusEl.textContent = "";
    return;
  }

  ctx.statusRowEl.hidden = false;
  ctx.statusEl.textContent = message;
}

/**
 * @param {WidgetContext} ctx
 */
export function updateStatus(ctx) {
  if (ctx.self.id) {
    setStatusMessage(ctx, null);
    return;
  }

  setStatusMessage(ctx, "Connecting…");
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, messages?: Array<{ text: string, at?: number }> }} peer
 * @returns {PeerState}
 */
export function getOrCreatePeer(ctx, peer) {
  const existing = ctx.peers.get(peer.id);
  if (existing) {
    return existing;
  }

  const avatar = createAvatar({ isSelf: false });
  const nextPeer = {
    id: peer.id,
    x: 0,
    pose: null,
    propId: null,
    avatar,
    walkTimer: null,
  };
  ctx.peers.set(peer.id, nextPeer);
  ctx.stage.appendChild(avatar.el);
  // Seed the peer's backlog into their hover tray, not as live bubbles.
  for (const recent of peer.messages || []) {
    recordMessage(avatar, recent);
  }
  updateStatus(ctx);
  return nextPeer;
}

/**
 * @param {WidgetContext} ctx
 * @param {string} id
 */
export function removePeer(ctx, id) {
  const peer = ctx.peers.get(id);
  if (!peer) return;
  peer.avatar.el.remove();
  ctx.peers.delete(id);
  updateStatus(ctx);
  markLayoutDirty(ctx);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ x: number, pose?: string | null, propId?: string | null }} state
 */
export function applySelfState(ctx, state) {
  const previousX = ctx.self.x;
  ctx.self.x = state.x;
  ctx.self.pose = state.pose || null;
  ctx.self.propId = state.propId || null;
  ctx.self.settleRequested = false;
  ctx.self.settlePropId = null;
  ctx.self.propZoneEnteredAt = 0;
  renderAvatar(ctx.self.avatar, ctx.self.x);
  if (ctx.self.x !== previousX) {
    setFacing(ctx.self.avatar, ctx.self.x < previousX);
  }
  updatePose(ctx.self.avatar, ctx.self.pose);
  updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null }} peerState
 * @returns {PeerState}
 */
export function applyPeerState(ctx, peerState) {
  const hadPeer = ctx.peers.has(peerState.id);
  const peer = getOrCreatePeer(ctx, peerState);
  const previousX = peer.x;
  peer.x = peerState.x;
  peer.pose = peerState.pose || null;
  peer.propId = peerState.propId || null;
  renderAvatar(peer.avatar, peer.x);
  if (hadPeer && peer.x !== previousX) {
    setFacing(peer.avatar, peer.x < previousX);
  }
  updatePose(peer.avatar, peer.pose);
  updatePropEffects(peer.avatar, peer.x, peer.propId);
  markLayoutDirty(ctx);
  return peer;
}
