import { bindCopy } from "../lib/ui-common.mjs";
import {
  createAutoRefresh,
  createStatusSetter,
  escapeHtml,
  formatTime,
  postJson,
  renderKeyValueList,
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
} from "../shared/site-config.mjs";
import { mountTownSquare } from "../townsquare.mjs";

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
let previewHandle = null;
let customizationBusy = false;
let customizationSavedMessage = "";

const setLoginStatus = createStatusSetter(loginStatusEl, { toggleHidden: true });
const setStatus = createStatusSetter(statusEl);
const setCustomizationStatus = createStatusSetter(customizationStatusEl, { toggleHidden: true });
const autoRefresh = createAutoRefresh(() => loadSite({ silent: true }), REFRESH_INTERVAL_MS);

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
  autoRefresh.stop();
  destroyPreview();
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, isError);
  loginTokenEl.focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  autoRefresh.start();
}

function renderSceneSummary(sceneConfig = {}) {
  renderKeyValueList(sceneSummaryEl, getSceneSummaryEntries(sceneConfig));
}

function syncScenePositionInputs(sceneConfig = readSceneConfigFromForm(customizationForm)) {
  const next = sanitizeSceneConfig(sceneConfig);
  renderScenePositionFields(scenePositionFields, next);
  applyConfigToForm(customizationForm, next);
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
    setCustomizationStatus("Saving customization...");
    return;
  }

  if (customizationSavedMessage) {
    setCustomizationStatus(customizationSavedMessage);
    return;
  }

  if (customizationIsDirty()) {
    setCustomizationStatus("Previewing unsaved changes. Save to regenerate the embed snippet and CSS.");
    return;
  }

  setCustomizationStatus("");
}

function mountPreview() {
  if (!(previewRoot instanceof HTMLElement)) return;
  const customization = currentSite ? readCustomizationFromForm() : getCurrentCustomization();
  destroyPreview();
  previewHandle = mountTownSquare(previewRoot, {
    serverOrigin: window.location.origin,
    scene: customization.sceneConfig,
    style: customization.styleConfig,
    solo: true,
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

  metaEl.innerHTML = `
    <dl>
      <div><dt>Site</dt><dd>${escapeHtml(currentSite.name)}</dd></div>
      <div><dt>Origin</dt><dd>${escapeHtml(currentSite.origin)}</dd></div>
      <div><dt>Status</dt><dd>${currentSite.disabled ? "Disabled" : "Enabled"}</dd></div>
      <div><dt>Verified</dt><dd>${formatTime(currentSite.verifiedAt, "Not seen yet")}</dd></div>
      <div><dt>Active visitors</dt><dd>${scene.activeVisitors}</dd></div>
      <div><dt>Blocked</dt><dd>${currentSite.blockedCount}</dd></div>
    </dl>
  `;

  if (document.activeElement !== snippetEl) {
    snippetEl.value = data.embedSnippet;
  }
  if (document.activeElement !== styleSnippetEl) {
    styleSnippetEl.value = data.styleSnippet;
  }
  renderSceneSummary(currentSite.sceneConfig);
  chatDisabledInput.checked = currentSite.chatDisabled;
  disableSiteButton.textContent = currentSite.disabled ? "Enable site" : "Disable site";
  syncCustomizationForm();

  visitorList.replaceChildren();
  if (scene.visitors.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No active visitors right now.";
    visitorList.appendChild(empty);
  }

  for (const visitor of scene.visitors) {
    const row = document.createElement("article");
    row.className = "visitor-row";
    const visitorName = String(visitor.displayName || "").trim();
    const visitorLabel = visitorName || `Visitor ${visitor.id}`;
    const ownerTag = visitor.isOwner ? " 👑 owner" : "";
    const visitorMeta = visitorName ? `Visitor ${visitor.id} · ` : "";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(visitorLabel)}${ownerTag}</strong>
        <span>${escapeHtml(visitorMeta)}${visitor.clientCount} tab${visitor.clientCount === 1 ? "" : "s"} connected</span>
      </div>
    `;

    const owner = document.createElement("button");
    owner.type = "button";
    owner.textContent = visitor.isOwner ? "Owner ✓" : "Make owner";
    owner.addEventListener("click", () => action("setOwnerVisitor", { visitorId: visitor.id, owner: !visitor.isOwner }));

    const kick = document.createElement("button");
    kick.type = "button";
    kick.textContent = "Kick";
    kick.addEventListener("click", () => action("kickVisitor", { visitorId: visitor.id }));

    const block = document.createElement("button");
    block.type = "button";
    block.textContent = "Block";
    block.addEventListener("click", () => action("blockVisitor", { visitorId: visitor.id }));

    row.append(owner, kick, block);
    visitorList.appendChild(row);
  }

  if (currentSite.disabled) {
    setStatus("Site is disabled. Visitors cannot connect.", true);
  } else if (currentSite.verifiedAt) {
    setStatus("Installed and active. Updates automatically.");
  } else {
    setStatus("Waiting for the snippet to load from your site. Updates automatically.");
  }
}

async function loadSite({ silent = false } = {}) {
  if (!adminToken) {
    showLogin();
    return;
  }

  if (!siteKey) {
    const login = await postJson("/api/admin/login", { adminToken });
    if (!login.ok) {
      clearCredentials();
      showLogin(login.body.error || "Could not open admin with that token.", true);
      return;
    }
    siteKey = login.body.site.siteKey;
  }

  const result = await postJson("/api/admin/site", { siteKey, adminToken });
  if (!result.ok) {
    if (result.status === 403) {
      clearCredentials();
      showLogin("That admin token no longer works.", true);
      return;
    }
    if (!silent) {
      setStatus(result.body.error || "Could not load this site.", true);
    }
    return;
  }

  storeCredentials();
  showAdmin();
  render(result.body);
}

async function action(name, data = {}) {
  const result = await postJson("/api/admin/action", { siteKey, adminToken, action: name, ...data });
  if (!result.ok) {
    setStatus(result.body.error || "Action failed.", true);
    return false;
  }

  await loadSite();
  return true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginSubmitButton.disabled = true;
  setLoginStatus("Checking token...");

  adminToken = loginTokenEl.value.trim();
  siteKey = "";
  await loadSite();

  loginSubmitButton.disabled = false;
  if (!adminView.hidden) {
    loginForm.reset();
    setLoginStatus("");
  }
});

signOutButton.addEventListener("click", () => {
  clearCredentials();
  showLogin("Signed out. Your token was forgotten on this device.");
});

bindCopy(copyButton, { text: () => snippetEl.value, source: snippetEl });
bindCopy(copyStyleButton, { text: () => styleSnippetEl.value, source: styleSnippetEl });

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
