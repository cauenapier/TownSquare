/**
 * Static scene/style preview for hosted registration and admin customization forms.
 */

import { mountTownSquare } from "../townsquare.mjs";

/**
 * @typedef {Object} CustomizationPreviewConfig
 * @property {import("../shared/site-config.mjs").SceneConfig} scene
 * @property {Record<string, string>} style Flat palette for the active preview theme.
 */

/**
 * @typedef {Object} CustomizationPreviewOptions
 * @property {HTMLElement | null} root
 * @property {(mode: "light" | "dark") => CustomizationPreviewConfig} readConfig
 * @property {string | (() => string)} readingLabel
 */

/**
 * @param {CustomizationPreviewOptions} options
 */
export function createCustomizationPreview({ root, readConfig, readingLabel }) {
  /** @type {import("../townsquare.mjs").TownSquareHandle | null} */
  let handle = null;
  /** @type {"light" | "dark"} */
  let mode = "light";

  function resolveReadingLabel() {
    return typeof readingLabel === "function" ? readingLabel() : readingLabel;
  }

  return {
    get mounted() {
      return handle !== null;
    },

    destroy() {
      handle?.destroy();
      handle = null;
    },

    mount({ remount = false } = {}) {
      if (!(root instanceof HTMLElement)) return;

      const { scene, style, connections = [], messageBoard } = readConfig(mode);
      if (handle && !remount) {
        handle.updateConfig({ scene, style, connections, messageBoard });
        return;
      }

      handle?.destroy();
      handle = mountTownSquare(root, {
        serverOrigin: window.location.origin,
        scene,
        style,
        connections,
        messageBoard,
        theme: mode,
        preview: true,
        readingLabel: resolveReadingLabel(),
        readingUrl: window.location.href,
      });
    },

    bindThemeToggle(buttons) {
      for (const button of buttons) {
        button.addEventListener("click", () => {
          mode = button.dataset.previewMode === "dark" ? "dark" : "light";
          for (const other of buttons) {
            const active = other === button;
            other.classList.toggle("is-active", active);
            other.setAttribute("aria-pressed", active ? "true" : "false");
          }
          this.mount({ remount: true });
        });
      }
    },
  };
}
