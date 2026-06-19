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
 * Poll `callback` on an interval, pausing while the tab is hidden. Each tick
 * waits for the prior callback to finish so overlapping polls cannot race.
 *
 * @param {() => void | Promise<void>} callback
 * @param {number} intervalMs
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAutoRefresh(callback, intervalMs) {
  let timer = null;
  let active = false;
  let inFlight = false;
  let visibilityListener = null;

  async function tick() {
    if (!active || document.hidden || inFlight) return;
    inFlight = true;
    try {
      await callback();
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (!active) return;
    timer = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, intervalMs);
  }

  return {
    start() {
      if (active) return;
      active = true;
      void tick();
      scheduleNext();
      visibilityListener = () => {
        if (active && !document.hidden) void tick();
      };
      document.addEventListener("visibilitychange", visibilityListener);
    },
    stop() {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (visibilityListener) {
        document.removeEventListener("visibilitychange", visibilityListener);
        visibilityListener = null;
      }
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

const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persist a login credential across requests. By default it lives in
 * `sessionStorage` (forgotten when the tab closes); when the caller opts into
 * "remember me" it moves to `localStorage` with an expiry stamp so it survives
 * browser restarts but is dropped automatically after `ttlMs`.
 *
 * The credential `value` is opaque — a token string, password, or object —
 * wrapped as `{ value, expiresAt? }`. Legacy unwrapped entries are ignored, so
 * an older session simply prompts for login once.
 *
 * @param {string} key Storage key shared by both backing stores.
 * @param {{ ttlMs?: number }} [options]
 * @returns {{
 *   read: () => { value: any, remembered: boolean } | null,
 *   save: (value: any, remember: boolean) => void,
 *   clear: () => void,
 * }}
 */
export function createCredentialStore(key, { ttlMs = REMEMBER_TTL_MS } = {}) {
  function readEntry(storage, remembered) {
    let parsed;
    try {
      parsed = JSON.parse(storage.getItem(key) || "");
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || !("value" in parsed)) return null;
    if (remembered && typeof parsed.expiresAt === "number" && Date.now() > parsed.expiresAt) {
      storage.removeItem(key);
      return null;
    }
    return { value: parsed.value, remembered };
  }

  return {
    read() {
      return readEntry(localStorage, true) || readEntry(sessionStorage, false);
    },
    save(value, remember) {
      this.clear();
      if (remember) {
        localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
      } else {
        sessionStorage.setItem(key, JSON.stringify({ value }));
      }
    },
    clear() {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    },
  };
}
