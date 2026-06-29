/**
 * Expanded (fullscreen) view controller, shared by the live widget and the dev
 * scene so both stay faithful to one another.
 *
 * It owns the expanded flag and the host-page scroll lock, keeps the expand
 * button's class/ARIA state in sync, refreshes the chat layer's linger limits
 * for the taller stage, and collapses on Escape.
 */

import { setExpandedView } from "./chat.mjs";

/**
 * @param {{
 *   app: HTMLElement,
 *   expandButton: HTMLButtonElement,
 *   chatScope: import("./chat.mjs").ChatScope,
 *   getAvatars: () => import("./dom.mjs").AvatarView[],
 *   onChange?: (expanded: boolean) => void,
 * }} options
 * @returns {{ setExpanded: (expanded: boolean) => void, isExpanded: () => boolean, destroy: () => void }}
 */
export function createExpandController({ app, expandButton, chatScope, getAvatars, onChange }) {
  let expanded = false;
  // Expanded mode overlays the host page, so lock its scroll while open and
  // restore whatever inline overflow it had before.
  let hostBodyOverflow = "";

  const setExpanded = (next) => {
    if (next !== expanded) {
      if (next) {
        hostBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = hostBodyOverflow;
      }
    }
    expanded = next;
    app.classList.toggle("townsquare--expanded", expanded);
    expandButton.classList.toggle("townsquare__control--active", expanded);
    expandButton.setAttribute("aria-pressed", String(expanded));
    expandButton.setAttribute("aria-label", expanded ? "Collapse widget" : "Expand widget");
    setExpandedView(chatScope, expanded, getAvatars());
    onChange?.(expanded);
  };

  const onWindowKeyDown = (event) => {
    if (event.key !== "Escape" || !expanded) return;
    if (event.target instanceof HTMLInputElement) return;
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
