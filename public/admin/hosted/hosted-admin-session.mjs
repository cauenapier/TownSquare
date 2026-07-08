/**
 * Shared login + polling runtime for the site-admin pages (the settings
 * dashboard and the standalone chat thread). The admin token is used only once,
 * to bootstrap a login: the server exchanges it for an HttpOnly session cookie,
 * and every subsequent `/api/admin/site` and `/api/admin/action` request
 * authenticates via that cookie. The raw token is never persisted in storage;
 * we keep only the (non-secret) siteKey so a returning visitor with a valid
 * cookie skips the login screen.
 */

import { createAutoRefresh, createCredentialStore, createStatusSetter, postJson } from "./hosted-common.mjs";

export const ADMIN_SESSION_STORAGE_KEY = "townsquare-admin-session";
const REFRESH_INTERVAL_MS = 5000;

/**
 * @param {object} options
 * @param {string} options.redirectPath Path to clean URL credentials back to.
 * @param {object} options.elements Login/admin view DOM nodes.
 * @param {(data: any, meta: { background: boolean }) => void} options.onRender
 *   Called with each site snapshot. `meta.background` is true for poll-driven
 *   refreshes so stateful UIs can avoid clobbering in-progress edits.
 * @param {(message: string) => void} [options.onError] Called when a load or
 *   action request fails while the admin view is visible.
 * @param {() => void} [options.onBeforeShowLogin] Tear-down before login shows.
 * @param {() => void} [options.onClear] Cleanup when credentials are dropped.
 * @param {number} [options.refreshIntervalMs]
 */
export function createAdminSession({
  redirectPath,
  elements,
  onRender,
  onError,
  onBeforeShowLogin,
  onClear,
  refreshIntervalMs = REFRESH_INTERVAL_MS,
}) {
  const { loginView, adminView, loginForm, loginToken, rememberMe: rememberMeEl, loginSubmit, loginStatus, signOut } = elements;

  const credentialStore = createCredentialStore(ADMIN_SESSION_STORAGE_KEY);
  const setLoginStatus = createStatusSetter(loginStatus, { toggleHidden: true });
  const autoRefresh = createAutoRefresh(() => loadSite({ silent: true }), refreshIntervalMs);

  let siteKey = "";
  let adminToken = "";
  let rememberMe = false;
  let loadSeq = 0;

  function readStoredCredentials() {
    const stored = credentialStore.read();
    const value = stored?.value;
    // Only the non-secret siteKey is persisted; auth rides on the HttpOnly
    // cookie. (Older entries may also carry a token field — it is ignored.)
    if (value && typeof value.siteKey === "string" && value.siteKey) {
      rememberMe = stored.remembered;
      return { siteKey: value.siteKey, adminToken: "" };
    }
    return { siteKey: "", adminToken: "" };
  }

  function readCredentials() {
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const urlSiteKey = queryParams.get("siteKey") || hashParams.get("siteKey") || "";
    const urlAdminToken = hashParams.get("adminToken") || queryParams.get("adminToken") || "";

    if (urlSiteKey || urlAdminToken) {
      window.history.replaceState({}, document.title, redirectPath);
      return { siteKey: urlSiteKey, adminToken: urlAdminToken };
    }

    return readStoredCredentials();
  }

  function storeCredentials() {
    credentialStore.save({ siteKey }, rememberMe);
  }

  function clearCredentials() {
    siteKey = "";
    adminToken = "";
    onClear?.();
    credentialStore.clear();
  }

  function showLogin(message = "", isError = false) {
    autoRefresh.stop();
    onBeforeShowLogin?.();
    adminView.hidden = true;
    loginView.hidden = false;
    setLoginStatus(message, isError);
    loginToken.focus();
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
    autoRefresh.start();
  }

  async function loadSite({ silent = false } = {}) {
    const seq = ++loadSeq;

    // Need a known site (cookie auth) or a token to bootstrap a session.
    if (!siteKey && !adminToken) {
      showLogin();
      return;
    }

    // Bootstrap: trade the one-time token for a session cookie + the siteKey,
    // then drop the raw token so it is never stored or resent.
    if (adminToken) {
      const login = await postJson("/api/admin/login", { adminToken, rememberMe });
      if (seq !== loadSeq) return;
      if (!login.ok) {
        clearCredentials();
        showLogin(login.body.error || "Could not open admin with that token.", true);
        return;
      }
      siteKey = login.body.site.siteKey;
      adminToken = "";
    }

    const result = await postJson("/api/admin/site", { siteKey });
    if (seq !== loadSeq) return;
    if (!result.ok) {
      if (result.status === 403) {
        clearCredentials();
        showLogin("Your admin session expired. Paste your admin token to sign back in.", true);
        return;
      }
      if (!silent) {
        onError?.(result.body.error || "Could not load this site.");
      }
      return;
    }

    storeCredentials();
    showAdmin();
    // `silent` marks the background poll; pass it through so stateful UIs (e.g.
    // plugin admin editors) can skip clobbering in-progress edits on a tick.
    onRender(result.body, { background: silent });
  }

  async function action(name, data = {}) {
    const result = await postJson("/api/admin/action", { siteKey, action: name, ...data });
    if (!result.ok) {
      onError?.(result.body.error || "Action failed.");
      return false;
    }

    await loadSite();
    return true;
  }

  async function pluginAction(plugin, name, input = {}) {
    const result = await postJson("/api/admin/action", {
      siteKey,
      plugin,
      action: name,
      input,
    });
    if (!result.ok) {
      onError?.(result.body.error || "Plugin action failed.");
      return false;
    }

    await loadSite();
    return true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    setLoginStatus("Checking token...");

    adminToken = loginToken.value.trim();
    rememberMe = rememberMeEl?.checked ?? false;
    siteKey = "";
    await loadSite();

    loginSubmit.disabled = false;
    if (!adminView.hidden) {
      loginForm.reset();
      setLoginStatus("");
    }
  });

  signOut?.addEventListener("click", async () => {
    autoRefresh.stop();
    await postJson("/api/admin/logout", {});
    clearCredentials();
    showLogin("Signed out. Your admin session was ended on this device.");
  });

  function start() {
    const credentials = readCredentials();
    siteKey = credentials.siteKey;
    adminToken = credentials.adminToken;
    if (rememberMeEl) rememberMeEl.checked = rememberMe;

    if (siteKey || adminToken) {
      loadSite();
    } else {
      showLogin();
    }
  }

  return { start, loadSite, action, pluginAction, showLogin, setLoginStatus };
}
