import {
  bindCopy,
  renderDefinitionList,
  renderKeyValueList,
  setStatus,
  setValueIfIdle,
} from "./hosted-common.mjs";
import {
  applyConfigToForm,
  bindSceneCountProse,
  bindStyleColorFields,
  getSceneSummaryEntries,
  isSceneCountInputName,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  renderScenePositionFields,
  sanitizeSceneConfig,
  sanitizeSiteStyle,
} from "./site-config.mjs";
import { mountTownSquare } from "./townsquare.mjs";

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginTokenEl = document.getElementById("login-token");
const loginSubmitButton = document.getElementById("login-submit");
const loginStatusEl = document.getElementById("login-status");
const signOutButton = document.getElementById("sign-out");
const statusEl = document.getElementById("admin-status");
const metaEl = document.getElementById("site-meta");
const customizationForm = document.getElementById("customization-form");
const customizationStatusEl = document.getElementById("customization-status");
const saveCustomizationButton = document.getElementById("save-customization");
const resetCustomizationButton = document.getElementById("reset-customization");
const previewRoot = document.getElementById("townsquare-root");
const scenePositionFields = document.getElementById("scene-position-fields");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const sceneSummaryEl = document.getElementById("scene-summary");
const copyButton = document.getElementById("copy-snippet");
const copyStyleButton = document.getElementById("copy-style");
const chatDisabledInput = document.getElementById("chat-disabled");
const clearMessagesButton = document.getElementById("clear-messages");
const disableSiteButton = document.getElementById("disable-site");
const visitorList = document.getElementById("visitor-list");

bindStyleColorFields(customizationForm);
bindSceneCountProse(customizationForm);

const STORAGE_KEY = "townsquare-admin-session";
const REFRESH_INTERVAL_MS = 5000;

let currentSite = null;
let siteKey = "";
let adminToken = "";
let refreshTimer = null;
let previewHandle = null;
let customizationBusy = false;
let customizationSavedMessage = "";

function readStoredCredentials() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (stored && typeof stored.adminToken === "string") {
      return { siteKey: stored.siteKey || "", adminToken: stored.adminToken };
    }
  } catch {
    // fall through to empty credentials
  }
  return { siteKey: "", adminToken: "" };
}

function readCredentials() {
  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const urlSiteKey = queryParams.get("siteKey") || hashParams.get("siteKey") || "";
  const urlAdminToken = hashParams.get("adminToken") || queryParams.get("adminToken") || "";

  if (urlSiteKey || urlAdminToken) {
    window.history.replaceState({}, document.title, "/admin");
    return { siteKey: urlSiteKey, adminToken: urlAdminToken };
  }

  return readStoredCredentials();
}

function storeCredentials() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ siteKey, adminToken }));
}

function destroyPreview() {
  previewHandle?.destroy();
  previewHandle = null;
}

function clearCredentials() {
  siteKey = "";
  adminToken = "";
  currentSite = null;
  customizationSavedMessage = "";
  destroyPreview();
  sessionStorage.removeItem(STORAGE_KEY);
}

function showLogin(message = "", isError = false) {
  stopAutoRefresh();
  destroyPreview();
  adminView.hidden = true;
  loginView.hidden = false;
  setStatus(loginStatusEl, message, isError, { hideWhenEmpty: true });
  loginTokenEl.focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  startAutoRefresh();
}

function startAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (!document.hidden) {
      loadSite({ silent: true });
    }
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

async function api(path, payload) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: "Could not reach the server." } };
  }
}

function formatTime(value) {
  if (!value) return "Not seen yet";
  return new Date(value).toLocaleString();
}

function renderSceneSummary(sceneConfig = {}) {
  renderKeyValueList(sceneSummaryEl, getSceneSummaryEntries(sceneConfig));
}

function syncScenePositionInputs(sceneConfig = readSceneConfigFromForm(customizationForm)) {
  const next = sanitizeSceneConfig(sceneConfig);
  renderScenePositionFields(scenePositionFields, next);
  applyConfigToForm(customizationForm, next);
}

