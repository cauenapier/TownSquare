/**
 * Standalone admin chat page. It shares the site-admin login + polling runtime
 * with the settings dashboard (same token, same storage key), so an admin who
 * is already signed in lands straight on the live thread. Everything here is
 * just the chat thread plus its two moderation affordances.
 */

import { createStatusSetter } from "./hosted-common.mjs";
import { createAdminSession } from "./hosted-admin-session.mjs";
import { renderChatThread } from "./hosted-chat-thread.mjs";

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginForm = document.getElementById("login-form");
const loginTokenEl = document.getElementById("login-token");
const rememberMeEl = document.getElementById("login-remember");
const loginSubmitButton = document.getElementById("login-submit");
const loginStatusEl = document.getElementById("login-status");
const statusEl = document.getElementById("chat-status");
const chatHeadingEl = document.getElementById("chat-heading");
const chatDisabledInput = document.getElementById("chat-disabled");
const botProtectionInput = document.getElementById("bot-protection");
const clearMessagesButton = document.getElementById("clear-messages");
const chatThread = document.getElementById("chat-thread");

const CHAT_REFRESH_INTERVAL_MS = 2000;

const setStatus = createStatusSetter(statusEl);

function render(data) {
  const site = data.site;
  const scene = data.scene;

  chatHeadingEl.textContent = site.name ? `${site.name} · live conversation` : "Live conversation";
  chatDisabledInput.checked = site.chatDisabled;
  botProtectionInput.checked = Boolean(site.botProtection);

  renderChatThread(chatThread, scene.visitors, {
    onKick: (visitorId) => session.action("kickVisitor", { visitorId }),
    onBlock: (visitorId) => session.action("blockVisitor", { visitorId }),
    onMute: (visitorId, muted) => session.action(muted ? "unmuteVisitor" : "muteVisitor", { visitorId }),
  });

  if (site.disabled) {
    setStatus("Site is disabled. Visitors cannot connect.", true);
  } else if (site.chatDisabled) {
    setStatus("Chat is disabled for this site. Updates automatically.");
  } else {
    setStatus(`${scene.activeVisitors} active visitor${scene.activeVisitors === 1 ? "" : "s"}. Updates automatically.`);
  }
}

const session = createAdminSession({
  redirectPath: "/admin/chat",
  refreshIntervalMs: CHAT_REFRESH_INTERVAL_MS,
  elements: {
    loginView,
    adminView,
    loginForm,
    loginToken: loginTokenEl,
    rememberMe: rememberMeEl,
    loginSubmit: loginSubmitButton,
    loginStatus: loginStatusEl,
  },
  onRender: render,
  onError: (message) => setStatus(message, true),
});

chatDisabledInput.addEventListener("change", () => session.action("setChatDisabled", { disabled: chatDisabledInput.checked }));
botProtectionInput.addEventListener("change", () => session.action("setBotProtection", { enabled: botProtectionInput.checked }));
clearMessagesButton.addEventListener("click", () => session.action("clearMessages"));

session.start();
