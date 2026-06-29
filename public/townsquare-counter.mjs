/**
 * TownSquare presence counter — a tiny "N people here" badge.
 *
 * This is a deliberately small, self-contained embed: one script include, no
 * stylesheet, no WebSocket. It polls the server's read-only presence endpoint
 * (`/api/site-presence`) and renders a clickable pill. Because it never opens a
 * joining socket, showing the counter on a page does not add a visitor to the
 * square or spawn a ghost avatar — the number reflects only people who actually
 * have the full widget open.
 *
 * A town square is keyed per site (per `siteKey`, or the shared default scene
 * for self-hosters), not per page. So "here" means "in this site's square,"
 * regardless of which page each visitor is reading. Clicking the counter takes
 * the visitor to that one square:
 *   1. if the full widget is mounted on the same page (`#townsquare-root`),
 *      scroll to it;
 *   2. otherwise navigate to the configured `townSquareUrl`.
 * With neither available the counter renders as plain, non-interactive text.
 */

import { normalizeAbsoluteOrigin } from "./shared/url.mjs";

const STYLE_ID = "townsquare-counter-style";
const DEFAULT_POLL_MS = 20000;
const MIN_POLL_MS = 5000;
const WIDGET_ROOT_SELECTOR = "#townsquare-root";

/** Built-in looks. Each is just a class; every value behind them is a CSS var. */
export const COUNTER_VARIANTS = Object.freeze(["pill", "minimal", "solid", "outline"]);
const DEFAULT_VARIANT = "pill";

// Every visible value is a CSS custom property, so a host can restyle any
// variant by overriding these on `.ts-counter` (or one mount node). The variant
// classes only decide which of these vars they paint with.
const STYLES = `
.ts-counter {
  --ts-counter-accent: #2faa4f;
  --ts-counter-bg: color-mix(in oklab, Canvas 92%, CanvasText 8%);
  --ts-counter-ink: CanvasText;
  --ts-counter-radius: 999px;
  --ts-counter-font-size: 0.875rem;
  --ts-counter-pad-y: 0.4em;
  --ts-counter-pad-x: 0.75em;
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  margin: 0;
  padding: var(--ts-counter-pad-y) var(--ts-counter-pad-x);
  border: 1px solid transparent;
  border-radius: var(--ts-counter-radius);
  font: inherit;
  font-size: var(--ts-counter-font-size);
  line-height: 1.2;
  color: var(--ts-counter-ink);
  background: transparent;
  white-space: nowrap;
}
.ts-counter[data-interactive="true"] {
  cursor: pointer;
}
.ts-counter[data-interactive="true"]:hover {
  filter: brightness(1.04);
}
.ts-counter[data-interactive="true"]:focus-visible {
  outline: 2px solid var(--ts-counter-accent);
  outline-offset: 2px;
}
.ts-counter[hidden] {
  display: none;
}
.ts-counter__dot {
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
  background: var(--ts-counter-accent);
  flex: none;
}
.ts-counter[data-empty="true"] .ts-counter__dot {
  opacity: 0.4;
}
.ts-counter__label {
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: no-preference) {
  .ts-counter__dot { transition: opacity 200ms ease, background-color 200ms ease; }
}

/* pill — filled neutral badge with a soft shadow (the default). */
.ts-counter--pill {
  background: var(--ts-counter-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

/* minimal — text and dot only, no chrome. */
.ts-counter--minimal {
  --ts-counter-pad-y: 0.1em;
  --ts-counter-pad-x: 0.1em;
}

/* solid — accent-filled with contrasting ink; the dot rides on currentColor. */
.ts-counter--solid {
  background: var(--ts-counter-accent);
  color: #fff;
}
.ts-counter--solid .ts-counter__dot {
  background: currentColor;
}

/* outline — accent border, transparent fill. */
.ts-counter--outline {
  border-color: var(--ts-counter-accent);
}
`;

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/**
 * Coerce a configured destination into a safe absolute http(s) URL, or "".
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Human label for a visitor count.
 *
 * @param {number} count
 * @returns {string}
 */
function labelFor(count) {
  if (count <= 0) return "No one here yet";
  if (count === 1) return "1 person here";
  return `${count} people here`;
}

/**
 * @typedef {Object} CounterOptions
 * @property {string} [serverOrigin] TownSquare server origin. Defaults to the data attribute or the current page origin.
 * @property {string} [siteKey] Hosted site key. Omit for a self-hosted default scene.
 * @property {string} [townSquareUrl] Where to send the visitor when the full widget is not on this page.
 * @property {"pill"|"minimal"|"solid"|"outline"} [variant="pill"] Built-in look. Every variant is fully CSS-customizable via the `--ts-counter-*` variables.
 * @property {string} [accent] Accent color for the dot/fill/border. Written inline as `--ts-counter-accent`; omit to keep the stylesheet default.
 * @property {number} [pollMs=20000] Poll interval in ms (floored at 5000).
 * @property {string} [label] Accessible verb for the action, e.g. "Visit the town square".
 */

