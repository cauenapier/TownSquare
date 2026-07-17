import { bindCopy, createSvgElement } from "../../lib/ui-common.mjs";
import { buildMapEdges } from "../../map/map-connections.mjs";
import { layoutMapSites } from "../../map/map-layout.mjs";
import { createCityMarker, renderMapEdge } from "../../map/map-render.mjs";
import { routeMapRoads } from "../../map/map-roads.mjs";
import { renderSceneryLayer } from "../../map/map-scenery.mjs";
import {
  mergeOverlappingWaterAreas,
  waterAreaTouchesPoint,
} from "../../map/map-water.mjs";
import {
  cloneMapWorld,
  MAP_PROP_TYPES,
  MAX_MAP_PROPS,
  MAX_WATER_POINTS,
  MAX_WATER_STROKES,
  validateMapWorld,
} from "../../lib/map-world.mjs";
import {
  createAutoRefresh,
  createCredentialStore,
  createStatusSetter,
  formatTime,
  postJson,
} from "./hosted-common.mjs";
import { createServiceAdminNotifications } from "./service-admin-notifications.mjs";
import {
  buildStackedVisitorActivityView,
  buildVisitorActivityView,
} from "./visitor-activity-view.mjs?v=traffic-activity-v3";

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginPasswordEl = document.getElementById("login-password");
const rememberMeEl = document.getElementById("login-remember");
const loginSubmitButton = document.getElementById("login-submit");
const loginStatusEl = document.getElementById("login-status");
const signOutButton = document.getElementById("sign-out");
const statusEl = document.getElementById("admin-status");
const siteFilterEl = document.getElementById("site-filter");
const siteVerifiedFilterEl = document.getElementById("site-verified-filter");
const siteFilterMetaEl = document.getElementById("site-filter-meta");
const allSiteTrafficButton = document.getElementById("all-site-traffic");
const siteColumnPickerPanelEl = document.getElementById("site-column-picker-panel");
const siteTableWrapEl = document.getElementById("site-table-wrap");
const siteTableHeadEl = document.getElementById("site-table-head");
const siteTableBodyEl = document.getElementById("site-table-body");
const siteEmptyEl = document.getElementById("site-empty");
const siteNoMatchesEl = document.getElementById("site-no-matches");
const trafficFlowsEl = document.getElementById("traffic-flows");
const platformStatsCardsEl = document.getElementById("platform-stats-cards");
const visitorTrendChartEl = document.getElementById("visitor-trend-chart");
const messageTrendChartEl = document.getElementById("message-trend-chart");
const verifiedTrendChartEl = document.getElementById("verified-trend-chart");
const topSitesListEl = document.getElementById("top-sites-list");
const dormantSitesListEl = document.getElementById("dormant-sites-list");
const ownerActivityListEl = document.getElementById("owner-activity-list");
const tokenResult = document.getElementById("token-result");
const newAdminTokenEl = document.getElementById("new-admin-token");
const newAdminLink = document.getElementById("new-admin-link");
const copyTokenButton = document.getElementById("copy-token");
const mapEditorStatusEl = document.getElementById("map-editor-status");
const mapEditorCanvasEl = document.getElementById("map-editor-canvas");
const mapToolButtons = [...document.querySelectorAll("[data-map-tool]")];
const mapUndoButton = document.getElementById("map-undo");
const mapRedoButton = document.getElementById("map-redo");
const mapDiscardButton = document.getElementById("map-discard");
const mapSaveButton = document.getElementById("map-save");
const mapBrushSizeEl = document.getElementById("map-brush-size");
const mapBrushSizeValueEl = document.getElementById("map-brush-size-value");
const mapDensityControlEl = document.getElementById("map-density-control");
const mapDensityEl = document.getElementById("map-density");
const mapDensityValueEl = document.getElementById("map-density-value");
const serviceAdminTabs = document.getElementById("service-admin-tabs");
const tabButtons = serviceAdminTabs ? [...serviceAdminTabs.querySelectorAll("[data-tab]")] : [];
const tabPanels = [...document.querySelectorAll(".hosted-tabpanel")];
const trafficDialogEl = document.getElementById("service-traffic-dialog");
const trafficDialogTitleEl = document.getElementById("service-traffic-title");
const trafficDialogMetaEl = document.getElementById("service-traffic-meta");
const trafficDialogChartEl = document.getElementById("service-traffic-chart");
const trafficDialogCloseButton = document.getElementById("service-traffic-close");
const trafficTooltipEl = document.getElementById("service-traffic-tooltip");

const STORAGE_KEY = "townsquare-service-admin-password";
const TABLE_PREFS_KEY = "townsquare-service-admin-table";
const REFRESH_INTERVAL_MS = 5000;
const MAX_MAP_HISTORY_ITEMS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_CHART_DAYS = 7;

const TABLE_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "origin", label: "Origin" },
  { key: "siteKey", label: "Site key", mono: true },
  { key: "email", label: "Email" },
  { key: "disabled", label: "Status", render: (site) => (site.disabled ? "Disabled" : "Enabled") },
  { key: "chatDisabled", label: "Chat", render: (site) => (site.chatDisabled ? "Disabled" : "Enabled") },
  { key: "supporter", label: "Supporter", render: (site) => (site.supporter ? "Yes" : "No") },
  { key: "plus", label: "Plus", render: (site) => (site.plus ? "Yes" : "No") },
  { key: "overlayLastAt", label: "Overlay used", render: (site) => site.overlayUseCount ? `${site.overlayUseCount} · ${formatTime(site.overlayLastAt)}` : "Never" },
  { key: "verifiedAt", label: "Verified", render: (site) => formatTime(site.verifiedAt) },
  { key: "lastSeenAt", label: "Last seen", render: (site) => formatTime(site.lastSeenAt) },
  { key: "lastSeenUrl", label: "Last URL", link: true, render: (site) => site.lastSeenUrl || "" },
  { key: "messageCount", label: "Messages", render: (site) => String(site.messageCount ?? 0) },
  { key: "messagesDaily", label: "Msgs today", render: (site) => String(site.messageStats?.daily ?? 0) },
  { key: "messagesWeekly", label: "Msgs (7d)", render: (site) => String(site.messageStats?.weekly ?? 0) },
  { key: "messagesMonthly", label: "Msgs (30d)", render: (site) => String(site.messageStats?.monthly ?? 0) },
  { key: "lastMessageAt", label: "Last message", render: (site) => formatTime(site.lastMessageAt) },
  { key: "activeVisitors", label: "Active", render: (site) => String(site.activeVisitors ?? 0) },
  { key: "visitorsDaily", label: "Daily", render: (site) => String(site.visitorStats?.daily ?? 0) },
  { key: "visitorsWeekly", label: "Weekly", render: (site) => String(site.visitorStats?.weekly ?? 0) },
  { key: "visitorsMonthly", label: "Monthly", render: (site) => String(site.visitorStats?.monthly ?? 0) },
  { key: "connectionClickTotal", label: "Outbound", render: (site) => String(site.connectionClickTotal ?? 0) },
  { key: "mapClickTotal", label: "Map clicks", render: (site) => String(site.mapClickTotal ?? 0) },
  { key: "adminAccessLastAt", label: "Owner in admin", render: (site) => formatTime(site.adminAccessLastAt) },
  { key: "adminAccessCount", label: "Admin visits", render: (site) => String(site.adminAccessCount ?? 0) },
  { key: "weatherActivationAttempts", label: "Weather tried", render: (site) => site.weatherActivationAttempts ? `${site.weatherActivationAttempts} · ${formatTime(site.weatherActivationLastAt)}` : "Never" },
  { key: "weatherActivated", label: "Weather active", render: (site) => (site.weatherActivated ? "Yes" : "No") },
  { key: "footballActivated", label: "Football active", render: (site) => (site.footballActivated ? "Yes" : "No") },
  { key: "blockedCount", label: "Blocked", render: (site) => String(site.blockedCount ?? 0) },
];

