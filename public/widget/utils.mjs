/**
 * Pure browser helpers used during widget mount and connection setup.
 */

import { normalizeAbsoluteOrigin } from "../shared/url.mjs";
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

/** @typedef {"auto" | "light" | "dark" | "host"} WidgetTheme */

const HOST_THEME_ATTRIBUTE_FILTER = ["class", "data-theme", "data-bs-theme", "data-color-mode"];
const HOST_THEME_SELECTORS = Object.freeze({
  dark: Object.freeze([
    "html.dark",
    "body.dark",
    "html[data-theme='dark']",
    "body[data-theme='dark']",
    "html[data-bs-theme='dark']",
    "body[data-bs-theme='dark']",
    "html[data-color-mode='dark']",
    "body[data-color-mode='dark']",
  ]),
  light: Object.freeze([
    "html.light",
    "body.light",
    "html[data-theme='light']",
    "body[data-theme='light']",
    "html[data-bs-theme='light']",
    "body[data-bs-theme='light']",
    "html[data-color-mode='light']",
    "body[data-color-mode='light']",
  ]),
});

/**
 * Resolve the widget color theme from mount options or a pre-set root attribute.
 *
 * `auto` (default) follows `prefers-color-scheme`. `host` follows common
 * host-page theme signals such as `html.dark` and `data-theme="dark"`.
 *
 * @param {HTMLElement} root
 * @param {{ theme?: string }} [options]
 * @returns {WidgetTheme}
 */
export function resolveWidgetTheme(root, options = {}) {
  const raw = options.theme || root.dataset.townsquareTheme || "auto";
  if (typeof raw !== "string") return "auto";
  const theme = raw.trim().toLowerCase();
  if (theme === "light" || theme === "dark" || theme === "host") return theme;
  return "auto";
}

/**
 * Host pages that set `color-scheme: light|dark` without class/data-theme markers.
 *
 * @returns {"light" | "dark" | null}
 */
function readHostColorScheme() {
  for (const el of [document.documentElement, document.body]) {
    if (!(el instanceof HTMLElement)) continue;
    const scheme = getComputedStyle(el).colorScheme.trim().toLowerCase();
    if (scheme === "dark" || scheme === "light") return scheme;
  }
  return null;
}

/**
 * @param {HTMLElement} root
 */
function syncHostTheme(root) {
  const dark = HOST_THEME_SELECTORS.dark.some((selector) => document.querySelector(selector));
  const light = HOST_THEME_SELECTORS.light.some((selector) => document.querySelector(selector));

  if (dark && !light) {
    root.dataset.townsquareTheme = "dark";
    return;
  }
  if (light) {
    root.dataset.townsquareTheme = "light";
    return;
  }

  // Unmarked light pages stay light even when macOS is in dark mode; only `auto`
  // follows `prefers-color-scheme`.
  root.dataset.townsquareTheme = readHostColorScheme() || "light";
}

/**
 * Apply the resolved theme to the mount root for token.css selectors.
 *
 * @param {HTMLElement} root
 * @param {WidgetTheme} theme
 * @returns {() => void}
 */
export function applyWidgetTheme(root, theme) {
  if (theme === "host") {
    syncHostTheme(root);
    if (typeof MutationObserver !== "function") return () => {};

    const observer = new MutationObserver(() => syncHostTheme(root));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: HOST_THEME_ATTRIBUTE_FILTER,
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: HOST_THEME_ATTRIBUTE_FILTER,
      });
    }

    return () => observer.disconnect();
  }

  if (theme === "auto") {
    root.dataset.townsquareTheme = "auto";
    return () => {};
  }
  root.dataset.townsquareTheme = theme;
  return () => {};
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
  const normalized = normalizeAbsoluteOrigin(origin);
  if (!normalized) {
    throw new Error(`Invalid TownSquare server origin: ${String(origin)}`);
  }
  return normalized;
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
