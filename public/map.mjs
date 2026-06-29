import { createSvgElement } from "./lib/ui-common.mjs";
import { buildMapEdges } from "./map-connections.mjs";
import { activityLevel, cityTier, layoutMapSites } from "./map-layout.mjs";
import { createCityMarker, renderMapEdge, supporterStarSize } from "./map-render.mjs";
import { renderSceneryLayer } from "./map-scenery.mjs";
import { MAP_WORLD_MIN_HEIGHT, MAP_WORLD_MIN_WIDTH, validateMapWorld } from "./shared/map-world.mjs";

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 1.22;
const WHEEL_ZOOM_SCALE = 0.0014;
const MAX_WHEEL_ZOOM_STEP = 0.07;
const ACTIVITY_REFRESH_MS = 10_000;
const ACTIVITY_DOT_POSITIONS = [
  [0, 0],
  [-0.32, -0.2],
  [0.32, 0.22],
  [-0.2, 0.36],
  [0.22, -0.38],
];

const root = document.getElementById("townsquare-map");
const statusEl = document.getElementById("map-status");
const detail = document.getElementById("map-detail");

if (!(root instanceof HTMLElement) || !(statusEl instanceof HTMLElement) || !(detail instanceof HTMLDialogElement)) {
  throw new Error("Map page elements not found");
}

const detailTitle = detail.querySelector("h2");
const detailOrigin = detail.querySelector(".map-detail__origin");
const detailVisit = detail.querySelector(".map-detail__visit");
const detailClose = detail.querySelector(".map-detail__close");

if (
  !(detailTitle instanceof HTMLElement)
  || !(detailOrigin instanceof HTMLAnchorElement)
  || !(detailVisit instanceof HTMLAnchorElement)
  || !(detailClose instanceof HTMLButtonElement)
) {
  throw new Error("Map detail elements not found");
}

let worldWidth = MAP_WORLD_MIN_WIDTH;
let worldHeight = MAP_WORLD_MIN_HEIGHT;
let mapWorld = { width: MAP_WORLD_MIN_WIDTH, height: MAP_WORLD_MIN_HEIGHT, props: [], water: [] };
let sites = [];
let siteByKey = new Map();
let positionsBySiteKey = new Map();
let mapEdges = [];
let selectedSiteKey = "";
let svg = null;
let structureSnapshot = "";
const PAN_THRESHOLD_PX = 4;

let isDragging = false;
let panPointerId = null;
let panStart = null;
let lastPointer = null;
let view = {
  x: 0,
  y: 0,
  zoom: 1,
};

function structuralSnapshot(nextSites, nextWorld) {
  return JSON.stringify({
    sites: nextSites.map(({ activeVisitors: _activeVisitors, ...site }) => site),
    world: nextWorld,
  });
}

/**
 * Tell the server a visitor followed a town's website link from the map, so the
 * operator can see which towns the map sends traffic to. Fire-and-forget via
 * sendBeacon so it survives the new-tab navigation; failures are ignored.
 */
function reportMapClick(siteKey) {
  if (!siteKey || typeof navigator?.sendBeacon !== "function") return;
  try {
    // text/plain keeps this a CORS-simple request; the server parses it as JSON.
    const payload = new Blob([JSON.stringify({ siteKey })], { type: "text/plain" });
    navigator.sendBeacon("/api/map-click", payload);
  } catch {
    // Tracking is best-effort and must never block the visit.
  }
}