/**
 * @typedef {Object} CounterHandle
 * @property {() => void} refresh Fetch the count immediately.
 * @property {() => void} destroy Stop polling and remove the rendered counter.
 */

/**
 * Mount a presence counter into a host DOM node.
 *
 * @param {HTMLElement} root
 * @param {CounterOptions} [options]
 * @returns {CounterHandle}
 */
export function mountTownSquareCounter(root, options = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("TownSquare counter mount root must be an HTMLElement");
  }

  const serverOrigin = normalizeAbsoluteOrigin(
    options.serverOrigin
    || root.dataset.townsquareServerOrigin
    || window.location.origin,
  ) || window.location.origin;
  const siteKey = options.siteKey || root.dataset.townsquareSiteKey || "";
  const townSquareUrl = safeUrl(options.townSquareUrl || root.dataset.townsquareUrl || "");
  const pollMs = Math.max(MIN_POLL_MS, Number(options.pollMs) || DEFAULT_POLL_MS);
  const actionLabel = options.label || "Go to the town square";
  const requestedVariant = options.variant || root.dataset.townsquareVariant || DEFAULT_VARIANT;
  const variant = COUNTER_VARIANTS.includes(requestedVariant) ? requestedVariant : DEFAULT_VARIANT;
  const accent = options.accent || root.dataset.townsquareAccent || "";

  injectStyles();

  const endpoint = new URL("/api/site-presence", serverOrigin);
  if (siteKey) endpoint.searchParams.set("siteKey", siteKey);

  // A <button> when the counter can take the visitor somewhere; otherwise a
  // plain element so a non-actionable badge is not announced as a control.
  const onPageWidget = () => {
    const widget = document.querySelector(WIDGET_ROOT_SELECTOR);
    return widget && !root.contains(widget) ? widget : null;
  };
  const canAct = () => Boolean(onPageWidget()) || Boolean(townSquareUrl);

  const el = document.createElement(canAct() ? "button" : "span");
  el.className = `ts-counter ts-counter--${variant}`;
  if (el instanceof HTMLButtonElement) el.type = "button";
  el.dataset.interactive = String(el instanceof HTMLButtonElement);
  if (accent) el.style.setProperty("--ts-counter-accent", accent);

  const dot = document.createElement("span");
  dot.className = "ts-counter__dot";
  dot.setAttribute("aria-hidden", "true");
  const labelEl = document.createElement("span");
  labelEl.className = "ts-counter__label";
  labelEl.textContent = "…";
  el.append(dot, labelEl);
  root.replaceChildren(el);

  const goToSquare = () => {
    const widget = onPageWidget();
    if (widget) {
      widget.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (townSquareUrl) window.location.href = townSquareUrl;
  };
  if (el instanceof HTMLButtonElement) {
    el.addEventListener("click", goToSquare);
  }

  let disposed = false;
  let pollTimer = null;
  let inFlight = null;

  const render = (count) => {
    const empty = count <= 0;
    labelEl.textContent = labelFor(count);
    el.dataset.empty = String(empty);
    el.hidden = false;
    if (el instanceof HTMLButtonElement) {
      el.setAttribute("aria-label", `${labelFor(count)}. ${actionLabel}.`);
    } else {
      el.setAttribute("role", "status");
    }
  };

  const fetchCount = async () => {
    if (disposed || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const res = await fetch(endpoint.href, { signal: controller.signal });
      if (!res.ok) {
        // Unknown/disabled site (404) or a server error: hide rather than show
        // a stale or misleading number.
        if (!disposed) el.hidden = true;
        return;
      }
      const data = await res.json();
      const count = Number(data && data.activeVisitors);
      if (!disposed) render(Number.isFinite(count) ? Math.max(0, count) : 0);
    } catch {
      // Network error or aborted poll: keep the last rendered value.
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  };

  // Pause polling while the tab is hidden; refresh as soon as it returns so the
  // count is current when the visitor looks again.
  const onVisibility = () => {
    if (document.visibilityState === "visible") fetchCount();
  };
  document.addEventListener("visibilitychange", onVisibility);

  fetchCount();
  pollTimer = setInterval(fetchCount, pollMs);

  return {
    refresh: fetchCount,
    destroy() {
      disposed = true;
      clearInterval(pollTimer);
      pollTimer = null;
      inFlight?.abort();
      inFlight = null;
      document.removeEventListener("visibilitychange", onVisibility);
      root.replaceChildren();
    },
  };
}
