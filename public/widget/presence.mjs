/**
 * Local and remote visitor state: peers, poses, and status text.
 */

import { addMessage } from "./chat.mjs";
import { createAvatar, renderAvatar, setFacing, updatePose } from "./dom.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 * @typedef {import("./context.mjs").PeerState} PeerState
 */

/**
 * @param {WidgetContext} ctx
 */
export function updateStatus(ctx) {
  const count = ctx.peers.size + (ctx.self.id ? 1 : 0);
  ctx.statusEl.textContent = ctx.self.id
    ? `${count} ${count === 1 ? "visitor" : "visitors"} here right now`
    : "Connecting…";
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, messages?: Array<{ text: string, at?: number }> }} peer
 * @returns {PeerState}
 */
export function addOrUpdatePeer(ctx, peer) {
  const existing = ctx.peers.get(peer.id);
  if (existing) {
    return existing;
  }

  const avatar = createAvatar({ isSelf: false });
  const nextPeer = {
    id: peer.id,
    x: peer.x,
    pose: peer.pose || null,
    propId: peer.propId || null,
    avatar,
    walkTimer: null,
  };
  ctx.peers.set(peer.id, nextPeer);
  ctx.stage.appendChild(avatar.el);
  renderAvatar(avatar, nextPeer.x);
  updatePose(avatar, nextPeer.pose);
  for (const recent of peer.messages || []) {
    addMessage(avatar, recent);
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
  ctx.self.benchRequested = false;
  ctx.self.benchZoneEnteredAt = 0;
  renderAvatar(ctx.self.avatar, ctx.self.x);
  if (ctx.self.x !== previousX) {
    setFacing(ctx.self.avatar, ctx.self.x < previousX);
  }
  updatePose(ctx.self.avatar, ctx.self.pose);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null }} peerState
 * @returns {PeerState}
 */
export function applyPeerState(ctx, peerState) {
  const peer = addOrUpdatePeer(ctx, peerState);
  const previousX = peer.x;
  peer.x = peerState.x;
  peer.pose = peerState.pose || null;
  peer.propId = peerState.propId || null;
  renderAvatar(peer.avatar, peer.x);
  if (peer.x !== previousX) {
    setFacing(peer.avatar, peer.x < previousX);
  }
  updatePose(peer.avatar, peer.pose);
  return peer;
}
