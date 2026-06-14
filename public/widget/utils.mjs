/**
 * Pure browser helpers used during widget mount and connection setup.
 */

import {
  BROWSER_ID_KEY,
  BROWSER_SECRET_KEY,
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
 * Server-issued secret that proves ownership of a browserId identity.
 *
 * @returns {string}
 */
export function getBrowserSecret() {
  try {
    return localStorage.getItem(BROWSER_SECRET_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} browserSecret
 */
export function saveBrowserSecret(browserSecret) {
  if (typeof browserSecret !== "string" || !browserSecret) return;
  try {
    localStorage.setItem(BROWSER_SECRET_KEY, browserSecret);
  } catch {
    // Reconnect will mint a fresh ephemeral identity if storage is unavailable.
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
 * @param {string} headingLabel
 * @returns {string}
 */
function cleanDocumentTitle(title, headingLabel) {
  const siteNames = new Set([
    window.location.hostname.replace(/^www\./, ""),
    headingLabel.toLowerCase(),
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

/** @typedef {"auto" | "light" | "dark"} WidgetTheme */

/**
 * Resolve the widget color theme from mount options or a pre-set root attribute.
 *
 * `auto` (default) follows `prefers-color-scheme`. Host pages with a manual
 * dark toggle should pass `theme: "dark"` or set `data-townsquare-theme="dark"`
 * on the mount root before calling `mountTownSquare`.
 *
 * @param {HTMLElement} root
 * @param {{ theme?: string }} [options]
 * @returns {WidgetTheme}
 */
export function resolveWidgetTheme(root, options = {}) {
  const raw = options.theme || root.dataset.townsquareTheme || "auto";
  if (typeof raw !== "string") return "auto";
  const theme = raw.trim().toLowerCase();
  if (theme === "light" || theme === "dark") return theme;
  return "auto";
}

/**
 * Apply the resolved theme to the mount root for token.css selectors.
 *
 * @param {HTMLElement} root
 * @param {WidgetTheme} theme
 */
export function applyWidgetTheme(root, theme) {
  if (theme === "auto") {
    root.removeAttribute("data-townsquare-theme");
    return;
  }
  root.dataset.townsquareTheme = theme;
}

/**
 * @param {HTMLElement} root
 * @param {{ readingLabel?: string, readingUrl?: string }} options
 * @returns {{ readingLabel: string, readingUrl: string }}
 */
export function readCurrentPage(root, options = {}) {
  const explicit = normalizeReadingLabel(options.readingLabel || root.dataset.townsquareReadingLabel || "");
  const heading = document.querySelector("article h1, main h1, h1");
  const headingLabel = normalizeReadingLabel(heading?.textContent || "");
  const documentTitle = cleanDocumentTitle(document.title, headingLabel);
  const pathLabel = labelFromPath();
  const metaTitle = normalizeReadingLabel(
    document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute("content") || "",
  );

  return {
    readingLabel: explicit || documentTitle || pathLabel || metaTitle || headingLabel || normalizeReadingLabel(document.title),
    readingUrl: normalizeReadingUrl(options.readingUrl || root.dataset.townsquareReadingUrl || window.location.href),
  };
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
