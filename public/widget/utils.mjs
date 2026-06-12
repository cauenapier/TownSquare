/**
 * Pure browser helpers used during widget mount and connection setup.
 */

import { BROWSER_ID_KEY } from "./constants.mjs";

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
