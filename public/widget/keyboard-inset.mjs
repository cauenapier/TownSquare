/**
 * Mobile virtual-keyboard layout handling for the docked widget composer.
 */

const MOBILE_KEYBOARD_SCROLL_GAP = 12;
const MOBILE_KEYBOARD_MIN_HEIGHT = 60;

/**
 * @param {VisualViewport | undefined} viewport
 */
function getKeyboardInset(viewport) {
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

/**
 * When a docked mobile input focuses near the bottom of a long page, browsers
 * keep the input reachable but may still leave the square's lower edge behind
 * the virtual keyboard. Scroll the page just enough to reveal the whole widget.
 *
 * @param {HTMLElement} app
 * @param {VisualViewport | undefined} viewport
 * @param {boolean} expanded
 */
function revealAppAboveKeyboard(app, viewport, expanded) {
  if (!(app instanceof HTMLElement) || !viewport) return;
  if (!(document.activeElement instanceof HTMLElement) || !app.contains(document.activeElement)) return;
  const keyboardInset = getKeyboardInset(viewport);
  if (keyboardInset < MOBILE_KEYBOARD_MIN_HEIGHT) return;
  if (expanded) {
    const visibleBottom = viewport.offsetTop + viewport.height;
    const overlap = app.getBoundingClientRect().bottom + MOBILE_KEYBOARD_SCROLL_GAP - visibleBottom;
    if (overlap > 0) {
      app.scrollBy({ top: overlap, behavior: "auto" });
    }
    return;
  }
  const appBottom = window.scrollY + app.getBoundingClientRect().bottom;
  const visibleBottom = window.scrollY + viewport.offsetTop + viewport.height;
  const overlap = appBottom + MOBILE_KEYBOARD_SCROLL_GAP - visibleBottom;
  if (overlap > 0) {
    window.scrollBy({ top: overlap, behavior: "auto" });
  }
}

/**
 * @param {import("./context.mjs").WidgetContext} ctx
 * @param {{ isExpanded: () => boolean }} expandController
 * @returns {(() => void) & { refresh: () => void }}
 */
export function wireKeyboardInset(ctx, expandController) {
  const coarsePointer = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
  const viewport = window.visualViewport;

  const refresh = () => {
    const hidden = getKeyboardInset(viewport);
    const keyboardVisible = hidden >= MOBILE_KEYBOARD_MIN_HEIGHT;
    ctx.app.style.setProperty("--ts-keyboard", `${Math.round(hidden)}px`);
    ctx.app.style.setProperty(
      "--ts-keyboard-scroll-room",
      keyboardVisible && expandController.isExpanded() ? `${Math.round(hidden)}px` : "0px",
    );
    revealAppAboveKeyboard(ctx.app, viewport, expandController.isExpanded());
  };
  const refreshSoon = () => window.requestAnimationFrame(refresh);

  /** @type {(() => void) & { refresh: () => void }} */
  const dispose = Object.assign(() => {}, { refresh: refreshSoon });
  if (!coarsePointer || !viewport) return dispose;

  viewport.addEventListener("resize", refresh);
  viewport.addEventListener("scroll", refresh);
  ctx.app.addEventListener("focusin", refreshSoon);
  refresh();

  return Object.assign(() => {
    viewport.removeEventListener("resize", refresh);
    viewport.removeEventListener("scroll", refresh);
    ctx.app.removeEventListener("focusin", refreshSoon);
  }, { refresh: refreshSoon });
}
