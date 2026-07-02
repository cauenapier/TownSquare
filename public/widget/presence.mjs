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

const PRESENCE_STRING_FIELDS = [
  "displayName",
  "color",
  "badgeColor",
  "readingLabel",
  "readingUrl",
];

const PRESENCE_BOOLEAN_FIELDS = [
  "readingActive",
  "isOwner",
];
const PRESENCE_PROFILE_FIELDS = [...PRESENCE_STRING_FIELDS, ...PRESENCE_BOOLEAN_FIELDS, "plugins"];

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

  const avatar = createAvatar({ isSelf: false, profile: peer, chatScope: ctx.chat });
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
 * @param {import("./context.mjs").SelfState | PeerState} presence
 * @param {Record<string, any>} state
 * @param {Array<string>} [fields]
 * @returns {boolean} Whether profile-ish fields changed and need a profile render.
 */
function assignPresenceState(presence, state, fields = PRESENCE_PROFILE_FIELDS) {
  let changed = false;
  for (const field of PRESENCE_STRING_FIELDS) {
    if (!fields.includes(field)) continue;
    if (typeof state[field] !== "string" || presence[field] === state[field]) continue;
    presence[field] = state[field];
    changed = true;
  }
  for (const field of PRESENCE_BOOLEAN_FIELDS) {
    if (!fields.includes(field)) continue;
    if (typeof state[field] !== "boolean" || presence[field] === state[field]) continue;
    presence[field] = state[field];
    changed = true;
  }
  if (fields.includes("plugins") && state.plugins && typeof state.plugins === "object" && presence.plugins !== state.plugins) {
    presence.plugins = state.plugins;
    changed = true;
  }
  return changed;
}

/**
 * @param {WidgetContext} ctx
 * @param {import("./context.mjs").SelfState | PeerState} presence
 * @param {number} previousX
 * @param {{ profileChanged: boolean, faceOnMove?: boolean }} options
 */
function renderPresence(ctx, presence, previousX, { profileChanged, faceOnMove = true }) {
  renderAvatar(presence.avatar, presence.x);
  if (profileChanged) {
    setAvatarProfile(presence.avatar, presence);
  }
  if (faceOnMove && presence.x !== previousX) {
    setFacing(presence.avatar, presence.x < previousX);
  }
  updatePose(presence.avatar, presence.pose);
  updatePropEffects(presence.avatar, presence.x, presence.propId, ctx.sceneProps);
  ctx.widgetPlugins?.renderPresence(presence);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, badgeColor?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean, isOwner?: boolean, plugins?: Record<string, any> }} state
 */
export function applySelfState(ctx, state) {
  const previousX = ctx.self.x;
  ctx.self.x = state.x;
  ctx.self.pose = state.pose || null;
  ctx.self.propId = state.propId || null;
  const profileChanged = assignPresenceState(ctx.self, state);
  if (ctx.self.pose) {
    // The server snapped us onto a seat; abandon any pending tap destination.
    ctx.self.targetX = null;
  }
  ctx.self.settleRequested = false;
  ctx.self.settlePropId = null;
  ctx.self.propZoneEnteredAt = 0;
  renderPresence(ctx, ctx.self, previousX, { profileChanged });
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, x: number, pose?: string | null, propId?: string | null, displayName?: string, color?: string, badgeColor?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean, isOwner?: boolean, plugins?: Record<string, any> }} peerState
 * @returns {PeerState}
 */
export function applyPeerState(ctx, peerState) {
  const hadPeer = ctx.peers.has(peerState.id);
  const peer = getOrCreatePeer(ctx, peerState);
  const previousX = peer.x;
  peer.x = peerState.x;
  peer.pose = peerState.pose || null;
  peer.propId = peerState.propId || null;
  const profileChanged = assignPresenceState(peer, peerState);
  renderPresence(ctx, peer, previousX, { profileChanged, faceOnMove: hadPeer });
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
  const profileChanged = assignPresenceState(presence, state, fields);
  if (profileChanged) {
    setAvatarProfile(presence.avatar, presence);
    ctx.widgetPlugins?.renderPresence(presence);
  }
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, displayName?: string, color?: string, badgeColor?: string, isOwner?: boolean }} profile
 */
export function applyProfileState(ctx, profile) {
  applyPresenceFields(ctx, profile, ["displayName", "color", "badgeColor", "isOwner", "plugins"]);
}

/**
 * @param {WidgetContext} ctx
 * @param {{ id: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean }} state
 */
export function applyReadingState(ctx, state) {
  applyPresenceFields(ctx, state, ["readingLabel", "readingUrl", "readingActive", "plugins"]);
}
