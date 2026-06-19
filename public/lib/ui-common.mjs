/**
 * Small DOM helpers shared across the host pages and dev tooling.
 */

/** How long a copy button shows its confirmation label before reverting. */
const COPY_FEEDBACK_MS = 1200;
const SVG_NS = "http://www.w3.org/2000/svg";

export function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

/**
 * Wire a "copy to clipboard" button: copies the given text, flips the label to
 * a confirmation, then restores it. If the clipboard write fails and a `source`
 * field is given, it selects that field so the user can copy manually.
 *
 * @param {HTMLElement | string | null} button Button element or its id.
 * @param {{
 *   text: () => string,
 *   source?: HTMLInputElement | HTMLTextAreaElement,
 *   copiedLabel?: string,
 *   failedLabel?: string,
 * }} options
 */
export function bindCopy(button, { text, source, copiedLabel = "Copied", failedLabel } = {}) {
  const el = typeof button === "string" ? document.getElementById(button) : button;
  if (!el) return;

  const originalText = el.textContent;
  const flash = (label) => {
    el.textContent = label;
    setTimeout(() => { el.textContent = originalText; }, COPY_FEEDBACK_MS);
  };

  el.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
    } catch {
      if (source) {
        source.focus();
        source.select();
      } else if (failedLabel) {
        flash(failedLabel);
      }
      return;
    }
    flash(copiedLabel);
  });
}