function originLabel(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function siteAriaLabel(site) {
  const visitors = Math.max(0, Number(site.activeVisitors) || 0);
  const supporter = site.supporter ? ", supporter" : "";
  return `${site.name}, ${cityTier(site.messageCount).name}${supporter}, ${visitors} active visitor${visitors === 1 ? "" : "s"}, ${originLabel(site.origin)}`;
}

function renderActivity(site, tier) {
  const level = activityLevel(site.activeVisitors);
  const group = createSvgElement("g", { class: "map-node__activity", "aria-hidden": "true" });
  const radius = Math.max(2.5, tier.radius * 0.09);

  for (let index = 0; index < level; index += 1) {
    const [x, y] = ACTIVITY_DOT_POSITIONS[index];
    group.appendChild(createSvgElement("circle", {
      class: "map-node__activity-dot",
      cx: x * tier.radius,
      cy: y * tier.radius,
      r: radius,
      style: `animation-delay: -${index * 0.37}s`,
    }));
  }

  return group;
}

function indexSites(nextSites) {
  sites = nextSites;
  siteByKey = new Map(nextSites.map((site) => [site.siteKey, site]));
  positionsBySiteKey = layoutMapSites(nextSites, worldWidth, worldHeight);
  mapEdges = buildMapEdges(nextSites);
}

function buildMap() {
  svg = createSvgElement("svg", {
    class: "map-svg",
    role: "group",
    "aria-label": "TownSquare network map",
  });
  const viewport = createSvgElement("g");
  viewport.appendChild(renderSceneryLayer(mapWorld));

  const edgeLayer = createSvgElement("g", { class: "map-edges", "aria-hidden": "true" });
  const nodeLayer = createSvgElement("g", { class: "map-nodes" });
  viewport.append(edgeLayer, nodeLayer);
  svg.appendChild(viewport);
  root.replaceChildren(svg);

  if (sites.length === 0) {
    statusEl.textContent = "No verified TownSquares are public yet.";
    applyView();
    return;
  }

  statusEl.textContent = `${sites.length} verified TownSquare${sites.length === 1 ? "" : "s"} on the map.`;

  for (const edge of mapEdges) {
    const path = renderMapEdge(edge, positionsBySiteKey, selectedSiteKey);
    if (path) edgeLayer.appendChild(path);
  }

  for (const site of sites) {
    nodeLayer.appendChild(renderSiteNode(site));
  }

  applyView();
}

function renderSiteNode(site) {
  const { x, y } = positionsBySiteKey.get(site.siteKey) || { x: worldWidth / 2, y: worldHeight / 2 };
  const marker = createCityMarker(site);
  const group = createSvgElement("g", {
    class: `map-node${site.siteKey === selectedSiteKey ? " is-selected" : ""}`,
    transform: `translate(${x} ${y})`,
    tabindex: "0",
    role: "button",
    "data-site-key": site.siteKey,
    "aria-label": siteAriaLabel(site),
  });

  group.append(
    marker.dot,
    renderActivity(site, marker.tier),
    ...(marker.star ? [marker.star] : []),
    marker.label,
  );

  group.addEventListener("click", (event) => {
    event.stopPropagation();
    selectSite(site.siteKey);
  });
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectSite(site.siteKey);
  });

  return group;
}

async function refreshActivity() {
  if (document.hidden) return;

  try {
    const response = await fetch("/api/map");
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.sites)) return;

    const nextWorld = normalizedMapWorld(body.world);
    const nextStructureSnapshot = structuralSnapshot(body.sites, nextWorld);
    if (nextStructureSnapshot !== structureSnapshot) {
      mapWorld = nextWorld;
      worldWidth = mapWorld.width;
      worldHeight = mapWorld.height;
      indexSites(body.sites);

      if (selectedSiteKey && !siteByKey.has(selectedSiteKey)) {
        closeDetail();
      } else if (selectedSiteKey) {
        updateDetail(selectedSite());
      }

      structureSnapshot = nextStructureSnapshot;
      buildMap();
      clampView();
      applyView();
      return;
    }

    for (const nextSite of body.sites) {
      const site = siteByKey.get(nextSite.siteKey);
      const node = root.querySelector(`[data-site-key="${CSS.escape(nextSite.siteKey)}"]`);
      if (!site || !(node instanceof SVGGElement)) continue;

      site.activeVisitors = nextSite.activeVisitors;
      node.setAttribute("aria-label", siteAriaLabel(site));
      node.querySelector(".map-node__activity")?.replaceWith(renderActivity(site, cityTier(site.messageCount)));
    }
  } catch {
    // Keep the last known activity state when a refresh fails.
  }
}

function renderSelectedState() {
  root.querySelectorAll(".map-node").forEach((node) => {
    node.classList.toggle("is-selected", node.getAttribute("data-site-key") === selectedSiteKey);
  });

  root.querySelectorAll(".map-link").forEach((edge) => {
    const fromKey = edge.getAttribute("data-from-key");
    const toKey = edge.getAttribute("data-to-key");
    const active = selectedSiteKey && (fromKey === selectedSiteKey || toKey === selectedSiteKey);
    edge.classList.toggle("is-active", Boolean(active));
  });
}

function selectedSite() {
  return siteByKey.get(selectedSiteKey) || null;
}

function updateDetail(site) {
  if (!site) return;
  detailTitle.textContent = site.name;
  detailOrigin.textContent = site.origin;
  detailOrigin.href = site.origin;
  detailVisit.href = site.origin;
}

