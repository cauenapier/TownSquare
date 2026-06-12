/**
 * Host-page navigation watching for the "currently reading" presence tag.
 *
 * Listens for full and SPA navigations (history API patching included) and
 * pushes debounced reading updates over the socket when the page changes.
 */

import { setAvatarProfile } from "./dom.mjs";
import { readCurrentPage } from "./utils.mjs";

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

const READING_DEBOUNCE_MS = 80;
const READING_RECHECK_MS = 400;

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
    if (nextPage.readingLabel === ctx.self.readingLabel && nextPage.readingUrl === ctx.self.readingUrl) return;

    ctx.self.readingLabel = nextPage.readingLabel;
    ctx.self.readingUrl = nextPage.readingUrl;
    setAvatarProfile(ctx.self.avatar, ctx.self);
    if (ctx.socket.readyState === WebSocket.OPEN && ctx.self.id) {
      ctx.socket.send(JSON.stringify({ type: "reading", ...nextPage }));
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

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const wrappedPushState = function townsquarePushState(...args) {
    const result = originalPushState.apply(this, args);
    window.dispatchEvent(new Event("townsquare:navigation"));
    return result;
  };
  const wrappedReplaceState = function townsquareReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event("townsquare:navigation"));
    return result;
  };
  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;
  window.addEventListener("popstate", scheduleReadingUpdate);
  window.addEventListener("hashchange", scheduleReadingUpdate);
  window.addEventListener("pageshow", scheduleReadingUpdate);
  document.addEventListener("visibilitychange", scheduleReadingUpdate);
  window.addEventListener("townsquare:navigation", scheduleReadingUpdate);

  return () => {
    window.removeEventListener("popstate", scheduleReadingUpdate);
    window.removeEventListener("hashchange", scheduleReadingUpdate);
    window.removeEventListener("pageshow", scheduleReadingUpdate);
    document.removeEventListener("visibilitychange", scheduleReadingUpdate);
    window.removeEventListener("townsquare:navigation", scheduleReadingUpdate);
    clearTimeout(updateTimer);
    clearTimeout(recheckTimer);
    if (history.pushState === wrappedPushState) history.pushState = originalPushState;
    if (history.replaceState === wrappedReplaceState) history.replaceState = originalReplaceState;
  };
}
