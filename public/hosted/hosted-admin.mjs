import { bindCopy } from "../lib/ui-common.mjs";
import { createStatusSetter, el, formatTime, safeLink } from "./hosted-common.mjs";
import { createAdminSession } from "./hosted-admin-session.mjs";
import { createAdminPluginRuntime } from "./admin-plugins.mjs";
import {
  applyConfigToForm,
  applySceneConfigToForm,
  bindSceneCountProse,
  bindStyleColorFields,
  CONNECTION_LABEL_MAX,
  CONNECTION_SIDES,
  CONNECTION_URL_MAX,
  DEFAULT_MESSAGE_BOARD,
  DEFAULT_SCENE_CONFIG,
  DEFAULT_SITE_STYLE,
  isSceneCountInputName,
  MAX_CONNECTIONS_PER_SIDE,
  MESSAGE_BOARD_VARIANTS,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  renderScenePositionFields,
  renderStyleOverrideFields,
  sanitizeConnections,
  sanitizeMessageBoard,
  sanitizeSceneConfig,
  sanitizeSiteStyle,
} from "../shared/site-config.mjs";
import { getMatchingWwwOrigin } from "../shared/url.mjs";
import { mountTownSquareCounter, COUNTER_VARIANTS } from "../townsquare-counter.mjs";
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
const siteDetailsForm = document.getElementById("site-details-form");
const siteOriginInput = document.getElementById("site-origin");
const siteNameInput = document.getElementById("site-name");
const siteEmailInput = document.getElementById("site-email");
const connectionLimitInput = document.getElementById("connection-limit");
const includeMatchingWwwInput = document.getElementById("include-matching-www");
const includeMatchingWwwLabel = document.getElementById("include-matching-www-label");
const includeMatchingWwwNote = document.getElementById("include-matching-www-note");
const saveSiteDetailsButton = document.getElementById("save-site-details");
const siteDetailsStatusEl = document.getElementById("site-details-status");
const customizationForm = document.getElementById("customization-form");
const customizationStatusEl = document.getElementById("customization-status");
const saveCustomizationButton = document.getElementById("save-customization");
const resetCustomizationButton = document.getElementById("reset-customization");
const previewRoot = document.getElementById("townsquare-root");
const previewDock = document.getElementById("preview-dock");
const previewToggle = document.getElementById("preview-toggle");
const scenePositionFields = document.getElementById("scene-position-fields");
const styleOverrideFields = document.getElementById("style-override-fields");
const boardTitleInput = document.getElementById("board-title");
const boardBodyInput = document.getElementById("board-body");
const boardVariantSelect = document.getElementById("board-variant");
const boardAccentInput = document.getElementById("board-accent");
const boardAccentDefaultInput = document.getElementById("board-accent-default");
const boardXInput = document.getElementById("board-x");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const copyButton = document.getElementById("copy-snippet");
const copyStyleButton = document.getElementById("copy-style");
const counterForm = document.getElementById("counter-form");
const counterVariantSelect = document.getElementById("counter-variant");
const counterAccentInput = document.getElementById("counter-accent");
const counterAccentDefaultInput = document.getElementById("counter-accent-default");
const counterUrlInput = document.getElementById("counter-url");
const counterPreview = document.getElementById("counter-preview");
const counterSnippetEl = document.getElementById("counter-snippet");
const copyCounterButton = document.getElementById("copy-counter");
const connectionsList = document.getElementById("connections-list");
const addConnectionButton = document.getElementById("add-connection");
const saveConnectionsButton = document.getElementById("save-connections");
const connectionsStatusEl = document.getElementById("connections-status");
const chatDisabledInput = document.getElementById("chat-disabled");
const botProtectionInput = document.getElementById("bot-protection");
const clearMessagesButton = document.getElementById("clear-messages");
const disableSiteButton = document.getElementById("disable-site");
const visitorList = document.getElementById("visitor-list");
const ownerList = document.getElementById("owner-list");
const moderationForm = document.getElementById("moderation-form");
const blockedWordsInput = document.getElementById("blocked-words");
const chatThrottleSelect = document.getElementById("chat-throttle");
const saveModerationButton = document.getElementById("save-moderation");
const moderationStatusEl = document.getElementById("moderation-status");
const moderationLog = document.getElementById("moderation-log");
const pluginPanels = document.getElementById("plugin-panels");
const pluginToggles = document.getElementById("plugin-toggles");

