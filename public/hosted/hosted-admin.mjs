import { bindCopy } from "../lib/ui-common.mjs";
import { createStatusSetter, escapeHtml, formatTime } from "./hosted-common.mjs";
import { createAdminSession } from "./hosted-admin-session.mjs";
import {
  applyConfigToForm,
  applySceneConfigToForm,
  bindSceneCountProse,
  bindStyleColorFields,
  CONNECTION_LABEL_MAX,
  CONNECTION_SIDES,
  CONNECTION_URL_MAX,
  DEFAULT_SCENE_CONFIG,
  DEFAULT_SITE_STYLE,
  isSceneCountInputName,
  MAX_CONNECTIONS_PER_SIDE,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  renderScenePositionFields,
  renderStyleOverrideFields,
  sanitizeConnections,
  sanitizeSceneConfig,
  sanitizeSiteStyle,
} from "../shared/site-config.mjs";
import { createCustomizationPreview } from "./hosted-preview.mjs";
import { CHARACTER_COLORS, DEFAULT_OWNER_BADGE_COLOR, DISPLAY_NAME_MAX, OWNER_BADGE_COLORS } from "../shared/shared-constants.mjs";

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginTokenEl = document.getElementById("login-token");
const rememberMeEl = document.getElementById("login-remember");
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
const connectionsList = document.getElementById("connections-list");
const addConnectionButton = document.getElementById("add-connection");
const saveConnectionsButton = document.getElementById("save-connections");
const connectionsStatusEl = document.getElementById("connections-status");
const chatDisabledInput = document.getElementById("chat-disabled");
const clearMessagesButton = document.getElementById("clear-messages");
const disableSiteButton = document.getElementById("disable-site");
const visitorList = document.getElementById("visitor-list");
const ownerList = document.getElementById("owner-list");

renderStyleOverrideFields(styleOverrideFields);
bindStyleColorFields(customizationForm);
bindSceneCountProse(customizationForm);

const AUTO_SAVE_DELAY_MS = 1500;

let currentSite = null;
let customizationBusy = false;
let customizationSavedMessage = "";
let autoSaveTimer = null;
let customizationTouched = false;

/** Working copy of the connections editor; `touched` guards it from polls. */
let connectionsDraft = [];
let connectionsTouched = false;

/**
 * In-progress owner name/colour edit, kept across the 5s poll re-render so a
 * background refresh never clobbers what the admin is typing. Keyed by the
 * owner's opaque handle; `focusName` restores the caret after a rebuild.
 */
let ownerDraft = null;
let connectionsBusy = false;
let connectionsSavedMessage = "";

const preview = createCustomizationPreview({
  root: previewRoot,
  readingLabel: () => (currentSite ? `${currentSite.name} preview` : "Admin preview"),
  readConfig: (mode) => {
    const customization = currentSite ? readCustomizationFromForm() : getCurrentCustomization();
    return {
      scene: customization.sceneConfig,
      style: customization.styleConfig[mode],
      connections: sanitizeConnections(connectionsDraft),
    };
  },
});

const previewModeButtons = document.querySelectorAll("[data-preview-mode]");
preview.bindThemeToggle(previewModeButtons);

const setStatus = createStatusSetter(statusEl);
const setCustomizationStatus = createStatusSetter(customizationStatusEl, { toggleHidden: true });
const setConnectionsStatus = createStatusSetter(connectionsStatusEl, { toggleHidden: true });

const session = createAdminSession({
  redirectPath: "/admin",
  elements: {
    loginView,
    adminView,
    loginForm,
    loginToken: loginTokenEl,
    rememberMe: rememberMeEl,
    loginSubmit: loginSubmitButton,
    loginStatus: loginStatusEl,
    signOut: signOutButton,
  },
  onRender: render,
  onError: (message) => setStatus(message, true),
  onBeforeShowLogin: () => preview.destroy(),
  onClear: () => {
    clearAutoSaveTimer();
    currentSite = null;
    customizationSavedMessage = "";
    customizationTouched = false;
    connectionsDraft = [];
    connectionsTouched = false;
    connectionsSavedMessage = "";
    preview.destroy();
  },
});

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

