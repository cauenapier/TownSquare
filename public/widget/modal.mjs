/**
 * Shared modal shell for widget features.
 */

/**
 * @typedef {Object} WidgetModal
 * @property {HTMLElement} overlay
 * @property {HTMLElement} panel
 * @property {HTMLElement} head
 * @property {HTMLElement} title
 * @property {HTMLButtonElement} closeButton
 * @property {HTMLButtonElement | null} trigger
 * @property {() => void} close
 */

/**
 * @typedef {import("./context.mjs").WidgetContext} WidgetContext
 */

/**
 * @param {WidgetContext} ctx
 * @param {{ className: string, ariaLabel: string, title: string, trigger?: HTMLButtonElement | null, onClose?: () => void }} options
 * @returns {WidgetModal}
 */
export function openWidgetModal(ctx, { className, ariaLabel, title, trigger = null, onClose }) {
  const overlay = document.createElement("div");
  overlay.className = className;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", ariaLabel);

  const backdrop = document.createElement("div");
  backdrop.className = `${className}__backdrop`;

  const panel = document.createElement("div");
  panel.className = `${className}__panel`;

  const head = document.createElement("div");
  head.className = `${className}__head`;

  const titleEl = document.createElement("span");
  titleEl.className = `${className}__title`;
  titleEl.textContent = title;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = `${className}__close`;
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "×";

  head.append(titleEl, closeButton);
  panel.appendChild(head);
  overlay.append(backdrop, panel);

  const modal = {
    overlay,
    panel,
    head,
    title: titleEl,
    closeButton,
    trigger,
    close() {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      onClose?.();
      if (trigger?.isConnected) trigger.focus();
    },
  };

  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    modal.close();
  };

  backdrop.addEventListener("click", modal.close);
  closeButton.addEventListener("click", modal.close);
  window.addEventListener("keydown", onKeyDown, true);
  ctx.app.appendChild(overlay);

  return modal;
}
