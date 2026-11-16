/**
 * Expanded (fullscreen) view controller, shared by the live widget and the dev
 * scene so both stay faithful to one another.
 *
 * It owns the expanded flag and the host-page scroll lock, keeps the expand
 * button's class/ARIA state in sync, refreshes the chat layer's linger limits
 * for the taller stage, and collapses on Escape.
 */

import { setExpandedView } from "./chat.mjs";
import { isTypingTarget } from "./utils.mjs";

/**
 * @param {{
 *   app: HTMLElement,
 *   expandButton: HTMLButtonElement,
 *   chatScope: import("./chat.mjs").ChatScope,
 *   getAvatars: () => import("./avatar.mjs").AvatarView[],
 *   onChange?: (expanded: boolean) => void,
 * }} options
 * @returns {{ setExpanded: (expanded: boolean) => void, isExpanded: () => boolean, destroy: () => void }}
 */
export function createExpandController({ app, expandButton, chatScope, getAvatars, onChange }) {
  let expanded = false;
  // Expanded mode overlays the host page, so lock its scroll while open and
  // restore whatever inline overflow it had before.
  let hostBodyOverflow = "";
  // Going fixed pulls the widget out of the page flow, so the document gets
  // shorter and the browser clamps its scroll offset. Remember where the
  // visitor was and put them back there on collapse, so the widget is still
  // in view instead of the page having jumped up.
  let hostScroll = null;

  const setExpanded = (next) => {
    const changed = next !== expanded;
    if (changed) {
      if (next) {
        hostScroll = { left: window.scrollX, top: window.scrollY };
        hostBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = hostBodyOverflow;
      }
    }
    expanded = next;
    app.classList.toggle("townsquare--expanded", expanded);
    if (changed && !expanded && hostScroll) {
      // The class change above restores the widget's in-flow height first.
      window.scrollTo({ ...hostScroll, behavior: "instant" });
      hostScroll = null;
    }
    expandButton.classList.toggle("townsquare__button--active", expanded);
    expandButton.setAttribute("aria-pressed", String(expanded));
    expandButton.setAttribute("aria-label", expanded ? "Collapse widget" : "Expand widget");
    setExpandedView(chatScope, expanded, getAvatars());
    onChange?.(expanded);
  };

  const onWindowKeyDown = (event) => {
    if (event.key !== "Escape" || !expanded) return;
    if (isTypingTarget(event.target)) return;
    setExpanded(false);
  };
  window.addEventListener("keydown", onWindowKeyDown);

  return {
    setExpanded,
    isExpanded: () => expanded,
    destroy() {
      window.removeEventListener("keydown", onWindowKeyDown);
      setExpanded(false);
    },
  };
}
