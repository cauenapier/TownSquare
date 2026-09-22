import { createTownSquareMap, fetchRandomTown } from "./map-engine.mjs";

// Fires an existing Plausible custom event when the site has one loaded
// (server.js injects the snippet into every page when PLAUSIBLE_DOMAIN is
// set); a no-op otherwise, so this never introduces a second analytics
// provider or blocks navigation if tracking is unavailable.
function track(name) {
  try {
    window.plausible?.(name);
  } catch {
    // Analytics must never block navigation or interaction.
  }
}

const root = document.getElementById("townsquare-map");
const statusEl = document.getElementById("map-status");
const detail = document.getElementById("map-detail");
const statsEl = document.getElementById("map-network-stats");
const randomTownButton = document.querySelector("[data-map-random-town]");
const registerLink = document.querySelector("[data-map-register]");

if (!(root instanceof HTMLElement) || !(statusEl instanceof HTMLElement) || !(detail instanceof HTMLDialogElement)) {
  throw new Error("Map page elements not found");
}

const detailTitle = detail.querySelector("h2");
const detailOrigin = detail.querySelector(".map-detail__origin");
const detailInactivity = detail.querySelector(".map-detail__inactivity");
const detailVisitors = detail.querySelector(".map-detail__visitors");
const detailVisit = detail.querySelector(".map-detail__visit");
const detailClose = detail.querySelector(".map-detail__close");

if (
  !(detailTitle instanceof HTMLElement)
  || !(detailOrigin instanceof HTMLAnchorElement)
  || !(detailInactivity instanceof HTMLElement)
  || !(detailVisit instanceof HTMLAnchorElement)
  || !(detailClose instanceof HTMLButtonElement)
) {
  throw new Error("Map detail elements not found");
}

function updateDetail(site) {
  if (!site) return;
  detailTitle.textContent = site.name;
  detailOrigin.textContent = site.origin;
  detailOrigin.href = site.origin;
  detailInactivity.hidden = !site.inactiveFor30Days;
  detailInactivity.textContent = site.inactiveFor30Days
    ? `Inactive for ${site.inactiveDays} days · fading from the map`
    : "";
  if (detailVisitors) {
    const visitors = Math.max(0, Number(site.activeVisitors) || 0);
    detailVisitors.textContent = visitors > 0
      ? `${visitors} visitor${visitors === 1 ? "" : "s"} here right now`
      : "";
  }
  detailVisit.href = site.origin;
}

const map = createTownSquareMap({
  root,
  mode: "full",
  zoomInButton: document.querySelector("[data-map-zoom='in']"),
  zoomOutButton: document.querySelector("[data-map-zoom='out']"),
  resetButton: document.querySelector("[data-map-reset]"),
  onStatus: (text) => {
    statusEl.textContent = text;
  },
  onStats: (stats) => {
    if (!statsEl) return;
    statsEl.textContent = `${stats.towns} public town${stats.towns === 1 ? "" : "s"} · `
      + `${stats.activeLast30d} active in the last 30 days · `
      + `${stats.visitorsNow} visiting right now`;
  },
  onSelect: (site) => {
    if (site) {
      updateDetail(site);
      if (!detail.open) detail.showModal();
    } else if (detail.open) {
      detail.close();
    }
  },
});

detailClose.addEventListener("click", () => detail.close());
detail.addEventListener("close", () => map.clearSelection());

for (const link of [detailOrigin, detailVisit]) {
  link.addEventListener("click", () => map.reportVisit(map.getSelectedSite()?.siteKey));
}

if (randomTownButton instanceof HTMLElement) {
  randomTownButton.addEventListener("click", async () => {
    randomTownButton.setAttribute("aria-busy", "true");
    try {
      const town = await fetchRandomTown();
      if (!town) return;
      map.reportVisit(town.siteKey);
      track("Map: Random Town");
      window.open(town.url, "_blank", "noopener,noreferrer");
    } finally {
      randomTownButton.removeAttribute("aria-busy");
    }
  });
}

registerLink?.addEventListener("click", () => track("Map: Register CTA"));
