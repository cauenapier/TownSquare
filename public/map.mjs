import { parseMapWorld, renderSceneryLayer } from "./map-scenery.mjs";

const DEFAULT_WORLD_WIDTH = 1800;
const DEFAULT_WORLD_HEIGHT = 1200;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 1.22;
const SVG_NS = "http://www.w3.org/2000/svg";

const root = document.getElementById("townsquare-map");
const statusEl = document.getElementById("map-status");
const detail = document.getElementById("map-detail");

if (!(root instanceof HTMLElement) || !(statusEl instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
  throw new Error("Map page elements not found");
}

const detailTitle = detail.querySelector("h2");
const detailOrigin = detail.querySelector(".map-detail__origin");
const detailVisit = detail.querySelector(".map-detail__visit");
const detailVerified = detail.querySelector("[data-map-verified]");
const detailSeen = detail.querySelector("[data-map-seen]");
const detailClose = detail.querySelector(".map-detail__close");
const detailConnections = detail.querySelector("[data-map-connections]");
const detailConnectionList = detail.querySelector(".map-detail__connection-list");

if (
  !(detailTitle instanceof HTMLElement)
  || !(detailOrigin instanceof HTMLAnchorElement)
  || !(detailVisit instanceof HTMLAnchorElement)
  || !(detailVerified instanceof HTMLElement)
  || !(detailSeen instanceof HTMLElement)
  || !(detailClose instanceof HTMLButtonElement)
  || !(detailConnections instanceof HTMLElement)
  || !(detailConnectionList instanceof HTMLUListElement)
) {
  throw new Error("Map detail elements not found");
}

let worldWidth = DEFAULT_WORLD_WIDTH;
let worldHeight = DEFAULT_WORLD_HEIGHT;
let mapWorld = parseMapWorld(null);
let sites = [];
let siteByKey = new Map();
let siteKeyByOrigin = new Map();
let positionsBySiteKey = new Map();
let mapEdges = [];
let selectedSiteKey = "";
let svg = null;
let isDragging = false;
let lastPointer = null;
let view = {
  x: 0,
  y: 0,
  zoom: 1,
};

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  return el;
}

