/**
 * Local and remote visitor state: peers, poses, and status text.
 */

import { recordMessage } from "./chat.mjs";
import { createAvatar, renderAvatar, setAvatarProfile, setFacing, updatePose, updatePropEffects } from "./dom.mjs";

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
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string, messages?: Array<{ text: string, at?: number }> }} peer
 * @returns {PeerState}
 */
export function getOrCreatePeer(ctx, peer) {
  const existing = ctx.peers.get(peer.id);
  if (existing) {
    return existing;
  }

  const avatar = createAvatar({ isSelf: false, profile: peer });
  const nextPeer = {
    id: peer.id,
    x: 0,
    pose: null,
    propId: null,
    displayName: peer.displayName || "",
    color: peer.color || "",
    readingLabel: peer.readingLabel || "",
    readingUrl: peer.readingUrl || "",
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
}

/**
 * @param {WidgetContext} ctx
 * @param {{ x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string }} state
 */
export function applySelfState(ctx, state) {
  const previousX = ctx.self.x;
  ctx.self.x = state.x;
  ctx.self.pose = state.pose || null;
  ctx.self.propId = state.propId || null;
  if (typeof state.displayName === "string") ctx.self.displayName = state.displayName;
  if (typeof state.color === "string") ctx.self.color = state.color;
  if (typeof state.readingLabel === "string") ctx.self.readingLabel = state.readingLabel;
  if (typeof state.readingUrl === "string") ctx.self.readingUrl = state.readingUrl;
  if (ctx.self.pose) {
    // The server snapped us onto a seat; abandon any pending tap destination.
    ctx.self.targetX = null;
  }
  ctx.self.settleRequested = false;
  ctx.self.settlePropId = null;
  ctx.self.propZoneEnteredAt = 0;
  renderAvatar(ctx.self.avatar, ctx.self.x);
  setAvatarProfile(ctx.self.avatar, ctx.self);
  if (ctx.self.x !== previousX) {
    setFacing(ctx.self.avatar, ctx.self.x < previousX);
  }
  updatePose(ctx.self.avatar, ctx.self.pose);
  updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string }} peerState
 * @returns {PeerState}
 */
export function applyPeerState(ctx, peerState) {
  const hadPeer = ctx.peers.has(peerState.id);
  const peer = getOrCreatePeer(ctx, peerState);
  const previousX = peer.x;
  peer.x = peerState.x;
  peer.pose = peerState.pose || null;
  peer.propId = peerState.propId || null;
  if (typeof peerState.displayName === "string") peer.displayName = peerState.displayName;
  if (typeof peerState.color === "string") peer.color = peerState.color;
  if (typeof peerState.readingLabel === "string") peer.readingLabel = peerState.readingLabel;
  if (typeof peerState.readingUrl === "string") peer.readingUrl = peerState.readingUrl;
  renderAvatar(peer.avatar, peer.x);
  setAvatarProfile(peer.avatar, peer);
  if (hadPeer && peer.x !== previousX) {
    setFacing(peer.avatar, peer.x < previousX);
  }
  updatePose(peer.avatar, peer.pose);
  updatePropEffects(peer.avatar, peer.x, peer.propId);
  return peer;
}

/**
 * Copy the given string fields from a server message onto the matching
 * presence (self or peer) and re-render that figure's profile.
 *
 * @param {WidgetContext} ctx
 * @param {{ id: string }} state
 * @param {Array<string>} fields
 */
function applyPresenceFields(ctx, state, fields) {
  const presence = state.id === ctx.self.id ? ctx.self : ctx.peers.get(state.id);
  if (!presence) return;
  for (const field of fields) {
    if (typeof state[field] === "string") presence[field] = state[field];
  }
  setAvatarProfile(presence.avatar, presence);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, displayName?: string, color?: string }} profile
 */
export function applyProfileState(ctx, profile) {
  applyPresenceFields(ctx, profile, ["displayName", "color"]);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, readingLabel?: string, readingUrl?: string }} state
 */
export function applyReadingState(ctx, state) {
  applyPresenceFields(ctx, state, ["readingLabel", "readingUrl"]);
}
