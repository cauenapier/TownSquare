import { bindCopy } from "../lib/ui-common.mjs";
import {
  createAutoRefresh,
  createCredentialStore,
  createStatusSetter,
  escapeHtml,
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
const siteList = document.getElementById("site-list");
const tokenResult = document.getElementById("token-result");
const newAdminTokenEl = document.getElementById("new-admin-token");
const newAdminLink = document.getElementById("new-admin-link");
const copyTokenButton = document.getElementById("copy-token");

const STORAGE_KEY = "townsquare-service-admin-password";
const REFRESH_INTERVAL_MS = 5000;

const credentialStore = createCredentialStore(STORAGE_KEY);

const stored = credentialStore.read();
let password = typeof stored?.value === "string" ? stored.value : "";
let rememberMe = stored?.remembered ?? false;

const setLoginStatus = createStatusSetter(loginStatusEl, { toggleHidden: true });
const setStatus = createStatusSetter(statusEl);
const autoRefresh = createAutoRefresh(() => loadSites({ silent: true }), REFRESH_INTERVAL_MS);

// Every service-admin request carries the operator password.
const api = (path, payload = {}) => postJson(path, { password, ...payload });

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

function renderSites(sites) {
  siteList.replaceChildren();

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hosted-note";
    empty.textContent = "No registered websites yet.";
    siteList.appendChild(empty);
    return;
  }

  for (const site of sites) {
    const row = document.createElement("article");
    row.className = "service-site-row";
    row.innerHTML = `
      <div class="service-site-main">
        <strong>${escapeHtml(site.name)}</strong>
        <span>${escapeHtml(site.origin)}</span>
        <code>${escapeHtml(site.siteKey)}</code>
      </div>
      <dl class="service-site-meta">
        ${site.email ? `<div><dt>Email</dt><dd>${escapeHtml(site.email)}</dd></div>` : ""}
        <div><dt>Status</dt><dd>${site.disabled ? "Disabled" : "Enabled"}</dd></div>
        <div><dt>Chat</dt><dd>${site.chatDisabled ? "Disabled" : "Enabled"}</dd></div>
        <div><dt>Verified</dt><dd>${formatTime(site.verifiedAt)}</dd></div>
        <div><dt>Last seen</dt><dd>${formatTime(site.lastSeenAt)}</dd></div>
        <div><dt>Active</dt><dd>${site.activeVisitors}</dd></div>
        <div><dt>Blocked</dt><dd>${site.blockedCount}</dd></div>
      </dl>
    `;

    const actions = document.createElement("div");
    actions.className = "service-site-actions";

    const toggleSite = document.createElement("button");
    toggleSite.type = "button";
    toggleSite.textContent = site.disabled ? "Enable site" : "Disable site";
    toggleSite.addEventListener("click", () => action("setSiteDisabled", site.siteKey, { disabled: !site.disabled }));

    const toggleChat = document.createElement("button");
    toggleChat.type = "button";
    toggleChat.textContent = site.chatDisabled ? "Enable chat" : "Disable chat";
    toggleChat.addEventListener("click", () => action("setChatDisabled", site.siteKey, { disabled: !site.chatDisabled }));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset token";
    reset.addEventListener("click", () => resetAdminToken(site.siteKey));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "service-danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteSite(site));

    actions.append(toggleSite, toggleChat, reset, remove);
    row.append(actions);
    siteList.appendChild(row);
  }
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
