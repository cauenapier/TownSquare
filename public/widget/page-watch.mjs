/**
 * Host-page navigation watching for the "currently reading" presence tag.
 *
 * Listens for full and SPA navigations (history API patching included) and
 * pushes debounced reading updates over the socket when the page changes.
 */

import { setAvatarProfile } from "./dom.mjs";
import { readCurrentPage } from "./utils.mjs";
import { MSG } from "../shared/protocol.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const READING_DEBOUNCE_MS = 80;
const READING_RECHECK_MS = 400;

function isReadingActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

// One shared history patch backs every mount. Wrapping pushState/replaceState
// per mount would nest wrappers and fire the navigation event once per mount;
// instead we install a single wrapper, refcount it, and let the last teardown
// restore the host's originals. The wrapper just emits a global
// `townsquare:navigation` event that every mount already listens for.
let historyPatchCount = 0;
let originalPushState = null;
let originalReplaceState = null;
let wrappedPushState = null;
let wrappedReplaceState = null;

function installHistoryPatch() {
  historyPatchCount += 1;
  if (historyPatchCount > 1) return;
  originalPushState = history.pushState;
  originalReplaceState = history.replaceState;
  wrappedPushState = function townsquarePushState(...args) {
    const result = originalPushState.apply(this, args);
    window.dispatchEvent(new Event("townsquare:navigation"));
    return result;
  };
  wrappedReplaceState = function townsquareReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event("townsquare:navigation"));
    return result;
  };
  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;
}

function uninstallHistoryPatch() {
  if (historyPatchCount === 0) return;
  historyPatchCount -= 1;
  if (historyPatchCount > 0) return;
  // Only restore methods that are still our wrapper; if the host swapped them
  // out meanwhile, leave their version in place.
  if (history.pushState === wrappedPushState) history.pushState = originalPushState;
  if (history.replaceState === wrappedReplaceState) history.replaceState = originalReplaceState;
  originalPushState = null;
  originalReplaceState = null;
  wrappedPushState = null;
  wrappedReplaceState = null;
}

/**
 * Start watching the host page; returns a dispose function that removes the
 * listeners and restores the patched history methods.
 *
 * @param {WidgetContext} ctx
 * @returns {() => void}
 */
export function watchCurrentPage(ctx) {
  let updateTimer = null;
  let recheckTimer = null;

  const sendReadingUpdate = () => {
    updateTimer = null;
    const nextPage = readCurrentPage(ctx.root, ctx.options);
    const readingActive = isReadingActive();
    if (
      nextPage.readingLabel === ctx.self.readingLabel
      && nextPage.readingUrl === ctx.self.readingUrl
      && readingActive === ctx.self.readingActive
    ) return;

    ctx.self.readingLabel = nextPage.readingLabel;
    ctx.self.readingUrl = nextPage.readingUrl;
    ctx.self.readingActive = readingActive;
    setAvatarProfile(ctx.self.avatar, ctx.self);
    if (ctx.socket.readyState === WebSocket.OPEN && ctx.self.id) {
      ctx.socket.send(JSON.stringify({ type: MSG.READING, ...nextPage, readingActive }));
    }
  };

  const queueReadingUpdate = () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(sendReadingUpdate, READING_DEBOUNCE_MS);
  };

  // SPA navigations often swap the title/heading shortly after the URL
  // changes, so look again once the page has had a moment to settle.
  const scheduleReadingUpdate = () => {
    queueReadingUpdate();
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(queueReadingUpdate, READING_RECHECK_MS);
  };

  installHistoryPatch();
  window.addEventListener("popstate", scheduleReadingUpdate);
  window.addEventListener("hashchange", scheduleReadingUpdate);
  window.addEventListener("pageshow", scheduleReadingUpdate);
  document.addEventListener("visibilitychange", scheduleReadingUpdate);
  window.addEventListener("focus", scheduleReadingUpdate);
  window.addEventListener("blur", scheduleReadingUpdate);
  window.addEventListener("townsquare:navigation", scheduleReadingUpdate);

  return () => {
    window.removeEventListener("popstate", scheduleReadingUpdate);
    window.removeEventListener("hashchange", scheduleReadingUpdate);
    window.removeEventListener("pageshow", scheduleReadingUpdate);
    document.removeEventListener("visibilitychange", scheduleReadingUpdate);
    window.removeEventListener("focus", scheduleReadingUpdate);
    window.removeEventListener("blur", scheduleReadingUpdate);
    window.removeEventListener("townsquare:navigation", scheduleReadingUpdate);
    clearTimeout(updateTimer);
    clearTimeout(recheckTimer);
    uninstallHistoryPatch();
  };
}
