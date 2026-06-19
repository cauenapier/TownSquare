import { bindCopy, createSvgElement } from "../lib/ui-common.mjs";
import { buildMapEdges } from "../map-connections.mjs";
import { layoutMapSites } from "../map-layout.mjs";
import { createCityMarker, renderMapEdge } from "../map-render.mjs";
import { renderSceneryLayer } from "../map-scenery.mjs";
import {
  cloneMapWorld,
  MAP_PROP_TYPES,
  MAX_MAP_PROPS,
  MAX_WATER_POINTS,
  MAX_WATER_STROKES,
  validateMapWorld,
} from "../shared/map-world.mjs";
import {
  createAutoRefresh,
  createCredentialStore,
  createStatusSetter,
  formatTime,
  postJson,
} from "./hosted-common.mjs";

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
const siteFilterMetaEl = document.getElementById("site-filter-meta");
const siteTableWrapEl = document.getElementById("site-table-wrap");
const siteTableHeadEl = document.getElementById("site-table-head");
const siteTableBodyEl = document.getElementById("site-table-body");
const siteEmptyEl = document.getElementById("site-empty");
const siteNoMatchesEl = document.getElementById("site-no-matches");
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

const STORAGE_KEY = "townsquare-service-admin-password";
const REFRESH_INTERVAL_MS = 5000;
const MAX_MAP_HISTORY_ITEMS = 20_000;

const TABLE_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "origin", label: "Origin" },
  { key: "siteKey", label: "Site key", mono: true },
  { key: "email", label: "Email" },
  { key: "disabled", label: "Status", render: (site) => (site.disabled ? "Disabled" : "Enabled") },
  { key: "chatDisabled", label: "Chat", render: (site) => (site.chatDisabled ? "Disabled" : "Enabled") },
  { key: "supporter", label: "Supporter", render: (site) => (site.supporter ? "Yes" : "No") },
  { key: "verifiedAt", label: "Verified", render: (site) => formatTime(site.verifiedAt) },
  { key: "lastSeenAt", label: "Last seen", render: (site) => formatTime(site.lastSeenAt) },
  { key: "messageCount", label: "Messages", render: (site) => String(site.messageCount ?? 0) },
  { key: "lastMessageAt", label: "Last message", render: (site) => formatTime(site.lastMessageAt) },
  { key: "activeVisitors", label: "Active", render: (site) => String(site.activeVisitors ?? 0) },
  { key: "blockedCount", label: "Blocked", render: (site) => String(site.blockedCount ?? 0) },
];

const credentialStore = createCredentialStore(STORAGE_KEY);

const stored = credentialStore.read();
let password = typeof stored?.value === "string" ? stored.value : "";
let rememberMe = stored?.remembered ?? false;

let allSites = [];
let filterQuery = "";
let sortKey = "name";
let sortAsc = true;
let tableHeadReady = false;
let savedMapWorld = null;
let draftMapWorld = null;
let mapEditorSvg = null;
let mapEditorDirty = false;
let mapEditorRenderFrame = null;
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

const setLoginStatus = createStatusSetter(loginStatusEl, { toggleHidden: true });
const setStatus = createStatusSetter(statusEl);
const autoRefresh = createAutoRefresh(() => loadSites({ silent: true }), REFRESH_INTERVAL_MS);

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
  for (const edge of buildMapEdges(visibleSites)) {
    const path = renderMapEdge(edge, positions);
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

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx ** 2 + dy ** 2)));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function strokeTouchesPoint(stroke, point, radius) {
  const hitRadius = radius + stroke.width / 2;
  if (stroke.points.length === 1) {
    return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y) <= hitRadius;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= hitRadius) return true;
  }
  return false;
}

function eraseMapAt(point) {
  const radius = mapBrushSize / 2;
  const propCount = draftMapWorld.props.length;
  const waterCount = draftMapWorld.water.length;
  draftMapWorld.props = draftMapWorld.props.filter(
    (prop) => Math.hypot(prop.x - point.x, prop.y - point.y) > radius,
  );
  draftMapWorld.water = draftMapWorld.water.filter(
    (stroke) => !strokeTouchesPoint(stroke, point, radius),
  );
  return propCount !== draftMapWorld.props.length || waterCount !== draftMapWorld.water.length;
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
  return draftMapWorld.water.reduce((count, stroke) => count + stroke.points.length, 0);
}