function renderSiteMeta(site, scene) {
  const entries = [
    { label: "Site", value: site.name },
    { label: "Origin", value: site.origin },
  ];
  if (site.email) entries.push({ label: "Email", value: site.email });
  entries.push(
    { label: "Status", value: site.disabled ? "Disabled" : "Enabled" },
    { label: "Verified", value: formatTime(site.verifiedAt) },
    { label: "Active visitors", value: scene.activeVisitors },
    { label: "Blocked", value: site.blockedCount },
  );
  renderDefinitionList(metaEl, entries);
}

function createVisitorRow(visitor) {
  const row = document.createElement("article");
  row.className = "visitor-row";

  const info = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const visitorName = String(visitor.displayName || "").trim();
  const visitorLabel = visitorName || `Visitor ${visitor.id}`;
  const visitorMeta = visitorName ? `Visitor ${visitor.id} · ` : "";

  title.textContent = visitorLabel;
  meta.textContent = `${visitorMeta}${visitor.clientCount} tab${visitor.clientCount === 1 ? "" : "s"} connected`;
  info.append(title, meta);

  const kick = document.createElement("button");
  kick.type = "button";
  kick.textContent = "Kick";
  kick.addEventListener("click", () => action("kickVisitor", { visitorId: visitor.id }));

  const block = document.createElement("button");
  block.type = "button";
  block.textContent = "Block";
  block.addEventListener("click", () => action("blockVisitor", { visitorId: visitor.id }));

  row.append(info, kick, block);
  return row;
}

function renderVisitors(scene) {
  visitorList.replaceChildren();
  if (scene.visitors.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No active visitors right now.";
    visitorList.appendChild(empty);
    return;
  }

  for (const visitor of scene.visitors) {
    visitorList.appendChild(createVisitorRow(visitor));
  }
}

function getCurrentCustomization() {
  return {
    sceneConfig: sanitizeSceneConfig(currentSite?.sceneConfig || {}),
    styleConfig: sanitizeSiteStyle(currentSite?.styleConfig || {}),
  };
}

function readCustomizationFromForm() {
  return {
    sceneConfig: sanitizeSceneConfig(readSceneConfigFromForm(customizationForm)),
    styleConfig: sanitizeSiteStyle(readStyleConfigFromForm(customizationForm)),
  };
}

function serializeCustomization(customization) {
  return JSON.stringify({
    sceneConfig: sanitizeSceneConfig(customization?.sceneConfig || {}),
    styleConfig: sanitizeSiteStyle(customization?.styleConfig || {}),
  });
}

function customizationIsDirty() {
  if (!currentSite) return false;
  return serializeCustomization(readCustomizationFromForm()) !== serializeCustomization(getCurrentCustomization());
}

function updateCustomizationButtons() {
  const dirty = customizationIsDirty();
  saveCustomizationButton.disabled = customizationBusy || !dirty;
  resetCustomizationButton.disabled = customizationBusy || !dirty;
}

function updateCustomizationStatus() {
  if (customizationBusy) {
    setStatus(customizationStatusEl, "Saving customization...", false, { hideWhenEmpty: true });
    return;
  }

  if (customizationSavedMessage) {
    setStatus(customizationStatusEl, customizationSavedMessage, false, { hideWhenEmpty: true });
    return;
  }

  if (customizationIsDirty()) {
    setStatus(
      customizationStatusEl,
      "Previewing unsaved changes. Save to regenerate the embed snippet and CSS.",
      false,
      { hideWhenEmpty: true },
    );
    return;
  }

  setStatus(customizationStatusEl, "", false, { hideWhenEmpty: true });
}

function mountPreview() {
  if (!(previewRoot instanceof HTMLElement)) return;
  const customization = currentSite ? readCustomizationFromForm() : getCurrentCustomization();
  destroyPreview();
  previewHandle = mountTownSquare(previewRoot, {
    serverOrigin: window.location.origin,
    scene: customization.sceneConfig,
    style: customization.styleConfig,
    readingLabel: currentSite ? `${currentSite.name} preview` : "Admin preview",
    readingUrl: window.location.href,
  });
}

