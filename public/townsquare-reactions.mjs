/**
 * TownSquare reactions — a row of emoji buttons (❤️ 👍 👏 …) with live counts.
 *
 * Like the presence counter this is a small, self-contained embed: one script
 * include, no stylesheet, no WebSocket. Counts are kept per page (default: the
 * host page's pathname) within a site. The server stores only totals; which
 * reactions this visitor has toggled is remembered in their browser, so a
 * second click on the same reaction takes it back.
 *
 * Writes are accepted only from the site's allowed origins, so the bar only
 * records reactions on the site it was registered for.
 */

import { normalizeAbsoluteOrigin } from "./lib/url.mjs";
import { REACTIONS } from "./lib/shared-constants.mjs";

const STYLE_ID = "townsquare-reactions-style";
const REQUEST_TIMEOUT_MS = 10000;
const STORAGE_PREFIX = "townsquare-reactions:";

/** Every reaction key the server accepts, in display order. */
export const REACTION_KEYS = Object.freeze(Object.keys(REACTIONS));
const DEFAULT_REACTIONS = Object.freeze(["heart", "thumbs-up", "clap"]);

// Every visible value is a CSS custom property so a host can restyle the bar by
// overriding these on `.ts-reactions`.
const STYLES = `
.ts-reactions {
  --ts-reactions-accent: #2faa4f;
  --ts-reactions-bg: color-mix(in oklab, Canvas 92%, CanvasText 8%);
  --ts-reactions-ink: CanvasText;
  --ts-reactions-radius: 999px;
  --ts-reactions-font-size: 0.875rem;
  --ts-reactions-gap: 0.4em;
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--ts-reactions-gap);
  margin: 0;
  font-size: var(--ts-reactions-font-size);
}
.ts-reactions[hidden] {
  display: none;
}
.ts-reactions__button {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  margin: 0;
  padding: 0.35em 0.7em;
  border: 1px solid transparent;
  border-radius: var(--ts-reactions-radius);
  font: inherit;
  line-height: 1.2;
  color: var(--ts-reactions-ink);
  background: var(--ts-reactions-bg);
  cursor: pointer;
}
.ts-reactions__button:hover {
  filter: brightness(1.04);
}
.ts-reactions__button:focus-visible {
  outline: 2px solid var(--ts-reactions-accent);
  outline-offset: 2px;
}
.ts-reactions__button[aria-pressed="true"] {
  border-color: var(--ts-reactions-accent);
  background: color-mix(in oklab, var(--ts-reactions-accent) 16%, var(--ts-reactions-bg));
}
.ts-reactions__count {
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: no-preference) {
  .ts-reactions__button { transition: transform 120ms ease, background-color 160ms ease; }
  .ts-reactions__button:active { transform: scale(0.94); }
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/** localStorage can throw (private mode, blocked storage); treat it as empty. */
function readReacted(storageKey) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function writeReacted(storageKey, reacted) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...reacted]));
  } catch {
    // Storage unavailable: the toggle still works for this page view.
  }
}

/**
 * @typedef {Object} ReactionsOptions
 * @property {string} [serverOrigin] TownSquare server origin. Defaults to the data attribute or the current page origin.
 * @property {string} [siteKey] Hosted site key. Omit for a self-hosted server.
 * @property {string} [page] Which page the counts belong to. Defaults to `location.pathname`; set it to share counts across URLs (e.g. a post id).
 * @property {string[]} [reactions] Subset of {@link REACTION_KEYS} to show, in order. Defaults to heart, thumbs-up, clap.
 * @property {string} [accent] Accent color for the focus ring and selected state (`--ts-reactions-accent`).
 */

/**
 * @typedef {Object} ReactionsHandle
 * @property {() => Promise<void>} refresh Re-fetch the counts.
 * @property {() => void} destroy Remove the rendered bar.
 */

/**
 * Mount a reactions bar into a host DOM node.
 *
 * @param {HTMLElement} root
 * @param {ReactionsOptions} [options]
 * @returns {ReactionsHandle}
 */
export function mountTownSquareReactions(root, options = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("TownSquare reactions mount root must be an HTMLElement");
  }

  const serverOrigin = normalizeAbsoluteOrigin(
    options.serverOrigin
    || root.dataset.townsquareServerOrigin
    || window.location.origin,
  ) || window.location.origin;
  const siteKey = options.siteKey || root.dataset.townsquareSiteKey || "";
  const page = String(options.page || root.dataset.townsquarePage || window.location.pathname || "/");
  const requested = options.reactions
    || (root.dataset.townsquareReactions || "").split(",").map((key) => key.trim()).filter(Boolean);
  const keys = [...new Set(requested)].filter((key) => REACTION_KEYS.includes(key));
  const shown = keys.length > 0 ? keys : DEFAULT_REACTIONS;
  const accent = options.accent || root.dataset.townsquareAccent || "";

  injectStyles();

  const endpoint = new URL("/api/reactions", serverOrigin);
  const storageKey = `${STORAGE_PREFIX}${serverOrigin}|${siteKey}|${page}`;
  const reacted = readReacted(storageKey);
  let counts = {};
  let disposed = false;
  const pending = new Set();

  const bar = document.createElement("div");
  bar.className = "ts-reactions";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Reactions");
  if (accent) bar.style.setProperty("--ts-reactions-accent", accent);

  const buttons = new Map(shown.map((key) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ts-reactions__button";
    button.dataset.reaction = key;
    const emoji = document.createElement("span");
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = REACTIONS[key];
    const count = document.createElement("span");
    count.className = "ts-reactions__count";
    button.append(emoji, count);
    button.addEventListener("click", () => toggle(key));
    bar.append(button);
    return [key, { button, count }];
  }));
  root.replaceChildren(bar);

  const render = () => {
    for (const [key, { button, count }] of buttons) {
      const value = Math.max(0, Number(counts[key]) || 0);
      const pressed = reacted.has(key);
      count.textContent = String(value);
      button.setAttribute("aria-pressed", String(pressed));
      button.setAttribute("aria-label", `${key.replace("-", " ")}: ${value}`);
    }
  };

  const request = async (init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(endpoint);
      if (!init) {
        if (siteKey) url.searchParams.set("siteKey", siteKey);
        url.searchParams.set("page", page);
      }
      const res = await fetch(url.href, { ...init, signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return data && typeof data.counts === "object" ? data.counts : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  const refresh = async () => {
    const next = await request();
    if (disposed) return;
    if (!next) {
      // Unknown/disabled site or server unreachable: hide rather than show zeros.
      bar.hidden = true;
      return;
    }
    counts = next;
    bar.hidden = false;
    render();
  };

  // Optimistic: flip the local state and count immediately, then reconcile with
  // the server's totals, or roll back if the write was rejected.
  async function toggle(key) {
    if (pending.has(key)) return;
    pending.add(key);
    const adding = !reacted.has(key);
    const previous = { ...counts };
    if (adding) reacted.add(key);
    else reacted.delete(key);
    counts = { ...counts, [key]: Math.max(0, (Number(counts[key]) || 0) + (adding ? 1 : -1)) };
    render();

    const next = await request({
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ siteKey, page, reaction: key, action: adding ? "add" : "remove" }),
    });
    pending.delete(key);
    if (disposed) return;
    if (next) {
      counts = next;
      writeReacted(storageKey, reacted);
    } else {
      counts = previous;
      if (adding) reacted.delete(key);
      else reacted.add(key);
    }
    render();
  }

  render();
  void refresh();

  return {
    refresh,
    destroy() {
      disposed = true;
      root.replaceChildren();
    },
  };
}
