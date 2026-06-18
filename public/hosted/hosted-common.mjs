/**
 * Shared runtime for the hosted dashboard pages (registration, site admin, and
 * service admin). They all POST JSON to the same API shape, render the same
 * status/error affordances, and poll for fresh data, so that scaffolding lives
 * here and each page keeps only its own render and action wiring.
 */

/**
 * Escape a string for safe interpolation into innerHTML.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {number | string | null | undefined} value Epoch ms or date string.
 * @param {string} [fallback] Shown when there is no timestamp yet.
 * @returns {string}
 */
export function formatTime(value, fallback = "Never") {
  if (!value) return fallback;
  return new Date(value).toLocaleString();
}

/**
 * POST a JSON payload and normalize the response into a result envelope.
 * Network failures resolve (rather than throw) as `{ ok: false, status: 0 }`.
 *
 * @param {string} path
 * @param {object} payload
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function postJson(path, payload) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: "Could not reach the server." } };
  }
}

/**
 * Build a setter for a `.hosted-status` element. Returns `(message, isError)`.
 *
 * @param {HTMLElement} el
 * @param {{ toggleHidden?: boolean }} [options] Hide the element on empty text.
 * @returns {(message: string, isError?: boolean) => void}
 */
export function createStatusSetter(el, { toggleHidden = false } = {}) {
  return (message, isError = false) => {
    el.textContent = message;
    if (toggleHidden) el.hidden = !message;
    el.classList.toggle("hosted-status--error", isError);
  };
}

/**
 * Poll `callback` on an interval, pausing while the tab is hidden.
 *
 * @param {() => void} callback
 * @param {number} intervalMs
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAutoRefresh(callback, intervalMs) {
  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (!document.hidden) callback();
      }, intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Set the text/error state of a `.hosted-status` element in one call.
 *
 * @param {HTMLElement} element
 * @param {string} message
 * @param {boolean} [isError]
 * @param {{ hideWhenEmpty?: boolean }} [options]
 */
export function setStatus(element, message, isError = false, { hideWhenEmpty = false } = {}) {
  element.textContent = message;
  element.classList.toggle("hosted-status--error", isError);
  if (hideWhenEmpty) {
    element.hidden = !message;
  }
}

/**
 * Write `value` into an input unless the user is actively editing it.
 *
 * @param {HTMLInputElement | HTMLTextAreaElement} input
 * @param {string} value
 */
export function setValueIfIdle(input, value) {
  if (document.activeElement !== input) {
    input.value = value;
  }
}

/**
 * Render `{ label, value }` entries as a `<dl>` definition list.
 *
 * @param {HTMLElement} container
 * @param {Array<{ label: string, value: unknown }>} entries
 */
export function renderDefinitionList(container, entries) {
  container.replaceChildren();
  const list = document.createElement("dl");

  for (const entry of entries) {
    const row = document.createElement("div");
    const key = document.createElement("dt");
    const value = document.createElement("dd");
    key.textContent = entry.label;
    value.textContent = String(entry.value);
    row.append(key, value);
    list.appendChild(row);
  }

  container.appendChild(list);
}
