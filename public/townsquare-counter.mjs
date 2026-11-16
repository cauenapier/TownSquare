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
 * regardless of which page each visitor is reading. `count` picks what the
 * badge reports: the whole site, only the visitors reading this page (as
 * reported by their widget), or both. `labelStyle: "short"` trims the text to
 * "5 here"; the full sentence stays in the tooltip and accessible label.
 * Clicking the counter takes the visitor to that one square:
 *   1. if the full widget is mounted on the same page, scroll to it;
 *   2. otherwise navigate to the configured `townSquareUrl`.
 * With neither available the counter renders as plain, non-interactive text.
 */

import { normalizeAbsoluteOrigin } from "./lib/url.mjs";

const STYLE_ID = "townsquare-counter-style";
const DEFAULT_POLL_MS = 20000;
const MIN_POLL_MS = 5000;
const POLL_TIMEOUT_MS = 10000;
// The widget marks its mount root with `data-townsquare-mounted`, so the square
// is found whatever id the host gave it; `#townsquare-root` is the snippet's
// default id and covers a square that has not mounted yet.
const WIDGET_ROOT_SELECTOR = "[data-townsquare-mounted], #townsquare-root";

/** Built-in looks. Each is just a class; every value behind them is a CSS var. */
export const COUNTER_VARIANTS = Object.freeze(["pill", "minimal", "solid", "outline"]);
const DEFAULT_VARIANT = "pill";
/** What the badge counts: the whole site's square, this page's readers, or both. */
export const COUNTER_COUNTS = Object.freeze(["site", "page", "both"]);
/** "full" sentences ("5 people here") or "short" ones ("5 here"). */
export const COUNTER_LABEL_STYLES = Object.freeze(["full", "short"]);