function getDefaultCustomization() {
  return {
    sceneConfig: sanitizeSceneConfig(DEFAULT_SCENE_CONFIG),
    styleConfig: sanitizeSiteStyle(DEFAULT_SITE_STYLE),
  };
}

function applyCustomizationToForm(customization) {
  applyConfigToForm(customizationForm, { ...customization.sceneConfig, ...customization.styleConfig });
  syncScenePositionInputs(customization.sceneConfig);
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

function customizationDiffersFromDefaults() {
  return serializeCustomization(readCustomizationFromForm()) !== serializeCustomization(getDefaultCustomization());
}

function updateCustomizationButtons() {
  const dirty = customizationIsDirty();
  saveCustomizationButton.disabled = customizationBusy || !dirty;
  resetCustomizationButton.disabled = customizationBusy || !customizationDiffersFromDefaults();
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

  const ok = await session.action("updateCustomization", readCustomizationFromForm());

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
    applyCustomizationToForm(getCurrentCustomization());
    if (force) customizationTouched = false;
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  if (force || !preview.mounted) {
    preview.mount({ remount: force });
  }
}

function getServerConnections() {
  return sanitizeConnections(currentSite?.connections || []);
}

function connectionsAreDirty() {
  if (!currentSite) return false;
  return JSON.stringify(sanitizeConnections(connectionsDraft)) !== JSON.stringify(getServerConnections());
}

function updateConnectionsControls() {
  const total = connectionsDraft.length;
  addConnectionButton.disabled = connectionsBusy || total >= MAX_CONNECTIONS_PER_SIDE * 2;
  saveConnectionsButton.disabled = connectionsBusy || !connectionsAreDirty();

  if (connectionsBusy) {
    setConnectionsStatus("Saving connections...");
  } else if (connectionsSavedMessage) {
    setConnectionsStatus(connectionsSavedMessage);
  } else if (connectionsAreDirty()) {
    setConnectionsStatus("Unsaved connection changes.");
  } else {
    setConnectionsStatus("");
  }
}

function onConnectionsEdited() {
  connectionsSavedMessage = "";
  connectionsTouched = true;
  updateConnectionsControls();
  // Reflect signposts in the live preview as the owner edits.
  preview.mount();
}

function createConnectionRow(connection, index) {
  const row = document.createElement("div");
  row.className = "hosted-connection-row";

  const side = document.createElement("select");
  side.className = "hosted-connection-side";
  side.setAttribute("aria-label", "Edge");
  for (const value of CONNECTION_SIDES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "left" ? "Left" : "Right";
    side.appendChild(option);
  }
  side.value = connection.side;
  side.addEventListener("change", () => {
    connectionsDraft[index].side = side.value;
    onConnectionsEdited();
  });

  const label = document.createElement("input");
  label.type = "text";
  label.className = "hosted-connection-label";
  label.placeholder = "Town name";
  label.maxLength = CONNECTION_LABEL_MAX;
  label.value = connection.label;
  label.setAttribute("aria-label", "Town name");
  label.addEventListener("input", () => {
    connectionsDraft[index].label = label.value;
    onConnectionsEdited();
  });

  const url = document.createElement("input");
  url.type = "url";
  url.className = "hosted-connection-url";
  url.placeholder = "https://neighbour.example.com";
  url.maxLength = CONNECTION_URL_MAX;
  url.value = connection.url;
  url.setAttribute("aria-label", "Town address");
  url.addEventListener("input", () => {
    connectionsDraft[index].url = url.value;
    onConnectionsEdited();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "hosted-connection-remove";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", "Remove this town");
  remove.addEventListener("click", () => {
    connectionsDraft.splice(index, 1);
    renderConnectionRows();
    onConnectionsEdited();
  });

  row.append(side, label, url, remove);
  return row;
}

function renderConnectionRows() {
  connectionsList.replaceChildren();

  if (connectionsDraft.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No connected towns yet. Add one to grow a signpost at the edge.";
    connectionsList.appendChild(empty);
    return;
  }

  connectionsDraft.forEach((connection, index) => {
    connectionsList.appendChild(createConnectionRow(connection, index));
  });
}

function syncConnectionsFromServer() {
  // A poll-driven re-render must not clobber edits in progress.
  if (connectionsTouched && connectionsAreDirty()) {
    updateConnectionsControls();
    return;
  }
  connectionsDraft = getServerConnections().map((connection) => ({ ...connection }));
  connectionsTouched = false;
  renderConnectionRows();
  updateConnectionsControls();
  if (preview.mounted) preview.mount();
}

function addConnection() {
  if (connectionsDraft.length >= MAX_CONNECTIONS_PER_SIDE * 2) return;
  connectionsDraft.push({ side: "right", label: "", url: "" });
  renderConnectionRows();
  onConnectionsEdited();
  connectionsList.querySelector(".hosted-connection-row:last-child .hosted-connection-url")?.focus();
}

async function saveConnections() {
  if (!currentSite || connectionsBusy || !connectionsAreDirty()) return;

  connectionsBusy = true;
  connectionsSavedMessage = "";
  updateConnectionsControls();

  const ok = await session.action("updateConnections", { connections: sanitizeConnections(connectionsDraft) });

  connectionsBusy = false;
  if (ok) {
    connectionsTouched = false;
    connectionsSavedMessage = "Connections saved. Copy the refreshed snippet above.";
  }
  // render() runs after a successful action and resyncs the draft from server.
  updateConnectionsControls();
}

// One card in the dedicated "Site owner" section: a persistent name + colour
// editor saved to the owner's claim, so it survives resets whether or not the
// owner is currently connected.
function buildOwnerRow(owner, index) {
  const draft = ownerDraft && ownerDraft.handle === owner.handle ? ownerDraft : null;
  const row = document.createElement("article");
  row.className = "owner-row";

  const savedName = String(owner.displayName || "").trim();
  const head = document.createElement("div");
  head.className = "owner-row__head";
  head.innerHTML = `
    <strong>${escapeHtml(savedName || `Owner ${index + 1}`)} 👑</strong>
    <span>${owner.online ? "online now" : "offline"}</span>
  `;

  const editor = document.createElement("form");
  editor.className = "owner-editor";

  const nameField = document.createElement("input");
  nameField.type = "text";
  nameField.className = "owner-editor__name";
  nameField.maxLength = DISPLAY_NAME_MAX;
  nameField.placeholder = `Owner ${index + 1}`;
  nameField.value = draft ? draft.displayName : savedName;
  nameField.setAttribute("aria-label", "Owner display name");

  const swatches = document.createElement("div");
  swatches.className = "owner-editor__swatches";
  let selectedColor = draft ? draft.color : (owner.color || CHARACTER_COLORS[0]);
  const swatchButtons = [];

  const badgeLabel = document.createElement("span");
  badgeLabel.className = "owner-editor__swatch-label";
  badgeLabel.textContent = "Badge";

  const badgeSwatches = document.createElement("div");
  badgeSwatches.className = "owner-editor__swatches";
  let selectedBadgeColor = draft ? draft.badgeColor : (owner.badgeColor || DEFAULT_OWNER_BADGE_COLOR);
  const badgeSwatchButtons = [];

  const noteDraft = (focusName) => {
    ownerDraft = {
      handle: owner.handle,
      displayName: nameField.value,
      color: selectedColor,
      badgeColor: selectedBadgeColor,
      focusName,
    };
  };

  for (const color of CHARACTER_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "owner-editor__swatch";
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute("aria-label", `Use colour ${color}`);
    swatch.setAttribute("aria-pressed", String(color === selectedColor));
    swatch.addEventListener("click", () => {
      selectedColor = color;
      for (const button of swatchButtons) {
        button.setAttribute("aria-pressed", String(button === swatch));
      }
      noteDraft(false);
    });
    swatchButtons.push(swatch);
    swatches.appendChild(swatch);
  }

  for (const color of OWNER_BADGE_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "owner-editor__swatch owner-editor__swatch--badge";
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute("aria-label", `Use badge colour ${color}`);
    swatch.setAttribute("aria-pressed", String(color === selectedBadgeColor));
    swatch.addEventListener("click", () => {
      selectedBadgeColor = color;
      for (const button of badgeSwatchButtons) {
        button.setAttribute("aria-pressed", String(button === swatch));
      }
      noteDraft(false);
    });
    badgeSwatchButtons.push(swatch);
    badgeSwatches.appendChild(swatch);
  }

  nameField.addEventListener("input", () => noteDraft(true));

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "owner-editor__save";
  save.textContent = "Save";

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    ownerDraft = null;
    session.action("updateOwnerProfile", {
      handle: owner.handle,
      displayName: nameField.value,
      color: selectedColor,
      badgeColor: selectedBadgeColor,
    });
  });

  editor.append(nameField, swatches, badgeLabel, badgeSwatches, save);
  row.append(head, editor);
  if (draft && draft.focusName) {
    // Restore the caret after a poll-driven rebuild swapped the input out.
    requestAnimationFrame(() => {
      nameField.focus();
      nameField.setSelectionRange(nameField.value.length, nameField.value.length);
    });
  }
  return row;
}

function renderOwners(owners) {
  ownerList.replaceChildren();
  if (owners.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No owners yet. Crown a visitor under Moderation to add one.";
    ownerList.appendChild(empty);
    return;
  }
  owners.forEach((owner, index) => ownerList.appendChild(buildOwnerRow(owner, index)));
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
      <div><dt>Messages</dt><dd>${currentSite.messageCount ?? 0}</dd></div>
      <div><dt>Last message</dt><dd>${formatTime(currentSite.lastMessageAt)}</dd></div>
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
  syncConnectionsFromServer();

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
    owner.addEventListener("click", () => session.action("setOwnerVisitor", { visitorId: visitor.id, owner: !visitor.isOwner }));

    const kick = document.createElement("button");
    kick.type = "button";
    kick.textContent = "Kick";
    kick.addEventListener("click", () => session.action("kickVisitor", { visitorId: visitor.id }));

    const block = document.createElement("button");
    block.type = "button";
    block.textContent = "Block";
    block.addEventListener("click", () => session.action("blockVisitor", { visitorId: visitor.id }));

    row.append(owner, kick, block);
    visitorList.appendChild(row);
  }

  renderOwners(data.owners || []);

  if (currentSite.disabled) {
    setStatus("Site is disabled. Visitors cannot connect.", true);
  } else if (currentSite.verifiedAt) {
    setStatus("Installed and active. Updates automatically.");
  } else {
    setStatus("Waiting for the snippet to load from your site. Updates automatically.");
  }
}

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
  customizationTouched = false;
  applyCustomizationToForm(getDefaultCustomization());
  updateCustomizationButtons();
  updateCustomizationStatus();
  preview.mount({ remount: true });
  scheduleAutoSave();
});

addConnectionButton.addEventListener("click", addConnection);
saveConnectionsButton.addEventListener("click", () => { void saveConnections(); });

chatDisabledInput.addEventListener("change", () => session.action("setChatDisabled", { disabled: chatDisabledInput.checked }));
clearMessagesButton.addEventListener("click", () => session.action("clearMessages"));
disableSiteButton.addEventListener("click", () => session.action("disableSite", { disabled: !currentSite.disabled }));

session.start();