function loadTablePrefs() {
  try {
    const raw = localStorage.getItem(TABLE_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTablePrefs() {
  localStorage.setItem(TABLE_PREFS_KEY, JSON.stringify({
    visibleColumns: [...visibleColumnKeys],
    verifiedOnly,
  }));
}

const tablePrefs = loadTablePrefs();
const defaultVisibleColumnKeys = TABLE_COLUMNS.map((column) => column.key);
const storedVisibleColumnKeys = Array.isArray(tablePrefs?.visibleColumns)
  ? tablePrefs.visibleColumns.filter((key) => TABLE_COLUMNS.some((column) => column.key === key))
  : null;
let visibleColumnKeys = new Set(
  storedVisibleColumnKeys?.length > 0 ? storedVisibleColumnKeys : defaultVisibleColumnKeys,
);
if (storedVisibleColumnKeys?.length > 0 && !visibleColumnKeys.has("overlayLastAt")) {
  visibleColumnKeys.add("overlayLastAt");
}
let verifiedOnly = typeof tablePrefs?.verifiedOnly === "boolean" ? tablePrefs.verifiedOnly : true;
siteVerifiedFilterEl.checked = verifiedOnly;

const credentialStore = createCredentialStore(STORAGE_KEY);

const stored = credentialStore.read();
let password = typeof stored?.value === "string" ? stored.value : "";
let rememberMe = stored?.remembered ?? false;
const notifications = createServiceAdminNotifications(() => password);

let allSites = [];
let filterQuery = "";
let sortKey = "verifiedAt";
let sortAsc = false;
let columnPickerReady = false;
let tableHeadSignature = "";
let savedMapWorld = null;
let draftMapWorld = null;
let mapEditorSvg = null;
let mapEditorDirty = false;
let mapEditorRenderFrame = null;
let mapEditorRoadRoutes = new Map();
let mapTownSnapshot = "";
let mapTool = "tree";
let mapUndoStack = [];
let mapRedoStack = [];
let mapGesture = null;
let mapEditorLoading = false;
let mapEditorSaving = false;
let mapEditorMessage = "";
let mapBrushSize = Number(mapBrushSizeEl.value);
let mapTreeDensity = Number(mapDensityEl.value);
let trafficRequestId = 0;

const setLoginStatus = createStatusSetter(loginStatusEl, { toggleHidden: true });
const setStatus = createStatusSetter(statusEl);
const autoRefresh = createAutoRefresh(() => loadSites({ silent: true }), REFRESH_INTERVAL_MS);

function setActiveTab(name) {
  if (!tabPanels.some((panel) => panel.dataset.tab === name)) return;
  for (const button of tabButtons) {
    const selected = button.dataset.tab === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tab !== name;
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
}

// Every service-admin request carries the operator password.
const api = (path, payload = {}) => postJson(path, { password, ...payload });

function mapIsDirty() {
  return Boolean(savedMapWorld && draftMapWorld && mapEditorDirty);
}

function updateMapEditorControls() {
  const dirty = mapIsDirty();
  const editing = mapEditorSaving || Boolean(mapGesture);
  mapUndoButton.disabled = editing || mapUndoStack.length === 0;
  mapRedoButton.disabled = editing || mapRedoStack.length === 0;
  mapDiscardButton.disabled = editing || !dirty;
  mapSaveButton.disabled = editing || !dirty;
  for (const button of mapToolButtons) {
    button.disabled = editing || !draftMapWorld;
    button.setAttribute("aria-pressed", String(button.dataset.mapTool === mapTool));
  }
  mapBrushSizeEl.disabled = editing || !draftMapWorld || mapTool === "mountain";
  mapDensityEl.disabled = editing || !draftMapWorld || mapTool !== "tree";
  mapDensityControlEl.hidden = mapTool !== "tree";
  if (mapEditorMessage) {
    mapEditorStatusEl.textContent = mapEditorMessage;
  } else if (draftMapWorld) {
    const itemCount = draftMapWorld.props.length + draftMapWorld.water.length;
    mapEditorStatusEl.textContent = `${itemCount} map item${itemCount === 1 ? "" : "s"}${dirty ? " · Unsaved changes" : " · Saved"}`;
  }
}

function renderMapEditor() {
  mapEditorRenderFrame = null;
  if (!draftMapWorld) return;
  const svg = createSvgElement("svg", {
    class: "map-editor__svg",
    viewBox: `0 0 ${draftMapWorld.width} ${draftMapWorld.height}`,
    role: "img",
    "aria-label": "Editable map scenery with read-only TownSquare locations",
  });
  svg.appendChild(renderSceneryLayer(draftMapWorld));

  const visibleSites = allSites.filter((site) => site.verifiedAt && !site.disabled);
  const positions = layoutMapSites(visibleSites, draftMapWorld.width, draftMapWorld.height);
  const edges = createSvgElement("g", { class: "map-edges", "aria-hidden": "true" });
  const mapEdges = buildMapEdges(visibleSites);
  if (!mapGesture) mapEditorRoadRoutes = routeMapRoads(mapEdges, visibleSites, positions, draftMapWorld);
  for (const edge of mapEdges) {
    const path = renderMapEdge(edge, positions, "", mapEditorRoadRoutes);
    if (path) edges.appendChild(path);
  }
  svg.appendChild(edges);

  const towns = createSvgElement("g", { class: "map-editor__towns", "aria-hidden": "true" });
  for (const site of visibleSites) {
    const position = positions.get(site.siteKey);
    const marker = createCityMarker(site);
    const town = createSvgElement("g", { transform: `translate(${position.x} ${position.y})` });
    town.append(marker.dot, ...(marker.star ? [marker.star] : []), marker.label);
    towns.appendChild(town);
  }
  svg.appendChild(towns);
  mapEditorSvg = svg;
  mapEditorCanvasEl.replaceChildren(svg);
  mapEditorCanvasEl.hidden = false;
  updateMapEditorControls();
}

function queueMapEditorRender() {
  if (mapEditorRenderFrame !== null) return;
  mapEditorRenderFrame = requestAnimationFrame(renderMapEditor);
}

function flushMapEditorRender() {
  if (mapEditorRenderFrame === null) return;
  cancelAnimationFrame(mapEditorRenderFrame);
  renderMapEditor();
}

function mapPoint(event) {
  if (!mapEditorSvg) return null;
  const matrix = mapEditorSvg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return {
    x: Math.max(0, Math.min(draftMapWorld.width, point.x)),
    y: Math.max(0, Math.min(draftMapWorld.height, point.y)),
  };
}

function eraseMapAt(point) {
  const radius = mapBrushSize / 2;
  const propCount = draftMapWorld.props.length;
  draftMapWorld.props = draftMapWorld.props.filter(
    (prop) => Math.hypot(prop.x - point.x, prop.y - point.y) > radius,
  );
  let erasedWater = false;
  for (const area of draftMapWorld.water) {
    if (!waterAreaTouchesPoint(area, point, radius)) continue;
    if (area.cutouts.some((cutout) => Math.hypot(cutout.x - point.x, cutout.y - point.y) + radius <= cutout.radius)) continue;
    if (mapGesture.waterPointCount >= MAX_WATER_POINTS) {
      mapEditorMessage = `The map is limited to ${MAX_WATER_POINTS} water points.`;
      break;
    }
    area.cutouts.push({
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100,
      radius,
      order: nextWaterOrder(),
    });
    mapGesture.waterPointCount += 1;
    erasedWater = true;
  }
  return propCount !== draftMapWorld.props.length || erasedWater;
}

const TREE_SPACING = 24;

function treeGridKey(x, y) {
  return `${Math.floor(x / TREE_SPACING)},${Math.floor(y / TREE_SPACING)}`;
}

function getTreeGrid() {
  if (mapGesture.treeGrid) return mapGesture.treeGrid;
  const grid = new Map();
  for (const prop of draftMapWorld.props) {
    if (prop.type !== "tree") continue;
    const key = treeGridKey(prop.x, prop.y);
    const cell = grid.get(key) || [];
    cell.push(prop);
    grid.set(key, cell);
  }
  mapGesture.treeGrid = grid;
  return grid;
}

function treeLocationIsCrowded(grid, candidate) {
  const cellX = Math.floor(candidate.x / TREE_SPACING);
  const cellY = Math.floor(candidate.y / TREE_SPACING);
  for (let x = cellX - 1; x <= cellX + 1; x += 1) {
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      const trees = grid.get(`${x},${y}`) || [];
      if (trees.some((tree) => Math.hypot(tree.x - candidate.x, tree.y - candidate.y) < TREE_SPACING)) {
        return true;
      }
    }
  }
  return false;
}

function paintTreeDab(point) {
  const radius = mapBrushSize / 2;
  if (mapGesture.lastPoint
    && Math.hypot(mapGesture.lastPoint.x - point.x, mapGesture.lastPoint.y - point.y) < radius * 0.65) {
    return false;
  }
  mapGesture.lastPoint = point;
  const grid = getTreeGrid();
  let changed = false;
  for (let index = 0; index < mapTreeDensity && draftMapWorld.props.length < MAX_MAP_PROPS; index += 1) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      const candidate = {
        type: "tree",
        x: Math.round(Math.max(0, Math.min(draftMapWorld.width, point.x + Math.cos(angle) * distance)) * 100) / 100,
        y: Math.round(Math.max(0, Math.min(draftMapWorld.height, point.y + Math.sin(angle) * distance)) * 100) / 100,
      };
      if (!treeLocationIsCrowded(grid, candidate)) {
        draftMapWorld.props.push(candidate);
        const key = treeGridKey(candidate.x, candidate.y);
        const cell = grid.get(key) || [];
        cell.push(candidate);
        grid.set(key, cell);
        changed = true;
        break;
      }
    }
  }
  if (draftMapWorld.props.length >= MAX_MAP_PROPS) mapEditorMessage = `The map is limited to ${MAX_MAP_PROPS} props.`;
  return changed;
}

function paintMountain(point) {
  const spacing = MAP_PROP_TYPES.mountain.brushSpacing;
  if (mapGesture.lastPoint && Math.hypot(mapGesture.lastPoint.x - point.x, mapGesture.lastPoint.y - point.y) < spacing) return false;
  if (draftMapWorld.props.length >= MAX_MAP_PROPS) {
    mapEditorMessage = `The map is limited to ${MAX_MAP_PROPS} props.`;
    return false;
  }
  draftMapWorld.props.push({ type: "mountain", x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
  mapGesture.lastPoint = point;
  return true;
}

function countWaterPoints() {
  return draftMapWorld.water.reduce((count, area) => (
    count + area.cutouts.length + area.paths.reduce((pathCount, path) => pathCount + path.points.length, 0)
  ), 0);
}

function countWaterPaths() {
  return draftMapWorld.water.reduce((count, area) => count + area.paths.length, 0);
}

function nextWaterOrder() {
  let order = 0;
  for (const area of draftMapWorld.water) {
    for (const path of area.paths) order = Math.max(order, path.order || 0);
    for (const cutout of area.cutouts) order = Math.max(order, cutout.order || 0);
  }
  return order + 1;
}

function paintWater(point) {
  if (mapGesture.waterPointCount >= MAX_WATER_POINTS) {
    mapEditorMessage = `The map is limited to ${MAX_WATER_POINTS} water points.`;
    updateMapEditorControls();
    return false;
  }
  if (!mapGesture.waterPath) {
    if (countWaterPaths() >= MAX_WATER_STROKES) {
      mapEditorMessage = `The map is limited to ${MAX_WATER_STROKES} water paths.`;
      updateMapEditorControls();
      return false;
    }
    mapGesture.waterPath = { width: mapBrushSize, points: [], order: nextWaterOrder() };
    draftMapWorld.water.push({ type: "water", paths: [mapGesture.waterPath], cutouts: [] });
  }
  const lastPoint = mapGesture.waterPath.points.at(-1);
  const spacing = mapBrushSize <= 40 ? 14 : Math.max(10, mapBrushSize * 0.16);
  if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < spacing) return false;
  mapGesture.waterPath.points.push({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
  mapGesture.waterPointCount += 1;
  return true;
}

function paintMapAt(point) {
  if (mapTool === "erase") {
    return eraseMapAt(point);
  }
  if (mapTool === "tree") return paintTreeDab(point);
  if (mapTool === "mountain") return paintMountain(point);
  if (mapTool === "water") return paintWater(point);
  return false;
}

function applyMapGesture(event) {
  const point = mapPoint(event);
  if (point && paintMapAt(point)) {
    mapGesture.changed = true;
    mapEditorDirty = true;
    mapEditorMessage = "";
    queueMapEditorRender();
  }
}

function finishMapGesture(event) {
  if (!mapGesture || mapGesture.pointerId !== event.pointerId) return;
  const changed = mapGesture.changed;
  if (changed) {
    mapUndoStack.push({ world: mapGesture.before, dirty: mapGesture.beforeDirty });
    trimMapHistory(mapUndoStack);
    mapRedoStack = [];
  }
  if (changed && mapGesture.waterPath) draftMapWorld.water = mergeOverlappingWaterAreas(draftMapWorld.water);
  mapGesture = null;
  if (mapEditorRenderFrame !== null) flushMapEditorRender();
  else if (changed) renderMapEditor();
  else updateMapEditorControls();
}

function mapWorldItemCount(world) {
  return world.props.length + world.water.reduce((count, area) => (
    count + area.cutouts.length + area.paths.reduce((pathCount, path) => pathCount + path.points.length, 0)
  ), 0);
}

function trimMapHistory(history) {
  let itemCount = history.reduce((count, entry) => count + mapWorldItemCount(entry.world), 0);
  while (history.length > 1 && itemCount > MAX_MAP_HISTORY_ITEMS) {
    itemCount -= mapWorldItemCount(history.shift().world);
  }
}

function restoreMapWorld(entry) {
  draftMapWorld = cloneMapWorld(entry.world);
  mapEditorDirty = entry.dirty;
  mapEditorMessage = "";
  renderMapEditor();
}

function undoMapEdit() {
  const entry = mapUndoStack.pop();
  if (!entry) return;
  mapRedoStack.push({ world: cloneMapWorld(draftMapWorld), dirty: mapEditorDirty });
  trimMapHistory(mapRedoStack);
  restoreMapWorld(entry);
}

function redoMapEdit() {
  const entry = mapRedoStack.pop();
  if (!entry) return;
  mapUndoStack.push({ world: cloneMapWorld(draftMapWorld), dirty: mapEditorDirty });
  trimMapHistory(mapUndoStack);
  restoreMapWorld(entry);
}

async function loadMapEditor() {
  if (mapEditorLoading || draftMapWorld) return;
  mapEditorLoading = true;
  mapEditorMessage = "Loading map...";
  updateMapEditorControls();
  const result = await api("/api/service-admin/map");
  mapEditorLoading = false;
  const validated = result.ok ? validateMapWorld(result.body.world) : { ok: false };
  if (!result.ok || !validated.ok) {
    mapEditorMessage = result.body.error || "Could not load the map.";
    updateMapEditorControls();
    return;
  }
  savedMapWorld = cloneMapWorld(validated.world);
  draftMapWorld = cloneMapWorld(validated.world);
  draftMapWorld.water = mergeOverlappingWaterAreas(draftMapWorld.water);
  mapEditorDirty = draftMapWorld.water.length !== savedMapWorld.water.length;
  mapEditorMessage = "";
  renderMapEditor();
}

async function saveMapEditor() {
  if (!draftMapWorld || !mapIsDirty()) return;
  mapEditorSaving = true;
  mapEditorMessage = "Saving map...";
  updateMapEditorControls();
  const result = await api("/api/service-admin/map/save", { world: draftMapWorld });
  mapEditorSaving = false;
  const validated = result.ok ? validateMapWorld(result.body.world) : { ok: false };
  if (!result.ok || !validated.ok) {
    mapEditorMessage = result.body.error || "Could not save the map.";
    updateMapEditorControls();
    return;
  }
  savedMapWorld = cloneMapWorld(validated.world);
  draftMapWorld = cloneMapWorld(validated.world);
  mapEditorDirty = false;
  mapUndoStack = [];
  mapRedoStack = [];
  mapEditorMessage = "Map saved.";
  renderMapEditor();
}

function siteSortValue(site, key) {
  switch (key) {
    case "name":
    case "origin":
    case "siteKey":
      return String(site[key] || "").toLowerCase();
    case "email":
      return String(site.email || "").toLowerCase();
    case "disabled":
    case "chatDisabled":
    case "supporter":
    case "plus":
      return Number(Boolean(site[key]));
    case "verifiedAt":
    case "lastSeenAt":
    case "lastMessageAt":
    case "adminAccessLastAt":
    case "overlayLastAt":
      return Number(site[key] || 0);
    case "messageCount":
    case "activeVisitors":
    case "connectionClickTotal":
    case "mapClickTotal":
    case "adminAccessCount":
    case "blockedCount":
      return Number(site[key] ?? 0);
    case "messagesDaily":
      return Number(site.messageStats?.daily ?? 0);
    case "messagesWeekly":
      return Number(site.messageStats?.weekly ?? 0);
    case "messagesMonthly":
      return Number(site.messageStats?.monthly ?? 0);
    case "visitorsDaily":
      return Number(site.visitorStats?.daily ?? 0);
    case "visitorsWeekly":
      return Number(site.visitorStats?.weekly ?? 0);
    case "visitorsMonthly":
      return Number(site.visitorStats?.monthly ?? 0);
    default:
      return "";
  }
}

function compareSites(a, b, key) {
  const left = siteSortValue(a, key);
  const right = siteSortValue(b, key);
  if (left < right) return -1;
  if (left > right) return 1;
  return a.siteKey.localeCompare(b.siteKey);
}

function visibleColumns() {
  return TABLE_COLUMNS.filter((column) => visibleColumnKeys.has(column.key));
}

function siteMatchesFilter(site, query) {
  if (!query) return true;
  const haystack = [site.name, site.origin, site.siteKey, site.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function visibleSites() {
  const query = filterQuery.trim().toLowerCase();
  return allSites
    .filter((site) => !verifiedOnly || Boolean(site.verifiedAt))
    .filter((site) => siteMatchesFilter(site, query))
    .sort((left, right) => {
      const order = compareSites(left, right, sortKey);
      return sortAsc ? order : -order;
    });
}

function setColumnVisible(key, visible) {
  if (visible) {
    visibleColumnKeys.add(key);
  } else if (visibleColumnKeys.size > 1) {
    visibleColumnKeys.delete(key);
  } else {
    return;
  }
  saveTablePrefs();
  renderSitesTable({ rebuildHead: true });
}

function resetTableColumns() {
  visibleColumnKeys = new Set(defaultVisibleColumnKeys);
  saveTablePrefs();
  renderSitesTable({ rebuildHead: true });
}

function ensureColumnPicker() {
  if (columnPickerReady || !siteColumnPickerPanelEl) return;

  const list = document.createElement("div");
  list.className = "service-column-picker-list";

  for (const column of TABLE_COLUMNS) {
    const label = document.createElement("label");
    label.className = "service-column-picker-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = visibleColumnKeys.has(column.key);
    input.addEventListener("change", () => {
      setColumnVisible(column.key, input.checked);
      input.checked = visibleColumnKeys.has(column.key);
    });

    const text = document.createElement("span");
    text.textContent = column.label;

    label.append(input, text);
    list.append(label);
  }

  const actions = document.createElement("div");
  actions.className = "service-column-picker-actions";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "hosted-quiet-button";
  reset.textContent = "Reset columns";
  reset.addEventListener("click", () => {
    resetTableColumns();
    columnPickerReady = false;
    siteColumnPickerPanelEl.replaceChildren();
    ensureColumnPicker();
  });

  actions.append(reset);
  siteColumnPickerPanelEl.append(list, actions);
  columnPickerReady = true;
}

function renderTableHead() {
  const columns = visibleColumns();
  const sortRow = document.createElement("tr");
  sortRow.className = "service-table-sort-row";

  for (const column of columns) {
    const header = document.createElement("th");
    header.scope = "col";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "service-sort-button";
    button.dataset.sortKey = column.key;
    button.textContent = column.label;
    button.addEventListener("click", () => {
      if (sortKey === column.key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = column.key;
        sortAsc = true;
      }
      renderSitesTableBody();
      updateSortIndicators();
    });
    header.append(button);
    sortRow.append(header);
  }

  const actionsHeader = document.createElement("th");
  actionsHeader.scope = "col";
  actionsHeader.className = "service-table-actions-head";
  actionsHeader.textContent = "Actions";
  sortRow.append(actionsHeader);

  siteTableHeadEl.replaceChildren(sortRow);
}

function updateSortIndicators() {
  for (const button of siteTableHeadEl.querySelectorAll(".service-sort-button")) {
    const active = button.dataset.sortKey === sortKey;
    button.classList.toggle("service-sort-button--active", active);
    button.setAttribute("aria-sort", active ? (sortAsc ? "ascending" : "descending") : "none");
  }
}

function closeRowMenus(except = null) {
  for (const menu of siteTableBodyEl.querySelectorAll(".service-row-menu[open]")) {
    if (menu !== except) menu.open = false;
  }
}

function createActionMenu(site) {
  const menu = document.createElement("details");
  menu.className = "service-row-menu";

  const summary = document.createElement("summary");
  summary.textContent = "Actions";
  menu.append(summary);

  const panel = document.createElement("div");
  panel.className = "service-row-menu-panel";

  const toggleSite = document.createElement("button");
  toggleSite.type = "button";
  toggleSite.textContent = site.disabled ? "Enable site" : "Disable site";
  toggleSite.addEventListener("click", () => {
    menu.open = false;
    void action("setSiteDisabled", site.siteKey, { disabled: !site.disabled });
  });

  const toggleChat = document.createElement("button");
  toggleChat.type = "button";
  toggleChat.textContent = site.chatDisabled ? "Enable chat" : "Disable chat";
  toggleChat.addEventListener("click", () => {
    menu.open = false;
    void action("setChatDisabled", site.siteKey, { disabled: !site.chatDisabled });
  });

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset token";
  reset.addEventListener("click", () => {
    menu.open = false;
    void resetAdminToken(site.siteKey);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "service-danger";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => {
    menu.open = false;
    void deleteSite(site);
  });

  const toggleSupporter = document.createElement("button");
  toggleSupporter.type = "button";
  toggleSupporter.textContent = site.supporter ? "Remove supporter" : "Mark as supporter";
  toggleSupporter.addEventListener("click", () => {
    menu.open = false;
    void action("setSiteSupporter", site.siteKey, { supporter: !site.supporter });
  });

  const togglePlus = document.createElement("button");
  togglePlus.type = "button";
  togglePlus.textContent = site.plus ? "Remove Plus" : "Mark as Plus";
  togglePlus.addEventListener("click", () => {
    menu.open = false;
    void action("setSitePlus", site.siteKey, { plus: !site.plus });
  });

  panel.append(toggleSite, toggleChat, toggleSupporter, togglePlus, reset, remove);
  menu.append(panel);

  menu.addEventListener("toggle", () => {
    if (menu.open) closeRowMenus(menu);
  });

  return menu;
}

function formatVisitorAverage(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function trafficToneClass(tone) {
  return `service-traffic-tone--${tone}`;
}

function positionTrafficTooltip(x, y) {
  const offset = 14;
  const rect = trafficTooltipEl.getBoundingClientRect();
  let left = x + offset;
  let top = y + offset;
  if (left + rect.width > window.innerWidth) left = x - rect.width - offset;
  if (top + rect.height > window.innerHeight) top = y - rect.height - offset;
  trafficTooltipEl.style.left = `${Math.max(0, left)}px`;
  trafficTooltipEl.style.top = `${Math.max(0, top)}px`;
}

function showTrafficTooltip(text, x, y) {
  trafficTooltipEl.textContent = text;
  trafficTooltipEl.hidden = false;
  positionTrafficTooltip(x, y);
}

function hideTrafficTooltip() {
  trafficTooltipEl.hidden = true;
}

function attachTrafficTooltip(el, text) {
  el.addEventListener("mouseenter", (event) => showTrafficTooltip(text, event.clientX, event.clientY));
  el.addEventListener("mousemove", (event) => positionTrafficTooltip(event.clientX, event.clientY));
  el.addEventListener("mouseleave", hideTrafficTooltip);
}

function renderVisitorTraffic(view, { aggregate = false } = {}) {
  trafficDialogChartEl.replaceChildren();
  trafficDialogMetaEl.textContent = aggregate
    ? `Up to the last ${view.windowDays} days · ${view.timeZone}. Each stack sums the sites' own weekday averages.`
    : `Up to the last ${view.windowDays} days · ${view.timeZone}. Bar height is relative to this site's busiest average hour.`;

  if (view.peakAverage === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note service-traffic-dialog__empty";
    empty.textContent = "No hourly visitor activity has been recorded yet.";
    trafficDialogChartEl.append(empty);
    return;
  }

  const peak = view.rows
    .flatMap((row) => row.hours.map((slot) => ({ ...slot, day: row.name })))
    .find((slot) => slot.average === view.peakAverage);
  const summary = document.createElement("p");
  summary.className = "service-traffic-dialog__summary";
  const scope = aggregate ? ` across ${view.siteCount} site${view.siteCount === 1 ? "" : "s"} with recorded traffic` : "";
  summary.textContent = `Busiest: ${peak.day} at ${hourLabel(peak.hour)} ${view.timeZone} · ${formatVisitorAverage(peak.average)} average visitor${peak.average === 1 ? "" : "s"}${scope}.`;

  const legend = document.createElement("ul");
  legend.className = "service-traffic-legend";
  for (const contributor of view.legend || []) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `service-traffic-legend__swatch ${trafficToneClass(contributor.tone)}`;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, contributor.label);
    legend.append(item);
  }

  const table = document.createElement("table");
  table.className = "service-traffic-chart";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const dayHeading = document.createElement("th");
  dayHeading.scope = "col";
  dayHeading.textContent = "Day";
  headRow.append(dayHeading);
  for (let hour = 0; hour < 24; hour += 1) {
    const heading = document.createElement("th");
    heading.scope = "col";
    heading.textContent = String(hour).padStart(2, "0");
    heading.title = hourLabel(hour);
    headRow.append(heading);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of view.rows) {
    const tableRow = document.createElement("tr");
    const day = document.createElement("th");
    day.scope = "row";
    day.textContent = row.name.slice(0, 3);
    day.title = aggregate
      ? row.name
      : `${row.name} · ${row.sampleDays} sampled day${row.sampleDays === 1 ? "" : "s"}`;
    tableRow.append(day);

    for (const slot of row.hours) {
      const cell = document.createElement("td");
      const average = formatVisitorAverage(slot.average);
      const percentage = Math.round(slot.percentage);
      const breakdown = (slot.segments || [])
        .filter((segment) => segment.average > 0)
        .map((segment) => `${segment.label}: ${formatVisitorAverage(segment.average)}`)
        .join("; ");
      const tooltipText = `${row.name} ${hourLabel(slot.hour)} ${view.timeZone}: ${average} average visitor${slot.average === 1 ? "" : "s"} (${percentage}% of peak)${breakdown ? `. ${breakdown}` : ""}`;
      cell.setAttribute("aria-label", tooltipText);
      attachTrafficTooltip(cell, tooltipText);

      const track = document.createElement("span");
      track.className = `service-traffic-chart__track${aggregate ? " service-traffic-chart__track--stacked" : ""}`;
      track.setAttribute("aria-hidden", "true");
      if (aggregate) {
        for (const segment of slot.segments) {
          if (segment.average <= 0) continue;
          const bar = document.createElement("span");
          bar.className = `service-traffic-chart__bar ${trafficToneClass(segment.tone)}`;
          bar.style.height = `${segment.percentage}%`;
          track.append(bar);
        }
      } else if (slot.average > 0) {
        const bar = document.createElement("span");
        bar.className = "service-traffic-chart__bar";
        bar.style.height = `${slot.percentage}%`;
        track.append(bar);
      }
      cell.append(track);
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(head, body);
  trafficDialogChartEl.append(summary, ...(legend.childElementCount > 0 ? [legend] : []), table);
}

async function openVisitorTraffic(title, payload, render) {
  const requestId = ++trafficRequestId;
  closeRowMenus();
  trafficDialogTitleEl.textContent = title;
  trafficDialogMetaEl.textContent = "Loading hourly activity...";
  trafficDialogChartEl.replaceChildren();
  hideTrafficTooltip();
  if (!trafficDialogEl.open) trafficDialogEl.showModal();

  const result = await api("/api/service-admin/traffic", payload);
  if (requestId !== trafficRequestId) return;
  if (result.status === 403) {
    trafficDialogEl.close();
    credentialStore.clear();
    password = "";
    showLogin(result.body.error || "Could not open service admin.", true);
    return;
  }
  if (!result.ok) {
    trafficDialogMetaEl.textContent = result.body.error || "Could not load visitor traffic.";
    return;
  }
  render(result.body);
}

function showVisitorTraffic(site) {
  return openVisitorTraffic(
    `${site.name || site.origin || site.siteKey} traffic`,
    { siteKey: site.siteKey },
    (body) => renderVisitorTraffic(buildVisitorActivityView(body.activity)),
  );
}

function showAllVisitorTraffic() {
  return openVisitorTraffic(
    "All websites traffic",
    {},
    (body) => renderVisitorTraffic(buildStackedVisitorActivityView(body.sites), { aggregate: true }),
  );
}

function renderCell(site, column) {
  const cell = document.createElement("td");
  const value = column.render ? column.render(site) : String(site[column.key] ?? "");

  if (column.link) {
    if (value) {
      const link = document.createElement("a");
      link.href = value;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = value;
      cell.append(link);
    } else {
      cell.textContent = "—";
    }
  } else if (column.mono) {
    const code = document.createElement("code");
    code.textContent = value;
    cell.append(code);
  } else if (column.key === "name") {
    if (site.supporter) {
      const star = document.createElement("span");
      star.className = "service-supporter-star";
      star.textContent = "★";
      star.setAttribute("aria-hidden", "true");
      cell.append(star, " ", site.name);
    } else {
      cell.textContent = site.name;
    }
  } else if (column.key === "disabled" || column.key === "chatDisabled" || column.key === "supporter" || column.key === "plus") {
    const badge = document.createElement("span");
    const on = (column.key === "supporter" || column.key === "plus")
      ? site[column.key]
      : !(column.key === "disabled" ? site.disabled : site.chatDisabled);
    badge.className = `service-status-badge${on ? "" : " service-status-badge--off"}`;
    badge.textContent = value;
    cell.append(badge);
  } else {
    cell.textContent = value;
  }

  return cell;
}

function renderSitesTableBody() {
  const sites = visibleSites();
  const filtered = Boolean(filterQuery.trim()) || verifiedOnly;

  siteEmptyEl.hidden = allSites.length > 0;
  siteNoMatchesEl.hidden = allSites.length === 0 || sites.length > 0;
  siteTableWrapEl.hidden = allSites.length === 0;

  if (filtered && allSites.length > 0) {
    siteFilterMetaEl.hidden = false;
    siteFilterMetaEl.textContent = `Showing ${sites.length} of ${allSites.length} website${allSites.length === 1 ? "" : "s"}`;
  } else {
    siteFilterMetaEl.hidden = true;
    siteFilterMetaEl.textContent = "";
  }

  siteTableBodyEl.replaceChildren();

  for (const site of sites) {
    const row = document.createElement("tr");

    for (const column of visibleColumns()) {
      row.append(renderCell(site, column));
    }

    const actionsCell = document.createElement("td");
    actionsCell.className = "service-table-actions-cell";
    const actions = document.createElement("div");
    actions.className = "service-table-actions";
    const traffic = document.createElement("button");
    traffic.type = "button";
    traffic.className = "service-row-action-button";
    traffic.textContent = "Traffic";
    traffic.setAttribute("aria-label", `View hourly traffic for ${site.name || site.siteKey}`);
    traffic.addEventListener("click", () => void showVisitorTraffic(site));
    actions.append(createActionMenu(site), traffic);
    actionsCell.append(actions);
    row.append(actionsCell);

    siteTableBodyEl.append(row);
  }
}

function renderSitesTable({ rebuildHead = false } = {}) {
  ensureColumnPicker();

  const headSignature = [...visibleColumnKeys].sort().join(",");
  if (rebuildHead || headSignature !== tableHeadSignature) {
    renderTableHead();
    tableHeadSignature = headSignature;
  }

  updateSortIndicators();
  renderSitesTableBody();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Flatten every site's recorded signpost clicks into source -> destination edges,
// busiest first, so the operator can read which towns lead visitors where.
function trafficEdges(sites) {
  const edges = [];
  for (const site of sites) {
    const clicks = site.connectionClicks;
    if (!clicks || typeof clicks !== "object") continue;
    const labelByUrl = new Map((site.connections || []).map((c) => [c.url, c.label]));
    for (const [url, entry] of Object.entries(clicks)) {
      const count = Number(entry?.count ?? 0);
      if (count <= 0) continue;
      edges.push({
        source: site.name || site.origin || site.siteKey,
        destLabel: labelByUrl.get(url) || hostOf(url),
        destHost: hostOf(url),
        count,
        lastAt: Number(entry?.lastAt ?? 0),
      });
    }
  }
  edges.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  return edges;
}

function renderTrafficFlows(sites) {
  if (!trafficFlowsEl) return;
  trafficFlowsEl.replaceChildren();

  const edges = trafficEdges(sites);
  if (edges.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No connected-town clicks recorded yet.";
    trafficFlowsEl.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "service-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["From", "To", "Clicks", "Last click"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  const body = document.createElement("tbody");
  for (const edge of edges) {
    const row = document.createElement("tr");

    const from = document.createElement("td");
    from.textContent = edge.source;

    const to = document.createElement("td");
    to.textContent = edge.destLabel === edge.destHost ? edge.destLabel : `${edge.destLabel} (${edge.destHost})`;

    const count = document.createElement("td");
    count.textContent = String(edge.count);

    const last = document.createElement("td");
    last.textContent = formatTime(edge.lastAt);

    row.append(from, to, count, last);
    body.appendChild(row);
  }

  table.append(head, body);
  trafficFlowsEl.appendChild(table);
}

function buildPlatformStats(sites, platform = null) {
  if (platform) return platform;

  const now = Date.now();
  let onlineNow = 0;
  let activeSitesNow = 0;
  let seenToday = 0;
  let activeSites7d = 0;
  let activeSites30d = 0;
  let inactiveVerifiedSites30d = 0;
  let visitorsWeekly = 0;
  let chattingThisWeek = 0;
  let messagesToday = 0;
  let messagesWeekly = 0;
  let ownersInAdmin7d = 0;

  for (const site of sites) {
    const active = site.activeVisitors ?? 0;
    const weekly = site.visitorStats?.weekly ?? 0;
    const monthly = site.visitorStats?.monthly ?? 0;
    onlineNow += active;
    if (active > 0) activeSitesNow += 1;
    if (site.lastSeenAt && now - site.lastSeenAt < DAY_MS) seenToday += 1;
    visitorsWeekly += weekly;
    if (weekly > 0) activeSites7d += 1;
    if (monthly > 0) activeSites30d += 1;
    if (site.verifiedAt && !site.disabled && now - site.verifiedAt > 30 * DAY_MS && monthly === 0) {
      inactiveVerifiedSites30d += 1;
    }
    if (site.lastMessageAt && now - site.lastMessageAt < 7 * DAY_MS) chattingThisWeek += 1;
    messagesToday += site.messageStats?.daily ?? 0;
    messagesWeekly += site.messageStats?.weekly ?? 0;
    if (site.adminAccessLastAt && now - site.adminAccessLastAt < 7 * DAY_MS) ownersInAdmin7d += 1;
  }

  return {
    onlineNow,
    activeSitesNow,
    seenToday,
    activeSites7d,
    activeSites30d,
    inactiveVerifiedSites30d,
    visitorsWeekly,
    chattingThisWeek,
    messagesToday,
    messagesWeekly,
    ownersInAdmin7d,
    dailySeries: [],
    messageDailySeries: [],
  };
}

function formatChartDay(dayIndex) {
  const date = new Date(dayIndex * DAY_MS);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function buildVerifiedSitesSeries(sites, windowDays = VERIFIED_CHART_DAYS) {
  const verifiedAt = sites
    .map((site) => site.verifiedAt)
    .filter((at) => typeof at === "number" && at > 0);
  if (verifiedAt.length === 0) return [];

  const today = Math.floor(Date.now() / DAY_MS);
  const startDay = today - windowDays + 1;
  const series = [];

  for (let day = startDay; day <= today; day += 1) {
    const cutoff = (day + 1) * DAY_MS;
    const count = verifiedAt.filter((at) => at < cutoff).length;
    series.push({ day, count });
  }

  return series;
}

function renderStatsBarChart(container, series, {
  emptyText,
  ariaLabelPrefix,
  barClass = "",
  scaleFromZero = true,
} = {}) {
  if (!container) return;
  container.replaceChildren();

  if (!Array.isArray(series) || series.length === 0) {
    container.setAttribute("aria-label", emptyText || "No data yet.");
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = emptyText || "No data yet.";
    container.append(empty);
    return;
  }

  const counts = series.map((entry) => entry.count ?? 0);
  const maxCount = Math.max(...counts);
  const minCount = scaleFromZero ? 0 : Math.min(...counts);
  const range = Math.max(1, maxCount - minCount);
  const summary = series.map((entry) => `${formatChartDay(entry.day)}: ${entry.count ?? 0}`).join(", ");
  container.setAttribute("aria-label", `${ariaLabelPrefix}. ${summary}`);

  const labelEvery = series.length > 14 ? Math.ceil(series.length / 7) : 1;

  for (const [index, entry] of series.entries()) {
    const count = entry.count ?? 0;
    const labeled = index % labelEvery === 0 || index === series.length - 1;
    const wrap = document.createElement("div");
    wrap.className = "service-stats-chart__bar-wrap";

    const value = document.createElement("span");
    value.className = "service-stats-chart__value";
    value.textContent = labeled ? String(count) : "";
    wrap.title = `${formatChartDay(entry.day)}: ${count}`;

    const bar = document.createElement("div");
    bar.className = `service-stats-chart__bar${barClass ? ` ${barClass}` : ""}`;
    bar.style.height = `${Math.max(4, Math.round(((count - minCount) / range) * 120))}px`;

    const label = document.createElement("span");
    label.className = "service-stats-chart__label";
    label.textContent = labeled ? formatChartDay(entry.day) : "";

    wrap.append(value, bar, label);
    container.append(wrap);
  }
}

function renderPlatformStats(platform) {
  if (!platformStatsCardsEl) return;
  platformStatsCardsEl.replaceChildren();

  const cards = [
    { value: platform.onlineNow, label: "Online now" },
    { value: platform.activeSitesNow, label: "Active sites now" },
    { value: platform.seenToday, label: "Seen today" },
    { value: platform.activeSites7d, label: "Active sites (7d)" },
    { value: platform.activeSites30d, label: "Active sites (30d)" },
    { value: platform.inactiveVerifiedSites30d ?? 0, label: "Inactive verified sites (30d+)" },
    { value: platform.visitorsWeekly, label: "Unique visitors (7d)" },
    { value: platform.chattingThisWeek, label: "Chatting this week" },
    { value: platform.messagesToday ?? 0, label: "Messages today" },
    { value: platform.messagesWeekly ?? 0, label: "Messages (7d)" },
    { value: platform.ownersInAdmin7d ?? 0, label: "Owners in admin (7d)" },
    { value: platform.weatherTried ?? 0, label: "Tried weather" },
    { value: platform.weatherActive ?? 0, label: "Weather active" },
    { value: platform.footballActive ?? 0, label: "Football active" },
  ];

  for (const card of cards) {
    const item = document.createElement("article");
    item.className = "service-stats-card";

    const value = document.createElement("p");
    value.className = "service-stats-card__value";
    value.textContent = String(card.value);

    const label = document.createElement("p");
    label.className = "service-stats-card__label";
    label.textContent = card.label;

    item.append(value, label);
    platformStatsCardsEl.append(item);
  }
}

function renderVisitorTrendChart(dailySeries) {
  renderStatsBarChart(visitorTrendChartEl, dailySeries, {
    emptyText: "No visitor history yet.",
    ariaLabelPrefix: `Visitor trend for the last ${dailySeries?.length || 0} days`,
    scaleFromZero: true,
  });
}

function renderMessageTrendChart(messageDailySeries) {
  renderStatsBarChart(messageTrendChartEl, messageDailySeries, {
    emptyText: "No message history yet.",
    ariaLabelPrefix: `Message trend for the last ${messageDailySeries?.length || 0} days`,
    scaleFromZero: true,
  });
}

function renderVerifiedSitesChart(sites) {
  const series = buildVerifiedSitesSeries(sites);
  renderStatsBarChart(verifiedTrendChartEl, series, {
    emptyText: "No verified websites yet.",
    ariaLabelPrefix: `Verified sites by day over the last ${VERIFIED_CHART_DAYS} days`,
    barClass: "service-stats-chart__bar--growth",
    scaleFromZero: false,
  });
}

function renderSiteHealthTable(container, sites, emptyText) {
  if (!container) return;
  container.replaceChildren();

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "service-stats-mini-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Site", "Visitors", "Last seen"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const site of sites) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.textContent = site.name || site.origin || site.siteKey;

    const visitors = document.createElement("td");
    visitors.textContent = String(site.visitorStats?.weekly ?? 0);

    const lastSeen = document.createElement("td");
    lastSeen.textContent = site.lastSeenAt ? formatTime(site.lastSeenAt) : "Never";

    row.append(name, visitors, lastSeen);
    body.append(row);
  }

  table.append(head, body);
  container.append(table);
}

function renderSiteHealthLists(sites) {
  const verified = sites.filter((site) => site.verifiedAt && !site.disabled);

  const topSites = [...verified]
    .sort((left, right) => {
      const weeklyOrder = (right.visitorStats?.weekly ?? 0) - (left.visitorStats?.weekly ?? 0);
      if (weeklyOrder !== 0) return weeklyOrder;
      return (right.messageCount ?? 0) - (left.messageCount ?? 0);
    })
    .filter((site) => (site.visitorStats?.weekly ?? 0) > 0)
    .slice(0, 10);

  const dormantSites = [...verified]
    .filter((site) => (site.visitorStats?.weekly ?? 0) === 0)
    .sort((left, right) => (left.lastSeenAt || 0) - (right.lastSeenAt || 0))
    .slice(0, 10);

  renderSiteHealthTable(topSitesListEl, topSites, "No active sites this week yet.");
  renderSiteHealthTable(dormantSitesListEl, dormantSites, "All verified sites had visitors this week.");
}

// Owners who opened their site's /admin dashboard, most recent first. Counts are
// distinct dashboard sessions (the server collapses its own polling into one).
function renderOwnerActivityList(sites) {
  if (!ownerActivityListEl) return;
  ownerActivityListEl.replaceChildren();

  const visited = sites
    .filter((site) => (site.adminAccessLastAt ?? 0) > 0)
    .sort((left, right) => (right.adminAccessLastAt ?? 0) - (left.adminAccessLastAt ?? 0))
    .slice(0, 15);

  if (visited.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No owner dashboard visits recorded yet.";
    ownerActivityListEl.append(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "service-stats-mini-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Site", "Visits", "Last in admin"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const site of visited) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.textContent = site.name || site.origin || site.siteKey;

    const visits = document.createElement("td");
    visits.textContent = String(site.adminAccessCount ?? 0);

    const lastAt = document.createElement("td");
    lastAt.textContent = formatTime(site.adminAccessLastAt);

    row.append(name, visits, lastAt);
    body.append(row);
  }

  table.append(head, body);
  ownerActivityListEl.append(table);
}

function renderStatistics(sites, platform = null) {
  const stats = buildPlatformStats(sites, platform);
  renderPlatformStats(stats);
  renderVisitorTrendChart(stats.dailySeries);
  renderMessageTrendChart(stats.messageDailySeries);
  renderVerifiedSitesChart(sites);
  renderSiteHealthLists(sites);
  renderOwnerActivityList(sites);
}

function renderSites(sites, platform = null) {
  allSites = sites;
  allSiteTrafficButton.disabled = sites.length === 0;
  renderSitesTable();
  renderStatistics(sites, platform);
  renderTrafficFlows(sites);
  const nextMapTownSnapshot = JSON.stringify(sites.map((site) => ({
    siteKey: site.siteKey,
    name: site.name,
    verifiedAt: site.verifiedAt,
    disabled: site.disabled,
    messageCount: site.messageCount,
    supporter: site.supporter,
  })));
  if (draftMapWorld && !mapGesture && nextMapTownSnapshot !== mapTownSnapshot) renderMapEditor();
  mapTownSnapshot = nextMapTownSnapshot;
}

function showLogin(message = "", isError = false) {
  autoRefresh.stop();
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, isError);
  loginPasswordEl.focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  autoRefresh.start();
}

async function loadSites({ silent = false } = {}) {
  if (!password) {
    showLogin();
    return;
  }

  if (!silent) {
    setStatus("Loading websites...");
  }
  const result = await api("/api/service-admin/sites");
  if (!result.ok) {
    if (result.status === 403) {
      credentialStore.clear();
      password = "";
      showLogin(result.body.error || "Could not open service admin.", true);
      return;
    }
    setStatus(result.body.error || "Could not load registered websites.", true);
    return;
  }

  credentialStore.save(password, rememberMe);
  showAdmin();
  if (!silent) {
    tokenResult.hidden = true;
  }
  renderSites(result.body.sites, result.body.platform);
  void loadMapEditor();
  if (!silent) {
    const sites = result.body.sites;
    const verifiedCount = sites.filter((site) => site.verifiedAt).length;
    setStatus(
      `${sites.length} registered website${sites.length === 1 ? "" : "s"}, ${verifiedCount} verified.`,
    );
  }
}

async function action(name, siteKey, data = {}) {
  const result = await api("/api/service-admin/action", { action: name, siteKey, ...data });
  if (!result.ok) {
    setStatus(result.body.error || "Action failed.", true);
    return null;
  }

  await loadSites();
  return result.body;
}

async function resetAdminToken(siteKey) {
  const body = await action("resetAdminToken", siteKey);
  if (!body) return;

  newAdminTokenEl.value = body.adminToken;
  newAdminLink.href = body.adminUrl;
  tokenResult.hidden = false;
  setStatus("Admin token reset. Save the new token now.");
}

async function deleteSite(site) {
  if (!window.confirm(`Delete ${site.name}?\n\nThis removes the site registration and disconnects active visitors.`)) {
    return;
  }

  tokenResult.hidden = true;
  const body = await action("deleteSite", site.siteKey);
  if (body) {
    setStatus("Website deleted.");
  }
}

siteFilterEl.addEventListener("input", () => {
  filterQuery = siteFilterEl.value;
  renderSitesTableBody();
});

siteVerifiedFilterEl.addEventListener("change", () => {
  verifiedOnly = siteVerifiedFilterEl.checked;
  saveTablePrefs();
  renderSitesTableBody();
});

allSiteTrafficButton.addEventListener("click", () => void showAllVisitorTraffic());

for (const button of mapToolButtons) {
  button.addEventListener("click", () => {
    mapTool = button.dataset.mapTool;
    mapEditorMessage = "";
    updateMapEditorControls();
  });
}

mapBrushSizeEl.addEventListener("input", () => {
  mapBrushSize = Number(mapBrushSizeEl.value);
  mapBrushSizeValueEl.value = String(mapBrushSize);
});

mapDensityEl.addEventListener("input", () => {
  mapTreeDensity = Number(mapDensityEl.value);
  mapDensityValueEl.value = String(mapTreeDensity);
});

mapEditorCanvasEl.addEventListener("pointerdown", (event) => {
  if (!draftMapWorld || mapEditorSaving || event.button !== 0) return;
  event.preventDefault();
  mapEditorCanvasEl.setPointerCapture(event.pointerId);
  mapGesture = {
    pointerId: event.pointerId,
    before: cloneMapWorld(draftMapWorld),
    beforeDirty: mapEditorDirty,
    changed: false,
    lastPoint: null,
    waterPath: null,
    treeGrid: null,
    waterPointCount: countWaterPoints(),
  };
  updateMapEditorControls();
  applyMapGesture(event);
});

mapEditorCanvasEl.addEventListener("pointermove", (event) => {
  if (mapGesture?.pointerId === event.pointerId) applyMapGesture(event);
});
mapEditorCanvasEl.addEventListener("pointerup", finishMapGesture);
mapEditorCanvasEl.addEventListener("pointercancel", finishMapGesture);

mapUndoButton.addEventListener("click", undoMapEdit);
mapRedoButton.addEventListener("click", redoMapEdit);
mapDiscardButton.addEventListener("click", () => {
  if (!savedMapWorld || !window.confirm("Discard all unsaved map changes?")) return;
  draftMapWorld = cloneMapWorld(savedMapWorld);
  mapEditorDirty = false;
  mapUndoStack = [];
  mapRedoStack = [];
  mapEditorMessage = "Changes discarded.";
  renderMapEditor();
});
mapSaveButton.addEventListener("click", () => void saveMapEditor());

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || !draftMapWorld) return;
  event.preventDefault();
  if (event.shiftKey) redoMapEdit();
  else undoMapEdit();
});

window.addEventListener("beforeunload", (event) => {
  if (!mapIsDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest(".service-row-menu")) return;
  closeRowMenus();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginSubmitButton.disabled = true;
  setLoginStatus("Checking password...");

  password = loginPasswordEl.value.trim();
  rememberMe = rememberMeEl.checked;
  await loadSites();
  if (!adminView.hidden) void notifications.load();

  loginSubmitButton.disabled = false;
  if (!adminView.hidden) {
    loginForm.reset();
    setLoginStatus("");
  }
});

signOutButton.addEventListener("click", () => {
  if (mapIsDirty() && !window.confirm("Sign out and discard unsaved map changes?")) return;
  password = "";
  credentialStore.clear();
  savedMapWorld = null;
  draftMapWorld = null;
  mapEditorDirty = false;
  if (mapEditorRenderFrame !== null) cancelAnimationFrame(mapEditorRenderFrame);
  mapEditorRenderFrame = null;
  mapEditorCanvasEl.hidden = true;
  if (trafficDialogEl.open) trafficDialogEl.close();
  showLogin("Signed out. The service admin password was forgotten on this device.");
});

trafficDialogCloseButton.addEventListener("click", () => trafficDialogEl.close());
trafficDialogEl.addEventListener("click", (event) => {
  if (event.target === trafficDialogEl) trafficDialogEl.close();
});
trafficDialogEl.addEventListener("close", hideTrafficTooltip);

bindCopy(copyTokenButton, { text: () => newAdminTokenEl.value, source: newAdminTokenEl });

rememberMeEl.checked = rememberMe;

if (password) {
  loadSites();
  void notifications.load();
} else {
  showLogin();
}