renderStyleOverrideFields(styleOverrideFields);
bindStyleColorFields(customizationForm);
bindSceneCountProse(customizationForm);

let currentSite = null;
let siteDetailsTouched = false;
let siteDetailsBusy = false;
let siteDetailsSavedMessage = "";
let customizationBusy = false;
let customizationSavedMessage = "";
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

/** Chat-filtering editor (forbidden words + slow mode), poll-guarded like the rest. */
let moderationTouched = false;
let moderationBusy = false;
let moderationSavedMessage = "";

const preview = createCustomizationPreview({
  root: previewRoot,
  readingLabel: () => (currentSite ? `${currentSite.name} preview` : "Admin preview"),
  readConfig: (mode) => {
    const customization = currentSite ? readCustomizationFromForm() : getCurrentCustomization();
    return {
      scene: customization.sceneConfig,
      style: customization.styleConfig[mode],
      connections: sanitizeConnections(connectionsDraft),
      messageBoard: customization.messageBoard,
    };
  },
});

const previewModeButtons = document.querySelectorAll("[data-preview-mode]");
preview.bindThemeToggle(previewModeButtons);

// The preview docks to the bottom of the viewport; let owners collapse it out of
// the way. While collapsed we tear the preview down so it isn't animating offscreen.
let previewCollapsed = false;

// The admin view is split into tabs; only the Appearance tab hosts the preview, so
// we keep it torn down on every other tab the same way collapsing does.
let activeTab = "site";

function mountPreview(options) {
  if (previewCollapsed || activeTab !== "appearance") return;
  preview.mount(options);
}

function setPreviewCollapsed(collapsed) {
  previewCollapsed = collapsed;
  previewDock?.classList.toggle("is-collapsed", collapsed);
  if (previewToggle) {
    previewToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    previewToggle.textContent = collapsed ? "Show" : "Hide";
  }
  if (collapsed) {
    preview.destroy();
  } else if (currentSite) {
    preview.mount({ remount: true });
  }
}

previewToggle?.addEventListener("click", () => {
  setPreviewCollapsed(!previewCollapsed);
});

const adminTabs = document.getElementById("admin-tabs");
const tabButtons = adminTabs ? Array.from(adminTabs.querySelectorAll("[data-tab]")) : [];
const tabPanels = Array.from(document.querySelectorAll(".hosted-tabpanel"));

function setActiveTab(name) {
  if (!tabPanels.some((panel) => panel.dataset.tab === name)) return;
  activeTab = name;
  adminView?.setAttribute("data-active-tab", name);
  for (const button of tabButtons) {
    const selected = button.dataset.tab === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tab !== name;
  }
  // The preview only lives on the Appearance tab; mount it on arrival and tear it
  // down on departure so it never animates while hidden behind another tab.
  if (name === "appearance") {
    if (currentSite && !previewCollapsed) preview.mount({ remount: true });
  } else {
    preview.destroy();
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
}

const setStatus = createStatusSetter(statusEl);
const setSiteDetailsStatus = createStatusSetter(siteDetailsStatusEl, { toggleHidden: true });
const setCustomizationStatus = createStatusSetter(customizationStatusEl, { toggleHidden: true });
const setConnectionsStatus = createStatusSetter(connectionsStatusEl, { toggleHidden: true });
const setModerationStatus = createStatusSetter(moderationStatusEl, { toggleHidden: true });

const adminPlugins = createAdminPluginRuntime({
  container: pluginPanels,
  action: (plugin, name, input) => session.pluginAction(plugin, name, input),
});

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
    currentSite = null;
    siteDetailsTouched = false;
    siteDetailsBusy = false;
    siteDetailsSavedMessage = "";
    customizationSavedMessage = "";
    customizationTouched = false;
    connectionsDraft = [];
    connectionsTouched = false;
    connectionsSavedMessage = "";
    moderationTouched = false;
    moderationBusy = false;
    moderationSavedMessage = "";
    adminPlugins.clear();
    preview.destroy();
    setActiveTab("site");
  },
});

