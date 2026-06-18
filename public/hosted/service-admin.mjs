import { bindCopy } from "../lib/ui-common.mjs";
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

const STORAGE_KEY = "townsquare-service-admin-password";
const REFRESH_INTERVAL_MS = 5000;

const TABLE_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "origin", label: "Origin" },
  { key: "siteKey", label: "Site key", mono: true },
  { key: "email", label: "Email" },
  { key: "disabled", label: "Status", render: (site) => (site.disabled ? "Disabled" : "Enabled") },
  { key: "chatDisabled", label: "Chat", render: (site) => (site.chatDisabled ? "Disabled" : "Enabled") },
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

const setLoginStatus = createStatusSetter(loginStatusEl, { toggleHidden: true });
const setStatus = createStatusSetter(statusEl);
const autoRefresh = createAutoRefresh(() => loadSites({ silent: true }), REFRESH_INTERVAL_MS);

// Every service-admin request carries the operator password.
const api = (path, payload = {}) => postJson(path, { password, ...payload });

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

  panel.append(toggleSite, toggleChat, reset, remove);
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
  } else if (column.key === "disabled" || column.key === "chatDisabled") {
    const badge = document.createElement("span");
    const disabled = column.key === "disabled" ? site.disabled : site.chatDisabled;
    badge.className = `service-status-badge${disabled ? " service-status-badge--off" : ""}`;
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
  password = "";
  credentialStore.clear();
  showLogin("Signed out. The service admin password was forgotten on this device.");
});

bindCopy(copyTokenButton, { text: () => newAdminTokenEl.value, source: newAdminTokenEl });

rememberMeEl.checked = rememberMe;

if (password) {
  loadSites();
} else {
  showLogin();
}
