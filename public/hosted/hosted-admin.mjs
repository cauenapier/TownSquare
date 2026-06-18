import { bindCopy } from "../lib/ui-common.mjs";
import {
  createAutoRefresh,
  createStatusSetter,
  escapeHtml,
  formatTime,
  postJson,
} from "./hosted-common.mjs";
import {
  applyConfigToForm,
  applySceneConfigToForm,
  bindSceneCountProse,
  bindStyleColorFields,
  isSceneCountInputName,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  renderScenePositionFields,
  renderStyleOverrideFields,
  sanitizeSceneConfig,
  sanitizeSiteStyle,
} from "../shared/site-config.mjs";
import { createCustomizationPreview } from "./hosted-preview.mjs";

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
const styleOverrideFields = document.getElementById("style-override-fields");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const copyButton = document.getElementById("copy-snippet");
const copyStyleButton = document.getElementById("copy-style");
const chatDisabledInput = document.getElementById("chat-disabled");
const clearMessagesButton = document.getElementById("clear-messages");
const disableSiteButton = document.getElementById("disable-site");
const visitorList = document.getElementById("visitor-list");

renderStyleOverrideFields(styleOverrideFields);
bindStyleColorFields(customizationForm);
bindSceneCountProse(customizationForm);

const STORAGE_KEY = "townsquare-admin-session";
const REFRESH_INTERVAL_MS = 5000;
const AUTO_SAVE_DELAY_MS = 1500;

let currentSite = null;
let siteKey = "";
let adminToken = "";
let customizationBusy = false;
let customizationSavedMessage = "";
let autoSaveTimer = null;
let customizationTouched = false;

const preview = createCustomizationPreview({
  root: previewRoot,
  readingLabel: () => (currentSite ? `${currentSite.name} preview` : "Admin preview"),
  readConfig: (mode) => {
    const customization = currentSite ? readCustomizationFromForm() : getCurrentCustomization();
    return { scene: customization.sceneConfig, style: customization.styleConfig[mode] };
  },
});

const previewModeButtons = document.querySelectorAll("[data-preview-mode]");
preview.bindThemeToggle(previewModeButtons);

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

function clearCredentials() {
  clearAutoSaveTimer();
  siteKey = "";
  adminToken = "";
  currentSite = null;
  customizationSavedMessage = "";
  customizationTouched = false;
  preview.destroy();
  sessionStorage.removeItem(STORAGE_KEY);
}

function showLogin(message = "", isError = false) {
  autoRefresh.stop();
  preview.destroy();
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

function syncScenePositionInputs(sceneConfig = readSceneConfigFromForm(customizationForm)) {
  const next = sanitizeSceneConfig(sceneConfig);
  renderScenePositionFields(scenePositionFields, next);
  applySceneConfigToForm(customizationForm, next);
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
    setCustomizationStatus("Unsaved changes will save automatically.");
    return;
  }

  setCustomizationStatus("");
}

function clearAutoSaveTimer() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function scheduleAutoSave() {
  clearAutoSaveTimer();
  if (!currentSite || customizationBusy || !customizationIsDirty()) return;

  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void saveCustomization({ auto: true });
  }, AUTO_SAVE_DELAY_MS);
}

async function saveCustomization({ auto = false } = {}) {
  if (!currentSite || customizationBusy || !customizationIsDirty()) return false;

  clearAutoSaveTimer();
  customizationBusy = true;
  if (!auto) customizationSavedMessage = "";
  updateCustomizationButtons();
  updateCustomizationStatus();

  const ok = await action("updateCustomization", readCustomizationFromForm());

  customizationBusy = false;
  if (ok) {
    customizationTouched = false;
    customizationSavedMessage = auto
      ? "Customization saved."
      : "Customization saved. Copy the refreshed snippet and CSS below.";
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  return ok;
}

function syncCustomizationForm({ force = false } = {}) {
  if (!currentSite || !(customizationForm instanceof HTMLFormElement)) return;
  const shouldApply = force || !customizationTouched || !customizationIsDirty();
  if (shouldApply) {
    const customization = getCurrentCustomization();
    applyConfigToForm(customizationForm, { ...customization.sceneConfig, ...customization.styleConfig });
    syncScenePositionInputs(customization.sceneConfig);
    if (force) customizationTouched = false;
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  if (force || !preview.mounted) {
    preview.mount({ remount: force });
  }
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
  customizationTouched = true;
  if (isSceneCountInputName(event.target?.name || "")) {
    syncScenePositionInputs(readSceneConfigFromForm(customizationForm));
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  preview.mount();
  scheduleAutoSave();
});

customizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCustomization();
});

resetCustomizationButton.addEventListener("click", () => {
  clearAutoSaveTimer();
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