function siteDetailsAreDirty() {
  return Boolean(currentSite) && (
    siteOriginInput.value.trim() !== currentSite.origin
    || siteNameInput.value.trim() !== currentSite.name
    || siteEmailInput.value.trim() !== (currentSite.email || "")
    || Number(connectionLimitInput.value) !== Number(currentSite.connectionLimit || 100)
    || includeMatchingWwwInput.checked !== Boolean(currentSite.includeMatchingWww)
  );
}

function updateMatchingWwwControls() {
  const matching = getMatchingWwwOrigin(siteOriginInput.value);
  if (!matching) {
    includeMatchingWwwInput.checked = false;
    includeMatchingWwwInput.disabled = true;
    includeMatchingWwwLabel.textContent = "Also allow the matching www/non-www version";
    includeMatchingWwwNote.textContent = "Shown for standard domain names like example.com or www.example.com.";
    return;
  }

  includeMatchingWwwInput.disabled = false;
  includeMatchingWwwLabel.textContent = `Also allow ${matching}`;
  includeMatchingWwwNote.textContent = "Recommended if both versions of your site work.";
}

function updateSiteDetailsControls() {
  saveSiteDetailsButton.disabled = siteDetailsBusy || !siteDetailsAreDirty();
  if (siteDetailsBusy) {
    setSiteDetailsStatus("Saving site details...");
  } else if (siteDetailsSavedMessage) {
    setSiteDetailsStatus(siteDetailsSavedMessage);
  } else if (siteDetailsAreDirty()) {
    setSiteDetailsStatus("Unsaved site detail changes.");
  } else {
    setSiteDetailsStatus("");
  }
}

function syncSiteDetailsFromServer() {
  if (!siteDetailsTouched || !siteDetailsAreDirty()) {
    siteOriginInput.value = currentSite.origin;
    siteNameInput.value = currentSite.name;
    siteEmailInput.value = currentSite.email || "";
    connectionLimitInput.value = String(currentSite.connectionLimit || 100);
    includeMatchingWwwInput.checked = Boolean(currentSite.includeMatchingWww);
    siteDetailsTouched = false;
  }
  updateMatchingWwwControls();
  updateSiteDetailsControls();
}

async function saveSiteDetails() {
  if (!currentSite || siteDetailsBusy || !siteDetailsAreDirty()) return;
  siteDetailsBusy = true;
  siteDetailsSavedMessage = "";
  updateSiteDetailsControls();

  const ok = await session.action("updateSiteDetails", {
    origin: siteOriginInput.value,
    name: siteNameInput.value,
    email: siteEmailInput.value,
    connectionLimit: Number(connectionLimitInput.value),
    includeMatchingWww: includeMatchingWwwInput.checked,
  });

  siteDetailsBusy = false;
  if (ok) {
    siteDetailsTouched = false;
    siteDetailsSavedMessage = "Site details saved.";
  }
  updateSiteDetailsControls();
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
    messageBoard: sanitizeMessageBoard(currentSite?.messageBoard || {}),
  };
}

function getDefaultCustomization() {
  return {
    sceneConfig: sanitizeSceneConfig(DEFAULT_SCENE_CONFIG),
    styleConfig: sanitizeSiteStyle(DEFAULT_SITE_STYLE),
    messageBoard: sanitizeMessageBoard(DEFAULT_MESSAGE_BOARD),
  };
}

