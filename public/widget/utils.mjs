/**
 * Pure browser helpers used during widget mount and connection setup.
 */

import {
  BROWSER_ID_KEY,
  CHARACTER_COLORS,
  DEFAULT_CHARACTER_COLOR,
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
  return CHARACTER_COLORS.includes(value) ? value : DEFAULT_CHARACTER_COLOR;
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
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeReadingUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * @param {string} title
 * @returns {string}
 */
function cleanDocumentTitle(title) {
  const siteNames = new Set([
    window.location.hostname.replace(/^www\./, ""),
    document.querySelector("article h1, main h1, h1")?.textContent?.trim().toLowerCase() || "",
  ]);
  const parts = title.split(/\s+(?:[|–—-]|·)\s+/).map((part) => normalizeReadingLabel(part));
  return parts.find((part) => part && !siteNames.has(part.toLowerCase())) || "";
}

/**
 * @returns {string}
 */
function labelFromPath() {
  const segment = window.location.pathname.split("/").filter(Boolean).pop() || "";
  if (!segment) return "";
  try {
    return normalizeReadingLabel(decodeURIComponent(segment)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " "));
  } catch {
    return normalizeReadingLabel(segment.replace(/[-_]+/g, " "));
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ readingLabel?: string, readingUrl?: string }} options
 * @returns {{ readingLabel: string, readingUrl: string }}
 */
export function readCurrentPage(root, options = {}) {
  const explicit = normalizeReadingLabel(options.readingLabel || root.dataset.townsquareReadingLabel || "");
  const documentTitle = cleanDocumentTitle(document.title);
  const pathLabel = labelFromPath();
  const metaTitle = normalizeReadingLabel(
    document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute("content") || "",
  );
  const heading = document.querySelector("article h1, main h1, h1");
  const headingLabel = normalizeReadingLabel(heading?.textContent || "");

  return {
    readingLabel: explicit || documentTitle || pathLabel || metaTitle || headingLabel || normalizeReadingLabel(document.title),
    readingUrl: normalizeReadingUrl(options.readingUrl || root.dataset.townsquareReadingUrl || window.location.href),
  };
}

/**
 * @param {HTMLElement} root
 * @param {{ readingLabel?: string }} options
 * @returns {string}
 */
export function readCurrentPageLabel(root, options = {}) {
  return readCurrentPage(root, options).readingLabel;
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
    return { displayName: "", color: DEFAULT_CHARACTER_COLOR };
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
