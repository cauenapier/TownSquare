const WORLD_WIDTH = 1800;
const WORLD_HEIGHT = 1200;
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

if (
  !(detailTitle instanceof HTMLElement)
  || !(detailOrigin instanceof HTMLAnchorElement)
  || !(detailVisit instanceof HTMLAnchorElement)
  || !(detailVerified instanceof HTMLElement)
  || !(detailSeen instanceof HTMLElement)
  || !(detailClose instanceof HTMLButtonElement)
) {
  throw new Error("Map detail elements not found");
}

let sites = [];
let selectedSiteKey = "";
let svg = null;
let isDragging = false;
let lastPointer = null;
let view = {
  x: WORLD_WIDTH * 0.15,
  y: WORLD_HEIGHT * 0.2,
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
    x: Math.max(150, Math.min(WORLD_WIDTH - 150, x)),
    y: Math.max(140, Math.min(WORLD_HEIGHT - 140, y)),
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

function originLabel(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function terrainLayer() {
  const group = createSvgElement("g", { class: "map-terrain" });

  group.append(
    createSvgElement("path", {
      class: "map-land map-land--west",
      d: "M164 350 C244 184 450 124 650 178 C765 209 842 298 826 430 C811 554 682 619 581 698 C461 791 310 832 194 753 C84 679 94 496 164 350 Z",
    }),
    createSvgElement("path", {
      class: "map-land map-land--east",
      d: "M918 258 C1056 116 1313 119 1466 239 C1617 357 1647 582 1533 732 C1415 886 1158 923 1010 815 C867 710 791 389 918 258 Z",
    }),
    createSvgElement("path", {
      class: "map-land map-land--south",
      d: "M577 821 C700 730 943 735 1045 853 C1137 960 1031 1113 849 1121 C675 1129 457 910 577 821 Z",
    }),
    createSvgElement("path", {
      class: "map-river",
      d: "M218 286 C332 372 404 388 539 371 C681 353 722 444 654 527 C590 604 624 701 758 728 C905 758 985 678 1098 711 C1207 742 1266 844 1407 831",
    }),
    createSvgElement("path", {
      class: "map-path",
      d: "M299 685 C464 581 646 567 824 619 C973 663 1041 571 1174 502 C1290 442 1394 462 1515 526",
    }),
    createSvgElement("path", {
      class: "map-path",
      d: "M506 249 C604 352 742 412 914 422 C1064 430 1177 368 1306 279",
    }),
  );

  const mountains = [
    [1035, 316], [1102, 262], [1171, 333], [1248, 289], [1322, 348],
    [404, 269], [480, 230], [556, 289],
  ];
  for (const [x, y] of mountains) {
    group.appendChild(createSvgElement("path", {
      class: "map-mountain",
      d: `M${x - 44} ${y + 46} L${x} ${y - 42} L${x + 48} ${y + 46} M${x - 10} ${y - 20} L${x + 7} ${y + 3} L${x + 21} ${y - 16}`,
    }));
  }

  const trees = [
    [260, 520], [315, 566], [368, 520], [417, 602], [500, 548], [586, 632],
    [1204, 595], [1261, 638], [1327, 594], [1396, 664], [1452, 604],
    [738, 915], [804, 874], [879, 944], [940, 893],
  ];
  for (const [x, y] of trees) {
    group.appendChild(createSvgElement("path", {
      class: "map-tree",
      d: `M${x} ${y - 31} C${x - 24} ${y - 12} ${x - 18} ${y + 10} ${x} ${y + 8} C${x + 24} ${y + 10} ${x + 28} ${y - 14} ${x} ${y - 31} Z M${x} ${y + 8} L${x} ${y + 31}`,
    }));
  }

  return group;
}

function buildMap() {
  svg = createSvgElement("svg", {
    class: "map-svg",
    role: "img",
    "aria-label": "Hand-drawn TownSquare world map",
  });
  const viewport = createSvgElement("g");
  viewport.appendChild(terrainLayer());

  const edgeLayer = createSvgElement("g", { class: "map-edges", "aria-hidden": "true" });
  const nodeLayer = createSvgElement("g", { class: "map-nodes" });
  viewport.append(edgeLayer, nodeLayer);
  svg.appendChild(viewport);
  root.replaceChildren(svg);

  if (sites.length === 0) {
    statusEl.textContent = "No verified TownSquares are public yet.";
    return;
  }

  statusEl.textContent = `${sites.length} verified TownSquare${sites.length === 1 ? "" : "s"} on the map.`;
  for (const site of sites) {
    nodeLayer.appendChild(renderSiteNode(site));
  }
}

function renderSiteNode(site) {
  const { x, y } = sitePosition(site);
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
}

function selectedSite() {
  return sites.find((site) => site.siteKey === selectedSiteKey) || null;
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
}

function closeDetail() {
  selectedSiteKey = "";
  renderSelectedState();
  detail.hidden = true;
}

function applyView() {
  if (!svg) return;
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${WORLD_WIDTH / view.zoom} ${WORLD_HEIGHT / view.zoom}`);
}

function clampView() {
  const visibleWidth = WORLD_WIDTH / view.zoom;
  const visibleHeight = WORLD_HEIGHT / view.zoom;
  view.x = Math.max(0, Math.min(WORLD_WIDTH - visibleWidth, view.x));
  view.y = Math.max(0, Math.min(WORLD_HEIGHT - visibleHeight, view.y));
}

function zoomAt(multiplier, clientX = root.clientWidth / 2, clientY = root.clientHeight / 2) {
  const bounds = root.getBoundingClientRect();
  const beforeWidth = WORLD_WIDTH / view.zoom;
  const beforeHeight = WORLD_HEIGHT / view.zoom;
  const beforeX = view.x + ((clientX - bounds.left) / bounds.width) * beforeWidth;
  const beforeY = view.y + ((clientY - bounds.top) / bounds.height) * beforeHeight;
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * multiplier));
  const afterWidth = WORLD_WIDTH / nextZoom;
  const afterHeight = WORLD_HEIGHT / nextZoom;

  view.x = beforeX - ((clientX - bounds.left) / bounds.width) * afterWidth;
  view.y = beforeY - ((clientY - bounds.top) / bounds.height) * afterHeight;
  view.zoom = nextZoom;
  clampView();
  applyView();
}

function resetView() {
  view = {
    x: WORLD_WIDTH * 0.15,
    y: WORLD_HEIGHT * 0.2,
    zoom: 1,
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
    view.x -= ((event.clientX - lastPointer.x) / bounds.width) * (WORLD_WIDTH / view.zoom);
    view.y -= ((event.clientY - lastPointer.y) / bounds.height) * (WORLD_HEIGHT / view.zoom);
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

async function loadMap() {
  try {
    const response = await fetch("/api/map");
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.sites)) {
      throw new Error(body.error || "Map request failed");
    }
    sites = body.sites;
    buildMap();
    resetView();
  } catch {
    statusEl.textContent = "Could not load the TownSquare map.";
    buildMap();
    resetView();
  }
}

wireControls();
loadMap();