function applyMessageBoardToForm(board) {
  const next = sanitizeMessageBoard(board);
  boardTitleInput.value = next.title;
  boardBodyInput.value = next.body;
  boardVariantSelect.value = MESSAGE_BOARD_VARIANTS.includes(next.variant) ? next.variant : MESSAGE_BOARD_VARIANTS[0];
  boardAccentDefaultInput.checked = !next.accent;
  // A real hex accent drives the picker; "transparent"/inherit leave it at its default.
  if (/^#[0-9a-f]{6}$/i.test(next.accent)) boardAccentInput.value = next.accent;
  boardXInput.value = String(Math.round(next.x * 100));
}

function readMessageBoardFromForm() {
  const usesDefault = boardAccentDefaultInput.checked;
  return sanitizeMessageBoard({
    title: boardTitleInput.value,
    body: boardBodyInput.value,
    variant: boardVariantSelect.value,
    accent: usesDefault ? "" : boardAccentInput.value,
    x: Number(boardXInput.value) / 100,
  });
}

function applyCustomizationToForm(customization) {
  applyConfigToForm(customizationForm, { ...customization.sceneConfig, ...customization.styleConfig });
  syncScenePositionInputs(customization.sceneConfig);
  applyMessageBoardToForm(customization.messageBoard);
}

function readCustomizationFromForm() {
  return {
    sceneConfig: sanitizeSceneConfig(readSceneConfigFromForm(customizationForm)),
    styleConfig: sanitizeSiteStyle(readStyleConfigFromForm(customizationForm)),
    messageBoard: readMessageBoardFromForm(),
  };
}

function serializeCustomization(customization) {
  return JSON.stringify({
    sceneConfig: sanitizeSceneConfig(customization?.sceneConfig || {}),
    styleConfig: sanitizeSiteStyle(customization?.styleConfig || {}),
    messageBoard: sanitizeMessageBoard(customization?.messageBoard || {}),
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
    setCustomizationStatus("Publishing customization...");
    return;
  }

  if (customizationSavedMessage) {
    setCustomizationStatus(customizationSavedMessage);
    return;
  }

  if (customizationIsDirty()) {
    setCustomizationStatus("Unpublished changes — press Publish to make them live.");
    return;
  }

  setCustomizationStatus("");
}

async function saveCustomization() {
  if (!currentSite || customizationBusy || !customizationIsDirty()) return false;

  customizationBusy = true;
  customizationSavedMessage = "";
  updateCustomizationButtons();
  updateCustomizationStatus();

  const ok = await session.action("updateCustomization", readCustomizationFromForm());

  customizationBusy = false;
  if (ok) {
    customizationTouched = false;
    customizationSavedMessage = "Published — scene and board are live. Re-copy the Customization CSS below if you changed colors.";
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
    mountPreview({ remount: force });
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
  mountPreview();
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
  if (preview.mounted) mountPreview();
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
    connectionsSavedMessage = "Connections saved — your site updates automatically.";
  }
  // render() runs after a successful action and resyncs the draft from server.
  updateConnectionsControls();
}

const MODERATION_LABELS = {
  kick: "Kicked",
  block: "Banned",
  mute: "Muted",
  unmute: "Unmuted",
  hide: "Hidden",
  unhide: "Unhidden",
  "chat-off": "Chat disabled",
  "chat-on": "Chat enabled",
  "clear-messages": "Cleared messages",
  "site-off": "Site disabled",
  "site-on": "Site enabled",
};

// Mirror the server's word sanitiser so dirty-tracking stays stable after a save.
function parseBlockedWords(text) {
  const seen = new Set();
  const words = [];
  for (const raw of String(text).split(/[\n,]/)) {
    const word = raw.trim().toLowerCase();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function serverBlockedWords() {
  return Array.isArray(currentSite?.blockedWords) ? currentSite.blockedWords : [];
}

function serverChatThrottle() {
  return String(currentSite?.chatThrottleMs ?? 1500);
}

function moderationIsDirty() {
  if (!currentSite) return false;
  const wordsDirty = parseBlockedWords(blockedWordsInput.value).join("\n") !== serverBlockedWords().join("\n");
  return wordsDirty || chatThrottleSelect.value !== serverChatThrottle();
}

function updateModerationControls() {
  saveModerationButton.disabled = moderationBusy || !moderationIsDirty();
  if (moderationBusy) {
    setModerationStatus("Saving filtering...");
  } else if (moderationSavedMessage) {
    setModerationStatus(moderationSavedMessage);
  } else if (moderationIsDirty()) {
    setModerationStatus("Unsaved filtering changes.");
  } else {
    setModerationStatus("");
  }
}

function syncModerationFromServer() {
  if (!moderationTouched || !moderationIsDirty()) {
    blockedWordsInput.value = serverBlockedWords().join("\n");
    chatThrottleSelect.value = serverChatThrottle();
    moderationTouched = false;
  }
  updateModerationControls();
}

async function saveModeration() {
  if (!currentSite || moderationBusy || !moderationIsDirty()) return;
  moderationBusy = true;
  moderationSavedMessage = "";
  updateModerationControls();

  const ok = await session.action("updateModeration", {
    blockedWords: parseBlockedWords(blockedWordsInput.value),
    chatThrottleMs: Number(chatThrottleSelect.value),
  });

  moderationBusy = false;
  if (ok) {
    moderationTouched = false;
    moderationSavedMessage = "Filtering saved.";
  }
  updateModerationControls();
}

function renderModerationLog(log) {
  moderationLog.replaceChildren();
  const entries = Array.isArray(log) ? log : [];
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No moderation actions yet.";
    moderationLog.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("p");
    row.className = "moderation-log-entry";
    const label = MODERATION_LABELS[entry.action] || entry.action;
    const detail = entry.detail ? ` · ${entry.detail}` : "";
    row.append(
      el("time", { text: formatTime(entry.at) }),
      " ",
      el("span", { text: `${label}${detail}` }),
    );
    moderationLog.appendChild(row);
  }
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
  head.append(
    el("strong", { text: `${savedName || `Owner ${index + 1}`} 👑` }),
    el("span", { text: owner.online ? "online now" : "offline" }),
  );

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

function renderPluginToggles(list) {
  pluginToggles.replaceChildren();
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No plugins are available for your site yet.";
    pluginToggles.appendChild(empty);
    return;
  }

  for (const plugin of items) {
    const row = document.createElement("div");
    row.className = "hosted-section";

    const input = el("input", { type: "checkbox" });
    input.checked = Boolean(plugin.enabled);
    row.append(el("label", { class: "hosted-toggle" }, [input, el("span", { text: plugin.label })]));
    if (plugin.description) {
      row.append(el("p", { class: "hosted-note", text: plugin.description }));
    }

    input.addEventListener("change", () => {
      session.action("setPluginEnabled", { name: plugin.name, enabled: input.checked });
    });
    pluginToggles.appendChild(row);
  }
}

function render(data, { background = false } = {}) {
  currentSite = data.site;
  const scene = data.scene;

  syncSiteDetailsFromServer();

  const otherOrigins = (currentSite.allowedOrigins || [])
    .filter((origin) => origin !== currentSite.origin)
    .join(", ") || "—";
  const metaRow = (term, value) => {
    const dd = el("dd");
    if (typeof value === "string") dd.textContent = value;
    else dd.append(value);
    return el("div", {}, [el("dt", { text: term }), dd]);
  };
  metaEl.replaceChildren(el("dl", {}, [
    metaRow("Site", String(currentSite.name)),
    metaRow("Website", String(currentSite.origin)),
    metaRow("Also allows", otherOrigins),
    metaRow("Status", currentSite.disabled ? "Disabled" : "Enabled"),
    metaRow("Verified", formatTime(currentSite.verifiedAt, "Not seen yet")),
    metaRow("Last loaded on", currentSite.lastSeenUrl ? safeLink(currentSite.lastSeenUrl) : "—"),
    metaRow("Messages", String(currentSite.messageCount ?? 0)),
    metaRow("Last message", formatTime(currentSite.lastMessageAt)),
    metaRow("Active visitors", `${scene.activeVisitors} / ${currentSite.connectionLimit ?? 100}`),
    metaRow("Blocked", String(currentSite.blockedCount)),
  ]));

  if (document.activeElement !== snippetEl) {
    snippetEl.value = data.embedSnippet;
  }
  if (document.activeElement !== styleSnippetEl) {
    styleSnippetEl.value = data.styleSnippet;
  }
  // Suggest the site's own address as the click destination once we know it.
  if (currentSite.origin && !counterUrlInput.placeholder.startsWith("http")) {
    counterUrlInput.placeholder = currentSite.origin;
  }
  // The counter's look lives only in this form, so build it once we know the
  // siteKey; later background polls leave the picker and its preview alone.
  if (!counterInitialized) {
    counterInitialized = true;
    renderCounter();
  }
  chatDisabledInput.checked = currentSite.chatDisabled;
  botProtectionInput.checked = Boolean(currentSite.botProtection);
  disableSiteButton.textContent = currentSite.disabled ? "Enable site" : "Disable site";
  syncCustomizationForm();
  syncConnectionsFromServer();
  syncModerationFromServer();
  renderModerationLog(currentSite.moderationLog);
  renderPluginToggles(data.plugins);
  adminPlugins.render(data, { background });

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
    const tabs = `${visitor.clientCount} tab${visitor.clientCount === 1 ? "" : "s"} connected`;
    row.append(el("div", {}, [
      el("strong", { text: `${visitorLabel}${ownerTag}` }),
      el("span", { text: `${visitorMeta}${tabs}` }),
    ]));

    const owner = document.createElement("button");
    owner.type = "button";
    owner.textContent = visitor.isOwner ? "Owner ✓" : "Make owner";
    owner.addEventListener("click", () => session.action("setOwnerVisitor", { visitorId: visitor.id, owner: !visitor.isOwner }));

    const mute = document.createElement("button");
    mute.type = "button";
    mute.textContent = visitor.muted ? "Unmute" : "Mute";
    mute.addEventListener("click", () => session.action(visitor.muted ? "unmuteVisitor" : "muteVisitor", { visitorId: visitor.id }));

    const hide = document.createElement("button");
    hide.type = "button";
    hide.textContent = visitor.hidden ? "Unhide" : "Hide";
    hide.addEventListener("click", () => session.action(visitor.hidden ? "unhideVisitor" : "hideVisitor", { visitorId: visitor.id }));

    const kick = document.createElement("button");
    kick.type = "button";
    kick.textContent = "Kick";
    kick.addEventListener("click", () => session.action("kickVisitor", { visitorId: visitor.id }));

    const block = document.createElement("button");
    block.type = "button";
    block.textContent = "Block";
    block.addEventListener("click", () => session.action("blockVisitor", { visitorId: visitor.id }));

    row.append(owner, mute, hide, kick, block);
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

/**
 * The counter is a copy-once embed whose look is baked into the snippet, so its
 * style lives entirely in this form (no server round-trip). Read the current
 * picker state into a config the preview and snippet both use.
 */
function readCounterConfig() {
  const requested = counterVariantSelect.value;
  return {
    variant: COUNTER_VARIANTS.includes(requested) ? requested : "pill",
    accent: counterAccentDefaultInput.checked ? "" : counterAccentInput.value,
    townSquareUrl: counterUrlInput.value.trim(),
  };
}

function buildCounterSnippet(config) {
  const serverOrigin = window.location.origin;
  const siteKey = currentSite?.siteKey || "";
  const lines = [`    serverOrigin: ${JSON.stringify(serverOrigin)}`];
  if (siteKey) lines.push(`    siteKey: ${JSON.stringify(siteKey)}`);
  lines.push(`    variant: ${JSON.stringify(config.variant)}`);
  if (config.accent) lines.push(`    accent: ${JSON.stringify(config.accent)}`);
  if (config.townSquareUrl) lines.push(`    townSquareUrl: ${JSON.stringify(config.townSquareUrl)}`);
  return `<div id="townsquare-count"></div>
<script type="module">
  import { mountTownSquareCounter } from ${JSON.stringify(`${serverOrigin}/townsquare-counter.mjs`)};

  mountTownSquareCounter(document.getElementById("townsquare-count"), {
${lines.join(",\n")}
  });
</script>`;
}

let counterPreviewHandle = null;
let counterInitialized = false;
function renderCounter() {
  const config = readCounterConfig();
  counterAccentInput.disabled = counterAccentDefaultInput.checked;

  if (document.activeElement !== counterSnippetEl) {
    counterSnippetEl.value = buildCounterSnippet(config);
  }

  // The preview is the real widget pointed at this site, so it shows the live
  // count. Remount on every change since variant/accent are set at mount time.
  counterPreviewHandle?.destroy();
  counterPreviewHandle = mountTownSquareCounter(counterPreview, {
    serverOrigin: window.location.origin,
    siteKey: currentSite?.siteKey || "",
    variant: config.variant,
    accent: config.accent || undefined,
    townSquareUrl: config.townSquareUrl || undefined,
  });
}

counterForm.addEventListener("input", (event) => {
  // Picking a colour means the owner wants a custom accent, not the default.
  if (event.target === counterAccentInput) counterAccentDefaultInput.checked = false;
  renderCounter();
});

bindCopy(copyCounterButton, { text: () => counterSnippetEl.value, source: counterSnippetEl });
bindCopy(copyButton, { text: () => snippetEl.value, source: snippetEl });
bindCopy(copyStyleButton, { text: () => styleSnippetEl.value, source: styleSnippetEl });

siteDetailsForm.addEventListener("input", () => {
  siteDetailsTouched = true;
  siteDetailsSavedMessage = "";
  updateMatchingWwwControls();
  updateSiteDetailsControls();
});

siteDetailsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSiteDetails();
});

customizationForm.addEventListener("input", (event) => {
  customizationSavedMessage = "";
  customizationTouched = true;
  if (isSceneCountInputName(event.target?.name || "")) {
    syncScenePositionInputs(readSceneConfigFromForm(customizationForm));
  }
  // Picking a custom colour means the owner no longer wants the theme accent.
  if (event.target === boardAccentInput) {
    boardAccentDefaultInput.checked = false;
  }
  updateCustomizationButtons();
  updateCustomizationStatus();
  mountPreview();
});

customizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCustomization();
});

resetCustomizationButton.addEventListener("click", () => {
  customizationSavedMessage = "";
  customizationTouched = true;
  applyCustomizationToForm(getDefaultCustomization());
  updateCustomizationButtons();
  updateCustomizationStatus();
  mountPreview({ remount: true });
});

addConnectionButton.addEventListener("click", addConnection);
saveConnectionsButton.addEventListener("click", () => { void saveConnections(); });

moderationForm.addEventListener("input", () => {
  moderationSavedMessage = "";
  moderationTouched = true;
  updateModerationControls();
});
moderationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveModeration();
});

chatDisabledInput.addEventListener("change", () => session.action("setChatDisabled", { disabled: chatDisabledInput.checked }));
botProtectionInput.addEventListener("change", () => session.action("setBotProtection", { enabled: botProtectionInput.checked }));
clearMessagesButton.addEventListener("click", () => session.action("clearMessages"));
disableSiteButton.addEventListener("click", () => session.action("disableSite", { disabled: !currentSite.disabled }));

session.start();
