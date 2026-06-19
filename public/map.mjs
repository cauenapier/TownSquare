import { createSvgElement } from "./lib/ui-common.mjs";
import { activityLevel, cityTier, layoutMapSites } from "./map-layout.mjs";
import { renderSceneryLayer } from "./map-scenery.mjs";
import { MAP_WORLD_HEIGHT, MAP_WORLD_WIDTH, validateMapWorld } from "./shared/map-world.mjs";
import { normalizeAbsoluteOrigin } from "./shared/url.mjs";

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

let worldWidth = MAP_WORLD_WIDTH;
let worldHeight = MAP_WORLD_HEIGHT;
let mapWorld = { width: MAP_WORLD_WIDTH, height: MAP_WORLD_HEIGHT, props: [], water: [] };
let sites = [];
let siteByKey = new Map();
let siteKeyByOrigin = new Map();
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

function textElement(text, x, y, className) {
  const el = createSvgElement("text", { x, y, class: className });
  el.textContent = text;
  return el;
}

function structuralSnapshot(nextSites, nextWorld) {
  return JSON.stringify({
    sites: nextSites.map(({ activeVisitors: _activeVisitors, ...site }) => site),
    world: nextWorld,
  });
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
  return `${site.name}, ${cityTier(site.messageCount).name}, ${visitors} active visitor${visitors === 1 ? "" : "s"}, ${originLabel(site.origin)}`;
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

function siteLinksTo(fromKey, toKey) {
  const fromSite = siteByKey.get(fromKey);
  const toSite = siteByKey.get(toKey);
  if (!fromSite || !toSite) return false;

  const targetOrigin = normalizeAbsoluteOrigin(toSite.origin);
  if (!targetOrigin) return false;

  return (fromSite.connections || []).some(
    (connection) => normalizeAbsoluteOrigin(connection.url) === targetOrigin,
  );
}

function indexSites(nextSites) {
  sites = nextSites;
  siteByKey = new Map();
  siteKeyByOrigin = new Map();
  positionsBySiteKey = layoutMapSites(nextSites, worldWidth, worldHeight);
  mapEdges = [];

  for (const site of sites) {
    siteByKey.set(site.siteKey, site);
    const origin = normalizeAbsoluteOrigin(site.origin);
    if (origin && !siteKeyByOrigin.has(origin)) siteKeyByOrigin.set(origin, site.siteKey);
  }

  const seen = new Set();
  for (const site of sites) {
    const fromKey = site.siteKey;
    for (const connection of site.connections || []) {
      const targetOrigin = normalizeAbsoluteOrigin(connection.url);
      if (!targetOrigin) continue;

      const toKey = siteKeyByOrigin.get(targetOrigin);
      if (!toKey || toKey === fromKey) continue;

      const edgeKey = [fromKey, toKey].sort().join("|");
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      mapEdges.push({
        fromKey,
        toKey,
        label: connection.label,
        bidirectional: siteLinksTo(fromKey, toKey) && siteLinksTo(toKey, fromKey),
      });
    }
  }
}

function edgeEndpoints(from, to, inset = 28) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    from: { x: from.x + ux * inset, y: from.y + uy * inset },
    to: { x: to.x - ux * inset, y: to.y - uy * inset },
  };
}

function edgePath(from, to) {
  const endpoints = edgeEndpoints(from, to);
  const dx = endpoints.to.x - endpoints.from.x;
  const dy = endpoints.to.y - endpoints.from.y;
  const mx = (endpoints.from.x + endpoints.to.x) / 2;
  const my = (endpoints.from.y + endpoints.to.y) / 2;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(140, len * 0.22);
  const cx = mx - (dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M ${endpoints.from.x} ${endpoints.from.y} Q ${cx} ${cy} ${endpoints.to.x} ${endpoints.to.y}`;
}

function renderMapEdge(edge) {
  const from = positionsBySiteKey.get(edge.fromKey);
  const to = positionsBySiteKey.get(edge.toKey);
  if (!from || !to) return null;

  const active = selectedSiteKey && (edge.fromKey === selectedSiteKey || edge.toKey === selectedSiteKey);
  const roadKind = edge.bidirectional ? "asphalt" : "dirt";
  return createSvgElement("path", {
    class: `map-link map-link--${roadKind}${active ? " is-active" : ""}`,
    d: edgePath(from, to),
    "data-from-key": edge.fromKey,
    "data-to-key": edge.toKey,
  });
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
    return;
  }

  const edgeLabel = mapEdges.length === 1 ? "1 path" : `${mapEdges.length} paths`;
  statusEl.textContent = `${sites.length} verified TownSquare${sites.length === 1 ? "" : "s"} on the map${mapEdges.length ? `, ${edgeLabel} between them` : ""}.`;

  for (const edge of mapEdges) {
    const path = renderMapEdge(edge);
    if (path) edgeLayer.appendChild(path);
  }

  for (const site of sites) {
    nodeLayer.appendChild(renderSiteNode(site));
  }
}

function renderSiteNode(site) {
  const { x, y } = positionsBySiteKey.get(site.siteKey) || { x: worldWidth / 2, y: worldHeight / 2 };
  const tier = cityTier(site.messageCount);
  const group = createSvgElement("g", {
    class: `map-node${site.siteKey === selectedSiteKey ? " is-selected" : ""}`,
    transform: `translate(${x} ${y})`,
    tabindex: "0",
    role: "button",
    "data-site-key": site.siteKey,
    "aria-label": siteAriaLabel(site),
  });

  group.append(
    createSvgElement("circle", { class: "map-node__dot", r: tier.radius }),
    renderActivity(site, tier),
    textElement(site.name, 0, tier.radius + 10, "map-node__label"),
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
  return {
    above: tier.radius + 8,
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

  const zoom = zoomToFitBox(targetWidth, targetHeight);
  const { width: fittedWidth, height: fittedHeight } = visibleSizeAtZoom(zoom);
  view = {
    x: centerX - fittedWidth / 2,
    y: centerY - fittedHeight / 2,
    zoom,
  };
  clampView();
  applyView();
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
}

function normalizedMapWorld(raw) {
  const result = validateMapWorld(raw);
  return result.ok
    ? result.world
    : { width: MAP_WORLD_WIDTH, height: MAP_WORLD_HEIGHT, props: [], water: [] };
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
  requestAnimationFrame(() => {
    resetView();
  });
}

wireControls();
loadMap();
window.setInterval(refreshActivity, ACTIVITY_REFRESH_MS);