function paintWater(point) {
  if (mapGesture.waterPointCount >= MAX_WATER_POINTS) {
    mapEditorMessage = `The map is limited to ${MAX_WATER_POINTS} water points.`;
    updateMapEditorControls();
    return false;
  }
  if (!mapGesture.stroke) {
    if (draftMapWorld.water.length >= MAX_WATER_STROKES) {
      mapEditorMessage = `The map is limited to ${MAX_WATER_STROKES} water strokes.`;
      updateMapEditorControls();
      return false;
    }
    mapGesture.stroke = { type: mapTool, width: mapBrushSize, points: [] };
    draftMapWorld.water.push(mapGesture.stroke);
  }
  const lastPoint = mapGesture.stroke.points[mapGesture.stroke.points.length - 1];
  const spacing = mapTool === "river" ? 14 : Math.max(10, mapBrushSize * 0.16);
  if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < spacing) return false;
  mapGesture.stroke.points.push({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
  mapGesture.waterPointCount += 1;
  return true;
}

function paintMapAt(point) {
  if (mapTool === "erase") {
    return eraseMapAt(point);
  }
  if (mapTool === "tree") return paintTreeDab(point);
  if (mapTool === "mountain") return paintMountain(point);
  return paintWater(point);
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
  if (mapGesture.changed) {
    mapUndoStack.push({ world: mapGesture.before, dirty: mapGesture.beforeDirty });
    trimMapHistory(mapUndoStack);
    mapRedoStack = [];
  }
  mapGesture = null;
  if (mapEditorRenderFrame !== null) flushMapEditorRender();
  else updateMapEditorControls();
}

function mapWorldItemCount(world) {
  return world.props.length + world.water.reduce((count, stroke) => count + stroke.points.length, 0);
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
  mapEditorDirty = false;
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
      return Number(Boolean(site[key]));
    case "verifiedAt":
    case "lastSeenAt":
    case "lastMessageAt":
      return Number(site[key] || 0);
    case "messageCount":
    case "activeVisitors":
    case "blockedCount":
      return Number(site[key] ?? 0);
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
    .filter((site) => siteMatchesFilter(site, query))
    .sort((left, right) => {
      const order = compareSites(left, right, sortKey);
      return sortAsc ? order : -order;
    });
}

function ensureTableHead() {
  if (tableHeadReady) return;

  const row = document.createElement("tr");
  for (const column of TABLE_COLUMNS) {
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
      renderSitesTable();
    });
    header.append(button);
    row.append(header);
  }

  const actionsHeader = document.createElement("th");
  actionsHeader.scope = "col";
  actionsHeader.className = "service-table-actions-head";
  actionsHeader.textContent = "Actions";
  row.append(actionsHeader);

  siteTableHeadEl.replaceChildren(row);
  tableHeadReady = true;
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

  panel.append(toggleSite, toggleChat, toggleSupporter, reset, remove);
  menu.append(panel);

  menu.addEventListener("toggle", () => {
    if (menu.open) closeRowMenus(menu);
  });

  return menu;
}

function renderCell(site, column) {
  const cell = document.createElement("td");
  const value = column.render ? column.render(site) : String(site[column.key] ?? "");

  if (column.mono) {
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
  } else if (column.key === "disabled" || column.key === "chatDisabled" || column.key === "supporter") {
    const badge = document.createElement("span");
    const on = column.key === "supporter" ? site.supporter : !(column.key === "disabled" ? site.disabled : site.chatDisabled);
    badge.className = `service-status-badge${on ? "" : " service-status-badge--off"}`;
    badge.textContent = value;
    cell.append(badge);
  } else {
    cell.textContent = value;
  }

  return cell;
}

function renderSitesTable() {
  ensureTableHead();
  updateSortIndicators();

  const sites = visibleSites();
  const query = filterQuery.trim();
  const filtered = Boolean(query);

  siteEmptyEl.hidden = allSites.length > 0;
  siteNoMatchesEl.hidden = allSites.length === 0 || sites.length > 0;
  siteTableWrapEl.hidden = sites.length === 0;

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

    for (const column of TABLE_COLUMNS) {
      row.append(renderCell(site, column));
    }

    const actionsCell = document.createElement("td");
    actionsCell.className = "service-table-actions-cell";
    actionsCell.append(createActionMenu(site));
    row.append(actionsCell);

    siteTableBodyEl.append(row);
  }
}

function renderSites(sites) {
  allSites = sites;
  renderSitesTable();
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
  renderSites(result.body.sites);
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
  renderSitesTable();
});

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
    stroke: null,
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
  showLogin("Signed out. The service admin password was forgotten on this device.");
});

bindCopy(copyTokenButton, { text: () => newAdminTokenEl.value, source: newAdminTokenEl });

rememberMeEl.checked = rememberMe;

if (password) {
  loadSites();
} else {
  showLogin();
}
