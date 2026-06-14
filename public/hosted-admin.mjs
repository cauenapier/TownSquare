const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginTokenEl = document.getElementById("login-token");
const loginSubmitButton = document.getElementById("login-submit");
const loginStatusEl = document.getElementById("login-status");
const signOutButton = document.getElementById("sign-out");
const statusEl = document.getElementById("admin-status");
const metaEl = document.getElementById("site-meta");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const sceneSummaryEl = document.getElementById("scene-summary");
const copyButton = document.getElementById("copy-snippet");
const copyStyleButton = document.getElementById("copy-style");
const chatDisabledInput = document.getElementById("chat-disabled");
const clearMessagesButton = document.getElementById("clear-messages");
const disableSiteButton = document.getElementById("disable-site");
const visitorList = document.getElementById("visitor-list");

const STORAGE_KEY = "townsquare-admin-session";
const REFRESH_INTERVAL_MS = 5000;

let currentSite = null;
let siteKey = "";
let adminToken = "";
let refreshTimer = null;

function setLoginStatus(message, isError = false) {
  loginStatusEl.textContent = message;
  loginStatusEl.hidden = !message;
  loginStatusEl.classList.toggle("hosted-status--error", isError);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("hosted-status--error", isError);
}

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
  siteKey = "";
  adminToken = "";
  currentSite = null;
  sessionStorage.removeItem(STORAGE_KEY);
}

function showLogin(message = "", isError = false) {
  stopAutoRefresh();
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, isError);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSceneSummary(sceneConfig = {}) {
  sceneSummaryEl.innerHTML = [
    ["Benches", sceneConfig.benches ?? 0],
    ["Trees", sceneConfig.trees ?? 0],
    ["Lamps", sceneConfig.lamps ?? 0],
    ["Branches", sceneConfig.branches ?? 0],
  ]
    .map(
      ([label, value]) =>
        `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(String(value))}</span></div>`,
    )
    .join("");
}

function render(data) {
  currentSite = data.site;
  const scene = data.scene;

  metaEl.innerHTML = `
    <dl>
      <div><dt>Site</dt><dd>${escapeHtml(currentSite.name)}</dd></div>
      <div><dt>Origin</dt><dd>${escapeHtml(currentSite.origin)}</dd></div>
      <div><dt>Status</dt><dd>${currentSite.disabled ? "Disabled" : "Enabled"}</dd></div>
      <div><dt>Verified</dt><dd>${formatTime(currentSite.verifiedAt)}</dd></div>
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
    const visitorMeta = visitorName ? `Visitor ${visitor.id} · ` : "";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(visitorLabel)}</strong>
        <span>${escapeHtml(visitorMeta)}${visitor.clientCount} tab${visitor.clientCount === 1 ? "" : "s"} connected</span>
      </div>
    `;

    const kick = document.createElement("button");
    kick.type = "button";
    kick.textContent = "Kick";
    kick.addEventListener("click", () => action("kickVisitor", { visitorId: visitor.id }));

    const block = document.createElement("button");
    block.type = "button";
    block.textContent = "Block";
    block.addEventListener("click", () => action("blockVisitor", { visitorId: visitor.id }));

    row.append(kick, block);
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
      setStatus(result.body.error || "Could not load this site.", true);
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
    setStatus(result.body.error || "Action failed.", true);
    return;
  }

  await loadSite();
}

function bindCopy(button, source, doneLabel) {
  const originalLabel = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.value);
    } catch {
      source.focus();
      source.select();
      return;
    }
    button.textContent = doneLabel;
    setTimeout(() => {
      button.textContent = originalLabel;
    }, 1200);
  });
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

bindCopy(copyButton, snippetEl, "Copied");
bindCopy(copyStyleButton, styleSnippetEl, "Copied");

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