function textElement(text, x, y, className) {
  const el = createSvgElement("text", { x, y, class: className });
  el.textContent = text;
  return el;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sitePosition(site) {
  const hash = hashString(site.siteKey);
  const angle = (hash % 6283) / 1000;
  const band = 0.26 + ((hash >>> 8) % 44) / 100;
  const drift = ((hash >>> 20) % 1000) / 1000;
  const x = 240 + ((hash % 1320) + drift * 120) % 1320;
  const y = 190 + Math.abs(Math.sin(angle)) * 620 + band * 160;
  return {
    x: Math.max(150, Math.min(worldWidth - 150, x)),
    y: Math.max(140, Math.min(worldHeight - 140, y)),
  };
}

function formatTime(value) {
  if (!value) return "Not seen yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function originLabel(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function indexSites(nextSites) {
  sites = nextSites;
  siteByKey = new Map();
  siteKeyByOrigin = new Map();
  positionsBySiteKey = new Map();
  mapEdges = [];

  for (const site of sites) {
    siteByKey.set(site.siteKey, site);
    const origin = normalizeOrigin(site.origin);
    if (origin && !siteKeyByOrigin.has(origin)) siteKeyByOrigin.set(origin, site.siteKey);
    positionsBySiteKey.set(site.siteKey, sitePosition(site));
  }

  const seen = new Set();
  for (const site of sites) {
    const fromKey = site.siteKey;
    for (const connection of site.connections || []) {
      const targetOrigin = normalizeOrigin(connection.url);
      if (!targetOrigin) continue;

      const toKey = siteKeyByOrigin.get(targetOrigin);
      if (!toKey || toKey === fromKey) continue;

      const edgeKey = [fromKey, toKey].sort().join("|");
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      mapEdges.push({ fromKey, toKey, label: connection.label });
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
  return createSvgElement("path", {
    class: `map-link${active ? " is-active" : ""}`,
    d: edgePath(from, to),
    "data-from-key": edge.fromKey,
    "data-to-key": edge.toKey,
  });
}

function siteConnections(siteKey) {
  const site = siteByKey.get(siteKey);
  if (!site) return [];

  const items = [];
  const seen = new Set();

  for (const connection of site.connections || []) {
    const targetOrigin = normalizeOrigin(connection.url);
    const targetKey = targetOrigin ? siteKeyByOrigin.get(targetOrigin) : null;
    const key = targetKey || connection.url;
    if (seen.has(key)) continue;
    seen.add(key);

    const targetSite = targetKey ? siteByKey.get(targetKey) : null;
    items.push({
      label: connection.label || (targetSite?.name ?? originLabel(connection.url)),
      url: connection.url,
      siteKey: targetKey,
      onMap: Boolean(targetSite),
      side: connection.side,
    });
  }

  for (const other of sites) {
    if (other.siteKey === siteKey) continue;
    for (const connection of other.connections || []) {
      const targetOrigin = normalizeOrigin(connection.url);
      if (targetOrigin !== normalizeOrigin(site.origin)) continue;

      const key = `in:${other.siteKey}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        label: other.name,
        url: other.origin,
        siteKey: other.siteKey,
        onMap: true,
        inbound: true,
      });
    }
  }

  return items;
}

function renderDetailConnections(siteKey) {
  const connections = siteConnections(siteKey);
  detailConnectionList.replaceChildren();

  if (connections.length === 0) {
    detailConnections.hidden = true;
    return;
  }

  detailConnections.hidden = false;
  for (const connection of connections) {
    const item = document.createElement("li");

    if (connection.onMap && connection.siteKey) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-detail__connection";
      button.textContent = connection.inbound
        ? `${connection.label} (links here)`
        : connection.label;
      button.addEventListener("click", () => selectSite(connection.siteKey));
      item.appendChild(button);
    } else {
      const link = document.createElement("a");
      link.className = "map-detail__connection map-detail__connection--external";
      link.href = connection.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = connection.label;
      item.appendChild(link);
    }

    detailConnectionList.appendChild(item);
  }
}

function buildMap() {
  svg = createSvgElement("svg", {
    class: "map-svg",
    role: "img",
    "aria-label": "TownSquare network map",
  });
  const viewport = createSvgElement("g");
  viewport.appendChild(renderSceneryLayer(mapWorld, createSvgElement));

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
  const { x, y } = positionsBySiteKey.get(site.siteKey) || sitePosition(site);
  const group = createSvgElement("g", {
    class: `map-node${site.siteKey === selectedSiteKey ? " is-selected" : ""}`,
    transform: `translate(${x} ${y})`,
    tabindex: "0",
    role: "button",
    "data-site-key": site.siteKey,
    "aria-label": `${site.name}, ${originLabel(site.origin)}`,
  });

  group.append(
    createSvgElement("circle", { class: "map-node__halo", r: 26 }),
    createSvgElement("circle", { class: "map-node__dot", r: 10 }),
    textElement(site.name, 0, 42, "map-node__label"),
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

function selectSite(siteKey) {
  selectedSiteKey = siteKey;
  const site = selectedSite();
  if (!site) return;

  renderSelectedState();
  detail.hidden = false;
  detailTitle.textContent = site.name;
  detailOrigin.textContent = originLabel(site.origin);
  detailOrigin.href = site.origin;
  detailVisit.href = site.origin;
  detailVerified.textContent = formatTime(site.verifiedAt);
  detailSeen.textContent = formatTime(site.lastSeenAt);
  renderDetailConnections(siteKey);
}

function closeDetail() {
  selectedSiteKey = "";
  renderSelectedState();
  detail.hidden = true;
  detailConnections.hidden = true;
  detailConnectionList.replaceChildren();
}

function applyView() {
  if (!svg) return;
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${worldWidth / view.zoom} ${worldHeight / view.zoom}`);
}

function clampView() {
  const visibleWidth = worldWidth / view.zoom;
  const visibleHeight = worldHeight / view.zoom;
  view.x = Math.max(0, Math.min(worldWidth - visibleWidth, view.x));
  view.y = Math.max(0, Math.min(worldHeight - visibleHeight, view.y));
}

function zoomAt(multiplier, clientX = root.clientWidth / 2, clientY = root.clientHeight / 2) {
  const bounds = root.getBoundingClientRect();
  const beforeWidth = worldWidth / view.zoom;
  const beforeHeight = worldHeight / view.zoom;
  const beforeX = view.x + ((clientX - bounds.left) / bounds.width) * beforeWidth;
  const beforeY = view.y + ((clientY - bounds.top) / bounds.height) * beforeHeight;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * multiplier));
  const afterWidth = worldWidth / nextZoom;
  const afterHeight = worldHeight / nextZoom;

  view.x = beforeX - ((clientX - bounds.left) / bounds.width) * afterWidth;
  view.y = beforeY - ((clientY - bounds.top) / bounds.height) * afterHeight;
  view.zoom = nextZoom;
  clampView();
  applyView();
}

const CONTENT_PADDING = 120;
const VIEW_MARGIN = 1.65;

function siteContentBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { x, y } of positionsBySiteKey.values()) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX)) {
    return {
      minX: CONTENT_PADDING,
      minY: CONTENT_PADDING,
      maxX: worldWidth - CONTENT_PADDING,
      maxY: worldHeight - CONTENT_PADDING,
    };
  }

  return {
    minX: Math.max(0, minX - CONTENT_PADDING),
    minY: Math.max(0, minY - CONTENT_PADDING),
    maxX: Math.min(worldWidth, maxX + CONTENT_PADDING),
    maxY: Math.min(worldHeight, maxY + CONTENT_PADDING),
  };
}

