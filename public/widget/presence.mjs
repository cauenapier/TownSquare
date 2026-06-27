/**
 * Local and remote visitor state: peers, poses, and status text.
 */

import { recordMessage } from "./chat.mjs";
import { OWNER_SETUP_HASH } from "./constants.mjs";
import { createAvatar, renderAvatar, setAvatarProfile, setFacing, updatePose, updatePropEffects } from "./dom.mjs";

/**
 * When the page URL carries the owner-setup hash, returns a hint telling the
 * owner which visitor number to claim in their admin page. Otherwise null.
 *
 * @param {number | string | null} id
 * @returns {string | null}
 */
function ownerSetupHint(id) {
  if (id == null) return null;
  try {
    if (!window.location.hash.includes(OWNER_SETUP_HASH)) return null;
  } catch {
    return null;
  }
  return `You're visitor #${id} — open your TownSquare admin page and click "Make owner" on this visitor.`;
}

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
    setStatusMessage(ctx, ownerSetupHint(ctx.self.id));
    return;
  }

  setStatusMessage(ctx, "Connecting…");
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean, messages?: Array<{ text: string, at?: number }> }} peer
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
    badgeColor: peer.badgeColor || "",
    readingLabel: peer.readingLabel || "",
    readingUrl: peer.readingUrl || "",
    readingActive: peer.readingActive !== false,
    isOwner: peer.isOwner === true,
    plugins: peer.plugins && typeof peer.plugins === "object" ? peer.plugins : {},
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
  clearTimeout(peer.walkTimer);
  clearTimeout(peer.avatar.awayTimer);
  ctx.widgetPlugins?.removePresence(peer);
  peer.avatar.el.remove();
  ctx.peers.delete(id);
  updateStatus(ctx);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean }} state
 */
export function applySelfState(ctx, state) {
  const previousX = ctx.self.x;
  ctx.self.x = state.x;
  ctx.self.pose = state.pose || null;
  ctx.self.propId = state.propId || null;
  if (typeof state.displayName === "string") ctx.self.displayName = state.displayName;
  if (typeof state.color === "string") ctx.self.color = state.color;
  if (typeof state.badgeColor === "string") ctx.self.badgeColor = state.badgeColor;
  if (typeof state.readingLabel === "string") ctx.self.readingLabel = state.readingLabel;
  if (typeof state.readingUrl === "string") ctx.self.readingUrl = state.readingUrl;
  if (typeof state.readingActive === "boolean") ctx.self.readingActive = state.readingActive;
  if (typeof state.isOwner === "boolean") ctx.self.isOwner = state.isOwner;
  if (state.plugins && typeof state.plugins === "object") ctx.self.plugins = state.plugins;
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
  updatePropEffects(ctx.self.avatar, ctx.self.x, ctx.self.propId, ctx.sceneProps);
  ctx.widgetPlugins?.renderPresence(ctx.self);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean }} peerState
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
  if (typeof peerState.badgeColor === "string") peer.badgeColor = peerState.badgeColor;
  if (typeof peerState.readingLabel === "string") peer.readingLabel = peerState.readingLabel;
  if (typeof peerState.readingUrl === "string") peer.readingUrl = peerState.readingUrl;
  if (typeof peerState.readingActive === "boolean") peer.readingActive = peerState.readingActive;
  if (typeof peerState.isOwner === "boolean") peer.isOwner = peerState.isOwner;
  if (peerState.plugins && typeof peerState.plugins === "object") peer.plugins = peerState.plugins;
  renderAvatar(peer.avatar, peer.x);
  setAvatarProfile(peer.avatar, peer);
  if (hadPeer && peer.x !== previousX) {
    setFacing(peer.avatar, peer.x < previousX);
  }
  updatePose(peer.avatar, peer.pose);
  updatePropEffects(peer.avatar, peer.x, peer.propId, ctx.sceneProps);
  ctx.widgetPlugins?.renderPresence(peer);
  return peer;
}

/**
 * Copy the given scalar fields from a server message onto the matching
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
    const value = state[field];
    if (typeof value === "string" || typeof value === "boolean") presence[field] = value;
  }
  if (state.plugins && typeof state.plugins === "object") presence.plugins = state.plugins;
  setAvatarProfile(presence.avatar, presence);
  ctx.widgetPlugins?.renderPresence(presence);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, displayName?: string, color?: string, isOwner?: boolean }} profile
 */
export function applyProfileState(ctx, profile) {
  applyPresenceFields(ctx, profile, ["displayName", "color", "badgeColor", "isOwner"]);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean }} state
 */
export function applyReadingState(ctx, state) {
  applyPresenceFields(ctx, state, ["readingLabel", "readingUrl", "readingActive"]);
}
