const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginPasswordEl = document.getElementById("login-password");
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

let password = sessionStorage.getItem(STORAGE_KEY) || "";

function setLoginStatus(message, isError = false) {
  loginStatusEl.textContent = message;
  loginStatusEl.hidden = !message;
  loginStatusEl.classList.toggle("hosted-status--error", isError);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("hosted-status--error", isError);
}

function showLogin(message = "", isError = false) {
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, isError);
  loginPasswordEl.focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
}

async function api(path, payload = {}) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, ...payload }),
    });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: "Could not reach the server." } };
  }
}

function formatTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

async function loadSites() {
  if (!password) {
    showLogin();
    return;
  }

  setStatus("Loading websites...");
  const result = await api("/api/service-admin/sites");
  if (!result.ok) {
    if (result.status === 403) {
      sessionStorage.removeItem(STORAGE_KEY);
      password = "";
      showLogin(result.body.error || "Could not open service admin.", true);
      return;
    }
    setStatus(result.body.error || "Could not load registered websites.", true);
    return;
  }

  sessionStorage.setItem(STORAGE_KEY, password);
  showAdmin();
  tokenResult.hidden = true;
  renderSites(result.body.sites);
  setStatus(`${result.body.sites.length} registered website${result.body.sites.length === 1 ? "" : "s"}.`);
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
  await loadSites();

  loginSubmitButton.disabled = false;
  if (!adminView.hidden) {
    loginForm.reset();
    setLoginStatus("");
  }
});

signOutButton.addEventListener("click", () => {
  password = "";
  sessionStorage.removeItem(STORAGE_KEY);
  showLogin("Signed out. The service admin password was forgotten on this device.");
});

copyTokenButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(newAdminTokenEl.value);
  } catch {
    newAdminTokenEl.focus();
    newAdminTokenEl.select();
    return;
  }
  copyTokenButton.textContent = "Copied";
  setTimeout(() => {
    copyTokenButton.textContent = "Copy token";
  }, 1200);
});

if (password) {
  loadSites();
} else {
  showLogin();
}