function selectSite(siteKey) {
  selectedSiteKey = siteKey;
  const site = selectedSite();
  if (!site) return;

  renderSelectedState();
  updateDetail(site);
  if (!detail.open) detail.showModal();
}

function clearSelection() {
  selectedSiteKey = "";
  renderSelectedState();
}

function closeDetail() {
  if (detail.open) {
    detail.close();
    return;
  }
  clearSelection();
}

function containerAspect() {
  const width = root.clientWidth || 1;
  const height = root.clientHeight || 1;
  return width / height;
}

function visibleSizeAtZoom(zoom) {
  const aspect = containerAspect();
  let width = worldWidth / zoom;
  let height = worldHeight / zoom;
  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }
  return {
    width: Math.min(width, worldWidth),
    height: Math.min(height, worldHeight),
  };
}

function visibleSize() {
  return visibleSizeAtZoom(view.zoom);
}

function applyView() {
  if (!svg) return;
  const { width, height } = visibleSize();
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${width} ${height}`);
}

function clampView() {
  const { width: visibleWidth, height: visibleHeight } = visibleSize();
  view.x = Math.max(0, Math.min(Math.max(0, worldWidth - visibleWidth), view.x));
  view.y = Math.max(0, Math.min(Math.max(0, worldHeight - visibleHeight), view.y));
}

function zoomToFitBox(targetWidth, targetHeight) {
  let low = MIN_ZOOM;
  let high = MAX_ZOOM;
  for (let step = 0; step < 48; step += 1) {
    const mid = (low + high) / 2;
    const { width, height } = visibleSizeAtZoom(mid);
    if (width >= targetWidth && height >= targetHeight) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

function wheelZoomMultiplier(deltaY, deltaMode) {
  let pixels = deltaY;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) pixels *= 16;
  else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) pixels *= root.clientHeight;

  const raw = Math.pow(ZOOM_STEP, -pixels * WHEEL_ZOOM_SCALE);
  return Math.max(1 - MAX_WHEEL_ZOOM_STEP, Math.min(1 + MAX_WHEEL_ZOOM_STEP, raw));
}

function zoomAt(multiplier, clientX = root.clientWidth / 2, clientY = root.clientHeight / 2) {
  const bounds = root.getBoundingClientRect();
  const before = visibleSize();
  const beforeX = view.x + ((clientX - bounds.left) / bounds.width) * before.width;
  const beforeY = view.y + ((clientY - bounds.top) / bounds.height) * before.height;
  view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * multiplier));
  const after = visibleSize();

  view.x = beforeX - ((clientX - bounds.left) / bounds.width) * after.width;
  view.y = beforeY - ((clientY - bounds.top) / bounds.height) * after.height;
  clampView();
  applyView();
}

// World units of empty space between the outermost cities and the viewport edge on reset.
const RESET_MARGIN = 5;

function siteFootprint(site) {
  const tier = cityTier(site.messageCount);
  const halfW = Math.max(tier.radius, Math.max(76, site.name.length * 8.2) * 0.52);
  const starSize = site.supporter ? supporterStarSize(tier) : 0;
  return {
    above: tier.radius + 8 + starSize * 0.85,
    below: tier.radius + 28,
    halfW,
  };
}

function siteContentBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const site of sites) {
    const position = positionsBySiteKey.get(site.siteKey);
    if (!position) continue;
    const { above, below, halfW } = siteFootprint(site);
    minX = Math.min(minX, position.x - halfW);
    minY = Math.min(minY, position.y - above);
    maxX = Math.max(maxX, position.x + halfW);
    maxY = Math.max(maxY, position.y + below);
  }

  if (!Number.isFinite(minX)) {
    const inset = RESET_MARGIN * 2;
    return {
      minX: inset,
      minY: inset,
      maxX: worldWidth - inset,
      maxY: worldHeight - inset,
    };
  }

  return { minX, minY, maxX, maxY };
}

function resetView() {
  const bounds = siteContentBounds();
  const margin = RESET_MARGIN;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let targetWidth = Math.max(1, (bounds.maxX - bounds.minX) + margin * 2);
  let targetHeight = Math.max(1, (bounds.maxY - bounds.minY) + margin * 2);
  const aspect = containerAspect();

  if (targetWidth / targetHeight > aspect) {
    targetHeight = targetWidth / aspect;
  } else {
    targetWidth = targetHeight * aspect;
  }

  let zoom = zoomToFitBox(targetWidth, targetHeight);
  let { width: fittedWidth, height: fittedHeight } = visibleSizeAtZoom(zoom);
  // Sub-1 zoom levels that still show the entire world share one viewBox, so pan and
  // the first few zoom-in clicks appear to do nothing until zoom passes 1.
  if (fittedWidth >= worldWidth && fittedHeight >= worldHeight) {
    zoom = 1;
    ({ width: fittedWidth, height: fittedHeight } = visibleSizeAtZoom(zoom));
  }
  view = {
    x: centerX - fittedWidth / 2,
    y: centerY - fittedHeight / 2,
    zoom,
  };
  clampView();
  applyView();
}

function fitInitialView() {
  if (root.clientWidth <= 0 || root.clientHeight <= 0) return false;
  resetView();
  return true;
}

function scheduleInitialViewFit() {
  requestAnimationFrame(() => {
    if (fitInitialView()) return;

    const observer = new ResizeObserver(() => {
      if (fitInitialView()) observer.disconnect();
    });
    observer.observe(root);
  });
}

function isPanTarget(target) {
  if (!(target instanceof Element)) return false;
  return !target.closest(".map-node, .map-toolbar, .map-detail");
}

function endPan() {
  isDragging = false;
  panPointerId = null;
  panStart = null;
  lastPointer = null;
  root.classList.remove("is-panning");
}

function wireControls() {
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !isPanTarget(event.target)) return;

    panPointerId = event.pointerId;
    panStart = { x: event.clientX, y: event.clientY };
    lastPointer = { x: event.clientX, y: event.clientY };
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener("pointermove", (event) => {
    if (panPointerId !== event.pointerId || !lastPointer || !panStart) return;

    if (!isDragging) {
      const dx = event.clientX - panStart.x;
      const dy = event.clientY - panStart.y;
      if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
      isDragging = true;
      root.classList.add("is-panning");
    }

    const bounds = root.getBoundingClientRect();
    const { width: visibleWidth, height: visibleHeight } = visibleSize();
    view.x -= ((event.clientX - lastPointer.x) / bounds.width) * visibleWidth;
    view.y -= ((event.clientY - lastPointer.y) / bounds.height) * visibleHeight;
    lastPointer = { x: event.clientX, y: event.clientY };
    clampView();
    applyView();
  });

  root.addEventListener("pointerup", (event) => {
    if (panPointerId !== event.pointerId) return;
    endPan();
  });

  root.addEventListener("pointercancel", (event) => {
    if (panPointerId !== event.pointerId) return;
    endPan();
  });

  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    const multiplier = wheelZoomMultiplier(event.deltaY, event.deltaMode);
    if (Math.abs(multiplier - 1) < 0.0005) return;
    zoomAt(multiplier, event.clientX, event.clientY);
  }, { passive: false });

  root.addEventListener("click", (event) => {
    if (event.target === svg) closeDetail();
  });

  window.addEventListener("resize", () => {
    clampView();
    applyView();
  });

  document.querySelector("[data-map-zoom='in']")?.addEventListener("click", () => zoomAt(ZOOM_STEP));
  document.querySelector("[data-map-zoom='out']")?.addEventListener("click", () => zoomAt(1 / ZOOM_STEP));
  document.querySelector("[data-map-reset]")?.addEventListener("click", resetView);
  detailClose?.addEventListener("click", closeDetail);
  detail.addEventListener("close", clearSelection);

  for (const link of [detailOrigin, detailVisit]) {
    link.addEventListener("click", () => reportMapClick(selectedSiteKey));
  }
}

function normalizedMapWorld(raw) {
  const result = validateMapWorld(raw);
  return result.ok
    ? result.world
    : { width: MAP_WORLD_MIN_WIDTH, height: MAP_WORLD_MIN_HEIGHT, props: [], water: [] };
}

function applyMapWorld(raw) {
  mapWorld = normalizedMapWorld(raw);
  worldWidth = mapWorld.width;
  worldHeight = mapWorld.height;
}

async function loadMap() {
  try {
    const response = await fetch("/api/map");
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.sites)) throw new Error(body.error || "Map request failed");
    applyMapWorld(body.world);
    indexSites(body.sites);
    structureSnapshot = structuralSnapshot(sites, mapWorld);
  } catch {
    applyMapWorld(null);
    sites = [];
    indexSites(sites);
    structureSnapshot = structuralSnapshot(sites, mapWorld);
    statusEl.textContent = "Could not load the TownSquare map.";
  }

  buildMap();
  scheduleInitialViewFit();
}

wireControls();
loadMap();
window.setInterval(refreshActivity, ACTIVITY_REFRESH_MS);