function resetView() {
  const bounds = siteContentBounds();
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      MAX_ZOOM,
      Math.min(worldWidth / (contentWidth * VIEW_MARGIN), worldHeight / (contentHeight * VIEW_MARGIN)),
    ),
  );
  const visibleWidth = worldWidth / zoom;
  const visibleHeight = worldHeight / zoom;

  view = {
    x: centerX - visibleWidth / 2,
    y: centerY - visibleHeight / 2,
    zoom,
  };
  clampView();
  applyView();
}

function wireControls() {
  root.addEventListener("pointerdown", (event) => {
    isDragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    root.setPointerCapture(event.pointerId);
    root.classList.add("is-panning");
  });

  root.addEventListener("pointermove", (event) => {
    if (!isDragging || !lastPointer) return;
    const bounds = root.getBoundingClientRect();
    view.x -= ((event.clientX - lastPointer.x) / bounds.width) * (worldWidth / view.zoom);
    view.y -= ((event.clientY - lastPointer.y) / bounds.height) * (worldHeight / view.zoom);
    lastPointer = { x: event.clientX, y: event.clientY };
    clampView();
    applyView();
  });

  root.addEventListener("pointerup", () => {
    isDragging = false;
    lastPointer = null;
    root.classList.remove("is-panning");
  });

  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX, event.clientY);
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
}

function applyMapWorld(raw) {
  mapWorld = parseMapWorld(raw);
  worldWidth = mapWorld.width;
  worldHeight = mapWorld.height;
}

async function loadMap() {
  const [worldResult, mapResult] = await Promise.allSettled([
    fetch("/map-world.json").then((response) => {
      if (!response.ok) throw new Error("Map world request failed");
      return response.json();
    }),
    fetch("/api/map").then(async (response) => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.sites)) {
        throw new Error(body.error || "Map request failed");
      }
      return body.sites;
    }),
  ]);

  if (worldResult.status === "fulfilled") {
    applyMapWorld(worldResult.value);
  } else {
    applyMapWorld(null);
  }

  if (mapResult.status === "fulfilled") {
    sites = mapResult.value;
    indexSites(sites);
  } else {
    sites = [];
    indexSites(sites);
    statusEl.textContent = "Could not load the TownSquare map.";
  }

  buildMap();
  resetView();
}

wireControls();
loadMap();
