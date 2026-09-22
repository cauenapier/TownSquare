import { createTownSquareMap, fetchRandomTown } from "./map-engine.mjs";

/**
 * Mount a compact, read-mostly TownSquare map for embedding outside the
 * TownSquare server's own origin (e.g. the marketing homepage). Loaded as a
 * plain ES module — callers typically `import()` it lazily and cross-origin,
 * so it takes no DOM ids and instead wires up whatever elements it is given.
 *
 * Unlike the full /map page, the embedded map:
 *  - always shows the whole world (no pan/zoom UI, nothing to get "lost" in)
 *  - never hijacks wheel or touch scrolling, so normal page scroll is untouched
 *  - shows an inline detail panel next to the map instead of a modal dialog
 *  - hides lower-priority town labels until hover/focus/selection
 *
 * @param {object} options
 * @param {HTMLElement} options.root Canvas container the SVG mounts into.
 * @param {HTMLElement} [options.detailPanel] Inline detail container. If
 *   given, it is populated/shown/hidden automatically; pass `onSelect`
 *   instead (or as well) to fully own the detail UI.
 * @param {HTMLElement} [options.statusEl]
 * @param {string} [options.fetchBase] Origin to fetch `/api/map*` and
 *   `/api/discovery/random` against — required cross-origin (e.g. the
 *   landing page in local dev, where it is not the same origin as the
 *   TownSquare server).
 * @param {(site: object|null) => void} [options.onSelect]
 * @param {(stats: {towns:number, activeLast30d:number, visitorsNow:number}) => void} [options.onStats]
 * @param {(text: string) => void} [options.onStatus]
 */
export function mountTownSquareMapEmbed({
  root,
  detailPanel = null,
  statusEl = null,
  fetchBase = "",
  onSelect,
  onStats = () => {},
  onStatus = statusEl instanceof HTMLElement ? (text) => { statusEl.textContent = text; } : () => {},
} = {}) {
  if (!(root instanceof HTMLElement)) throw new Error("mountTownSquareMapEmbed requires a root element");
  root.classList.add("map-canvas--embedded");

  let detailNameEl = null;
  let detailOriginEl = null;
  let detailVisitorsEl = null;
  let detailVisitEl = null;
  let detailCloseEl = null;

  if (detailPanel instanceof HTMLElement) {
    detailNameEl = detailPanel.querySelector("[data-detail-name]");
    detailOriginEl = detailPanel.querySelector("[data-detail-origin]");
    detailVisitorsEl = detailPanel.querySelector("[data-detail-visitors]");
    detailVisitEl = detailPanel.querySelector("[data-detail-visit]");
    detailCloseEl = detailPanel.querySelector("[data-detail-close]");
  }

  function renderDetail(site) {
    if (!(detailPanel instanceof HTMLElement)) return;
    if (!site) {
      detailPanel.hidden = true;
      return;
    }
    if (detailNameEl) detailNameEl.textContent = site.name;
    if (detailOriginEl) {
      let hostname = site.origin;
      try {
        hostname = new URL(site.origin).hostname;
      } catch {
        // Keep the raw origin string if it fails to parse.
      }
      detailOriginEl.textContent = hostname;
      detailOriginEl.href = site.origin;
    }
    if (detailVisitorsEl) {
      const visitors = Math.max(0, Number(site.activeVisitors) || 0);
      detailVisitorsEl.textContent = visitors > 0
        ? `${visitors} visitor${visitors === 1 ? "" : "s"} here right now`
        : "";
    }
    if (detailVisitEl) detailVisitEl.href = site.origin;
    detailPanel.hidden = false;
  }

  const map = createTownSquareMap({
    root,
    mode: "embedded",
    interactivePanZoom: false,
    wheelZoom: false,
    fetchBase,
    onStatus,
    onStats,
    onSelect: (site) => {
      renderDetail(site);
      onSelect?.(site);
    },
  });

  if (detailVisitEl instanceof HTMLElement) {
    detailVisitEl.addEventListener("click", () => map.reportVisit(map.getSelectedSite()?.siteKey));
  }
  detailCloseEl?.addEventListener("click", () => map.clearSelection());
  detailPanel?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    map.clearSelection();
    root.focus({ preventScroll: true });
  });

  return {
    ...map,
    visitRandomTown: async () => {
      const town = await fetchRandomTown("", fetchBase);
      if (!town) return null;
      map.reportVisit(town.siteKey);
      return town;
    },
  };
}