function syncCustomizationForm({ force = false } = {}) {
  if (!currentSite || !(customizationForm instanceof HTMLFormElement)) return;
  if (force || !customizationIsDirty()) {
    const customization = getCurrentCustomization();
    applyConfigToForm(customizationForm, { ...customization.sceneConfig, ...customization.styleConfig });
    syncScenePositionInputs(customization.sceneConfig);
    applyConfigToForm(customizationForm, { ...customization.sceneConfig, ...customization.styleConfig });
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  mountPreview();
}

function render(data) {
  currentSite = data.site;
  const scene = data.scene;

  renderSiteMeta(currentSite, scene);
  setValueIfIdle(snippetEl, data.embedSnippet);
  setValueIfIdle(styleSnippetEl, data.styleSnippet);
  renderSceneSummary(currentSite.sceneConfig);
  renderVisitors(scene);

  chatDisabledInput.checked = currentSite.chatDisabled;
  disableSiteButton.textContent = currentSite.disabled ? "Enable site" : "Disable site";
  syncCustomizationForm();

  if (currentSite.disabled) {
    setStatus(statusEl, "Site is disabled. Visitors cannot connect.", true);
  } else if (currentSite.verifiedAt) {
    setStatus(statusEl, "Installed and active. Updates automatically.");
  } else {
    setStatus(statusEl, "Waiting for the snippet to load from your site. Updates automatically.");
  }
}

async function loadSite({ silent = false } = {}) {
  if (!adminToken) {
    showLogin();
    return;
  }

  if (!siteKey) {
    const login = await api("/api/admin/login", { adminToken });
    if (!login.ok) {
      clearCredentials();
      showLogin(login.body.error || "Could not open admin with that token.", true);
      return;
    }
    siteKey = login.body.site.siteKey;
  }

  const result = await api("/api/admin/site", { siteKey, adminToken });
  if (!result.ok) {
    if (result.status === 403) {
      clearCredentials();
      showLogin("That admin token no longer works.", true);
      return;
    }
    if (!silent) {
      setStatus(statusEl, result.body.error || "Could not load this site.", true);
    }
    return;
  }

  storeCredentials();
  showAdmin();
  render(result.body);
}

async function action(name, data = {}) {
  const result = await api("/api/admin/action", { siteKey, adminToken, action: name, ...data });
  if (!result.ok) {
    setStatus(statusEl, result.body.error || "Action failed.", true);
    return false;
  }

  await loadSite();
  return true;
}

customizationForm.addEventListener("input", (event) => {
  customizationSavedMessage = "";
  if (isSceneCountInputName(event.target?.name || "")) {
    syncScenePositionInputs(readSceneConfigFromForm(customizationForm));
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  mountPreview();
});

customizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  customizationBusy = true;
  customizationSavedMessage = "";
  updateCustomizationButtons();
  updateCustomizationStatus();

  const ok = await action("updateCustomization", readCustomizationFromForm());

  customizationBusy = false;
  if (ok) {
    customizationSavedMessage = "Customization saved. Copy the refreshed snippet and CSS below.";
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
});

resetCustomizationButton.addEventListener("click", () => {
  customizationSavedMessage = "";
  syncCustomizationForm({ force: true });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginSubmitButton.disabled = true;
  setStatus(loginStatusEl, "Checking token...", false, { hideWhenEmpty: true });

  adminToken = loginTokenEl.value.trim();
  siteKey = "";
  await loadSite();

  loginSubmitButton.disabled = false;
  if (!adminView.hidden) {
    loginForm.reset();
    setStatus(loginStatusEl, "", false, { hideWhenEmpty: true });
  }
});

signOutButton.addEventListener("click", () => {
  clearCredentials();
  showLogin("Signed out. Your token was forgotten on this device.");
});

bindCopy(copyButton, () => snippetEl.value, { fallbackTarget: snippetEl });
bindCopy(copyStyleButton, () => styleSnippetEl.value, { fallbackTarget: styleSnippetEl });

chatDisabledInput.addEventListener("change", () => action("setChatDisabled", { disabled: chatDisabledInput.checked }));
clearMessagesButton.addEventListener("click", () => action("clearMessages"));
disableSiteButton.addEventListener("click", () => action("disableSite", { disabled: !currentSite.disabled }));

const credentials = readCredentials();
siteKey = credentials.siteKey;
adminToken = credentials.adminToken;

if (adminToken) {
  loadSite();
} else {
  showLogin();
}