// Styling contract (documented in docs/embed-styling.md):
// - Every rule except `[hidden]` is wrapped in :where(), so it has zero
//   specificity and any host selector overrides it, whether the host
//   stylesheet loads before or after this one.
// - Public `--ts-counter-*` variables are inputs the embed never declares, so a
//   host may set them on the counter, any ancestor, or :root. Defaults and
//   variant looks live in private `--_ts-counter-*` variables underneath.
const STYLES = `
:where(.ts-counter) {
  --_ts-counter-accent: var(--ts-counter-accent, #2faa4f);
  --_ts-counter-bg: transparent;
  --_ts-counter-ink: CanvasText;
  --_ts-counter-border-color: transparent;
  --_ts-counter-shadow: none;
  --_ts-counter-pad-y: 0.4em;
  --_ts-counter-pad-x: 0.75em;
  --_ts-counter-dot-color: var(--_ts-counter-accent);
  display: inline-flex;
  align-items: center;
  gap: var(--ts-counter-gap, 0.5em);
  margin: 0;
  padding: var(--ts-counter-pad-y, var(--_ts-counter-pad-y)) var(--ts-counter-pad-x, var(--_ts-counter-pad-x));
  border: var(--ts-counter-border-width, 1px) solid var(--ts-counter-border-color, var(--_ts-counter-border-color));
  border-radius: var(--ts-counter-radius, 999px);
  font: inherit;
  font-size: var(--ts-counter-font-size, 0.875rem);
  line-height: 1.2;
  color: var(--ts-counter-ink, var(--_ts-counter-ink));
  background: var(--ts-counter-bg, var(--_ts-counter-bg));
  box-shadow: var(--ts-counter-shadow, var(--_ts-counter-shadow));
  white-space: nowrap;
}
:where(.ts-counter[data-interactive="true"]) {
  cursor: pointer;
}
:where(.ts-counter[data-interactive="true"]:hover) {
  filter: brightness(1.04);
}
:where(.ts-counter[data-interactive="true"]:focus-visible) {
  outline: 2px solid var(--ts-counter-focus-color, var(--_ts-counter-accent));
  outline-offset: 2px;
}
:where(.ts-counter__dot) {
  width: var(--ts-counter-dot-size, 0.55em);
  height: var(--ts-counter-dot-size, 0.55em);
  border-radius: 50%;
  background: var(--ts-counter-dot-color, var(--_ts-counter-dot-color));
  flex: none;
}
:where(.ts-counter[data-empty="true"] .ts-counter__dot) {
  opacity: 0.4;
}
:where(.ts-counter__label) {
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: no-preference) {
  :where(.ts-counter__dot) { transition: opacity 200ms ease, background-color 200ms ease; }
}

/* pill: filled neutral badge with a soft shadow (the default). */
:where(.ts-counter--pill) {
  --_ts-counter-bg: color-mix(in oklab, Canvas 92%, CanvasText 8%);
  --_ts-counter-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
/* minimal: text and dot only, no chrome. */
:where(.ts-counter--minimal) {
  --_ts-counter-pad-y: 0.1em;
  --_ts-counter-pad-x: 0.1em;
}
/* solid: accent fill with white ink; the dot follows the ink. */
:where(.ts-counter--solid) {
  --_ts-counter-bg: var(--_ts-counter-accent);
  --_ts-counter-ink: #fff;
  --_ts-counter-dot-color: currentColor;
}
/* outline: accent border, transparent fill. */
:where(.ts-counter--outline) {
  --_ts-counter-border-color: var(--_ts-counter-accent);
}

/* Normal specificity on purpose: a hidden counter stays hidden even when the
   host sets its own display. */
.ts-counter[hidden] {
  display: none;
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

const people = (n) => (n === 1 ? "1 person" : `${n} people`);

/**
 * Badge text for the site and page counts.
 *
 * @param {{ site: number, page: number }} counts
 * @param {{ count?: "site"|"page"|"both", labelStyle?: "full"|"short" }} [options]
 * @returns {string}
 */
export function counterLabel({ site, page }, { count = "site", labelStyle = "full" } = {}) {
  if (labelStyle === "short") {
    if (count === "both") return `${site} here · ${page} on page`;
    return `${count === "page" ? page : site} here`;
  }
  if (count === "page") return page <= 0 ? "No one on this page yet" : `${people(page)} on this page`;
  if (site <= 0) return "No one here yet";
  return count === "both" ? `${people(site)} here · ${page} on this page` : `${people(site)} here`;
}

/**
 * @typedef {Object} CounterOptions
 * @property {string} [serverOrigin] TownSquare server origin. Defaults to the data attribute or the current page origin.
 * @property {string} [siteKey] Hosted site key. Omit for a self-hosted default scene.
 * @property {string} [townSquareUrl] Where to send the visitor when the full widget is not on this page.
 * @property {"pill"|"minimal"|"solid"|"outline"} [variant="pill"] Built-in look. Every variant is fully CSS-customizable via the `--ts-counter-*` variables.
 * @property {string} [accent] Accent color for the dot/fill/border. Written inline as `--ts-counter-accent`; omit to keep the default or a value the host sets in CSS.
 * @property {"site"|"page"|"both"} [count="site"] What to count: the whole site's square, only visitors reading this page (matched by path), or both.
 * @property {"full"|"short"} [labelStyle="full"] "full" reads "5 people here"; "short" reads "5 here" and keeps the full sentence in the tooltip.
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
  const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);
  const count = pick(options.count || root.dataset.townsquareCount, COUNTER_COUNTS);
  const labelStyle = pick(options.labelStyle || root.dataset.townsquareLabelStyle, COUNTER_LABEL_STYLES);

  injectStyles();

  const endpoint = new URL("/api/site-presence", serverOrigin);
  if (siteKey) endpoint.searchParams.set("siteKey", siteKey);
  if (count !== "site") endpoint.searchParams.set("page", window.location.pathname || "/");

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

  const render = (counts) => {
    const label = counterLabel(counts, { count, labelStyle });
    const fullLabel = counterLabel(counts, { count });
    labelEl.textContent = label;
    if (labelStyle === "short") el.title = fullLabel;
    else el.removeAttribute("title");
    el.dataset.empty = String((count === "page" ? counts.page : counts.site) <= 0);
    el.hidden = false;
    if (el instanceof HTMLButtonElement) {
      el.setAttribute("aria-label", `${fullLabel}. ${actionLabel}.`);
    } else {
      el.setAttribute("role", "status");
      el.setAttribute("aria-label", fullLabel);
    }
  };

  const fetchCount = async () => {
    if (disposed || inFlight) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    inFlight = { controller, timeout };
    try {
      const res = await fetch(endpoint.href, { signal: controller.signal });
      if (!res.ok) {
        // Unknown/disabled site (404) or a server error: hide rather than show
        // a stale or misleading number.
        if (!disposed) el.hidden = true;
        return;
      }
      const data = await res.json();
      const toCount = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
      if (!disposed) render({ site: toCount(data?.activeVisitors), page: toCount(data?.pageVisitors) });
    } catch {
      // Network error or aborted poll: keep the last rendered value.
    } finally {
      clearTimeout(timeout);
      if (inFlight?.controller === controller) inFlight = null;
    }
  };

  // Pause polling while the tab is hidden; refresh as soon as it returns so the
  // count is current when the visitor looks again.
  const onVisibility = () => {
    if (document.visibilityState === "visible") fetchCount();
  };
  document.addEventListener("visibilitychange", onVisibility);

  fetchCount();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") fetchCount();
  }, pollMs);

  return {
    refresh: fetchCount,
    destroy() {
      disposed = true;
      clearInterval(pollTimer);
      pollTimer = null;
      if (inFlight) {
        clearTimeout(inFlight.timeout);
        inFlight.controller.abort();
      }
      inFlight = null;
      document.removeEventListener("visibilitychange", onVisibility);
      root.replaceChildren();
    },
  };
}
