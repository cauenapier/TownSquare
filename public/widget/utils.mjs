/**
 * Pure browser helpers used during widget mount and connection setup.
 */

import {
  BROWSER_ID_KEY,
  CHARACTER_COLORS,
  DISPLAY_NAME_MAX,
  PROFILE_STORAGE_KEY,
  READING_LABEL_MAX,
} from "./constants.mjs";

/**
 * Stable per-browser identity used to dedupe visitors across tabs.
 *
 * @returns {string}
 */
export function getBrowserId() {
  try {
    const existing = localStorage.getItem(BROWSER_ID_KEY);
    if (existing) {
      return existing;
    }

    const nextId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(BROWSER_ID_KEY, nextId);
    return nextId;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeCharacterColor(value) {
  return CHARACTER_COLORS.includes(value) ? value : CHARACTER_COLORS[0];
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDisplayName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, DISPLAY_NAME_MAX);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeReadingLabel(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, READING_LABEL_MAX);
}

/**
 * @param {HTMLElement} root
 * @param {{ readingLabel?: string }} options
 * @returns {string}
 */
export function readCurrentPageLabel(root, options = {}) {
  const explicit = normalizeReadingLabel(options.readingLabel || root.dataset.townsquareReadingLabel || "");
  if (explicit) return explicit;

  const heading = document.querySelector("article h1, main h1, h1");
  const headingLabel = normalizeReadingLabel(heading?.textContent || "");
  if (headingLabel) return headingLabel;

  return normalizeReadingLabel(document.title);
}

/**
 * @returns {{ displayName: string, color: string }}
 */
export function getStoredProfile() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
    const data = parsed && typeof parsed === "object" ? parsed : {};
    return {
      displayName: normalizeDisplayName(data.displayName),
      color: normalizeCharacterColor(data.color),
    };
  } catch {
    return { displayName: "", color: CHARACTER_COLORS[0] };
  }
}

/**
 * @param {{ displayName: string, color: string }} profile
 * @returns {{ displayName: string, color: string }}
 */
export function saveStoredProfile(profile) {
  const normalized = {
    displayName: normalizeDisplayName(profile.displayName),
    color: normalizeCharacterColor(profile.color),
  };
  try {
    sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The server still keeps the in-memory profile for the connected session.
  }
  return normalized;
}

/**
 * Normalize a server origin string for WebSocket URL construction.
 *
 * @param {string} origin
 * @returns {string}
 */
export function normalizeOrigin(origin) {
  const normalized = new URL(origin, window.location.href);
  normalized.hash = "";
  normalized.search = "";
  normalized.pathname = normalized.pathname.replace(/\/$/, "");
  return normalized.toString().replace(/\/$/, "");
}

/**
 * Build the WebSocket URL for a TownSquare server origin and socket path.
 *
 * @param {string} serverOrigin
 * @param {string} socketPath
 * @param {string} [siteKey]
 * @returns {string}
 */
export function buildSocketUrl(serverOrigin, socketPath, siteKey = "") {
  const url = new URL(socketPath, `${serverOrigin}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (siteKey) {
    url.searchParams.set("siteKey", siteKey);
  }
  return url.toString();
}
