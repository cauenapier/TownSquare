/**
 * Hosted/site-level scene + style configuration helpers.
 *
 * This keeps per-site customization deterministic across:
 * - registration/admin UIs
 * - embed snippets
 * - widget rendering
 * - server-side prop arbitration
 */

const SAFE_COLOR_RE = /^[#(),.%\sA-Za-z0-9-]+$/;
export const STYLE_TRANSPARENT = "transparent";
const POSITION_INPUT_MIN = 0;
const POSITION_INPUT_MAX = 100;
const POSITION_INPUT_STEP = 1;

export const SCENE_FIELDS = Object.freeze([
  Object.freeze({
    key: "benches",
    kind: "bench",
    itemLabel: "Bench",
    label: "Benches",
    inputName: "scene-benches",
    positionsKey: "benchXs",
    min: 0,
    max: 6,
    defaultValue: 2,
    start: 0.08,
    end: 0.86,
  }),
  Object.freeze({
    key: "trees",
    kind: "tree",
    itemLabel: "Tree",
    label: "Trees",
    inputName: "scene-trees",
    positionsKey: "treeXs",
    min: 0,
    max: 6,
    defaultValue: 1,
    start: 0.18,
    end: 0.9,
  }),
  Object.freeze({
    key: "lamps",
    kind: "lamp",
    itemLabel: "Lamp",
    label: "Lamps",
    inputName: "scene-lamps",
    positionsKey: "lampXs",
    min: 0,
    max: 4,
    defaultValue: 1,
    start: 0.16,
    end: 0.84,
  }),
]);

export const SCENE_BIRDS_FIELD = Object.freeze({
  key: "birds",
  itemLabel: "Bird",
  label: "Birds",
  inputName: "scene-birds",
  min: 0,
  max: 18,
  defaultValue: 3,
});

export const STYLE_MODES = Object.freeze(["light", "dark"]);

/** Sides a neighbouring-town signpost can stand on, in stage-space terms. */
export const CONNECTION_SIDES = Object.freeze(["left", "right"]);
/** Longest a town label may be before it is trimmed. */
export const CONNECTION_LABEL_MAX = 24;
/** Longest a connection URL may be before it is rejected. */
export const CONNECTION_URL_MAX = 200;
/** Most towns one signpost (one side) can point at — keeps the modal uncluttered. */
export const MAX_CONNECTIONS_PER_SIDE = 4;

/** Muted prop/bird/tree tone; kept in sync with `--prop-ink` in public/tokens.css. */
export const PROP_INK_MIX = "color-mix(in oklab, var(--text) 58%, var(--muted) 42%)";

// `defaultValue` is the light palette default; `darkValue` mirrors the dark
// tokens in public/tokens.css so a brand-new site's dark palette matches the
// stock dark theme out of the box.
export const STYLE_FIELDS = Object.freeze([
  Object.freeze({ key: "scene", label: "Background", defaultValue: "#e4e2dd", darkValue: "#242521", cssVar: "--scene", overrideUI: true }),
  Object.freeze({ key: "page", label: "Ground", defaultValue: "#efede9", darkValue: "#181917", cssVar: "--page", overrideUI: true }),
  Object.freeze({ key: "surface", label: "Buttons and Tags", defaultValue: "#fdf8f4", darkValue: "#24231f", cssVar: "--surface", overrideUI: true }),
  Object.freeze({ key: "ink", label: "Ink", defaultValue: "#2a2926", darkValue: "#f2eee6", cssVar: "--ink", overrideUI: true }),
  Object.freeze({ key: "accent", label: "Accent", defaultValue: "#c8641f", darkValue: "#df8a43", cssVar: "--you", overrideUI: true }),
  Object.freeze({ key: "treeTrunk", label: "Tree trunk", defaultValue: PROP_INK_MIX, darkValue: PROP_INK_MIX, cssVar: "--tree-trunk", overrideUI: true }),
  Object.freeze({ key: "treeCanopy", label: "Tree leaves", defaultValue: PROP_INK_MIX, darkValue: PROP_INK_MIX, cssVar: "--tree-canopy", overrideUI: true }),
  Object.freeze({ key: "other", label: "Other", defaultValue: "#26241f", darkValue: "#ddd7cc", cssVar: "--other", overrideUI: false }),
  Object.freeze({ key: "ground", label: "Ground line", defaultValue: "rgba(42, 41, 38, 0.16)", darkValue: "rgba(242, 238, 230, 0.18)", cssVar: "--ground", overrideUI: false }),
]);

const SCENE_FIELD_BY_KEY = new Map(SCENE_FIELDS.map((field) => [field.key, field]));
const STYLE_VAR_MAP = new Map(STYLE_FIELDS.map((field) => [field.key, field.cssVar]));

/**
 * Form input name for a style token in a given palette mode, e.g.
 * `style-light-accent` / `style-dark-accent`.
 *
 * @param {"light"|"dark"} mode
 * @param {{ key: string }} field
 * @returns {string}
 */
export function styleInputName(mode, field) {
  return `style-${mode}-${field.key}`;
}

const POSITION_PRESETS = Object.freeze({
  benches: Object.freeze([0.2, 0.72, 0.46, 0.08, 0.58, 0.86]),
  trees: Object.freeze([0.8, 0.58, 0.36, 0.9, 0.18, 0.68]),
  lamps: Object.freeze([0.12, 0.88, 0.36, 0.64]),
});

export const DEFAULT_SCENE_CONFIG = Object.freeze(buildDefaultSceneConfig());

export const DEFAULT_SITE_STYLE_LIGHT = Object.freeze(
  Object.fromEntries(STYLE_FIELDS.map((field) => [field.key, field.defaultValue])),
);

export const DEFAULT_SITE_STYLE_DARK = Object.freeze(
  Object.fromEntries(STYLE_FIELDS.map((field) => [field.key, field.darkValue])),
);

export const DEFAULT_SITE_STYLE = Object.freeze({
  light: DEFAULT_SITE_STYLE_LIGHT,
  dark: DEFAULT_SITE_STYLE_DARK,
});

const BENCH_SVG = `
  <svg viewBox="0 0 50 18" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <line x1="8" y1="8" x2="6" y2="17"></line>
    <line x1="42" y1="8" x2="44" y2="17"></line>
    <line x1="3" y1="8" x2="47" y2="8"></line>
    <line x1="6" y1="1" x2="6" y2="8"></line>
    <line x1="44" y1="1" x2="44" y2="8"></line>
    <line x1="6" y1="2" x2="44" y2="2"></line>
    <line x1="6" y1="5" x2="44" y2="5"></line>
  </svg>
`;

const LAMP_SVG = `
  <svg viewBox="0 0 20 56" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <line x1="3" y1="55" x2="11" y2="55"></line>
    <line x1="7" y1="55" x2="7" y2="10"></line>
    <path d="M7 10 C7 4 9 2 15 2"></path>
    <line x1="15" y1="2" x2="15" y2="5"></line>
    <path d="M12 5 L11 9 L19 9 L18 5 Z"></path>
  </svg>
`;

const TREE_SVG = `
  <svg viewBox="0 0 56 76" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path class="canopy" d="M13 44 C4 39 0 30 4 21 C7 14 12 9 17 8 C20 4 23 2 25 4 C27 1 29 1 31 4 C33 2 36 4 39 8 C44 9 49 14 52 21 C56 30 52 39 43 44 Z"></path>
    <path class="trunk" d="M25 44 L25 75 L31 75 L31 44 Z"></path>
  </svg>
`;

/** Stage width the pixel art sizes below were authored against. */
export const REFERENCE_STAGE_WIDTH = 743;

/** @type {Readonly<Record<string, { width: number, height: number }>>} */
const PROP_PX = Object.freeze({
  bench: { width: 52, height: 18 },
  lamp: { width: 20, height: 56 },
  tree: { width: 56, height: 76 },
});

/**
 * @typedef {Object} SceneProp
 * @property {string} id
 * @property {number} x
 * @property {number} width Render width in px.
 * @property {number} height Render height in px.
 * @property {string} [pose]
 * @property {Array<number>} [seats]
 * @property {boolean} [faceAway]
 * @property {number} [shadeRadius]
 * @property {number} [lightRadius]
 * @property {string} kind
 * @property {string} svg
 */

function buildDefaultSceneConfig() {
  const next = {};
  for (const field of SCENE_FIELDS) {
    next[field.key] = field.defaultValue;
    next[field.positionsKey] = Object.freeze(selectDefaultPositions(field, field.defaultValue));
  }
  next[SCENE_BIRDS_FIELD.key] = SCENE_BIRDS_FIELD.defaultValue;
  return next;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function evenPositions(count, start, end) {
  if (count <= 0) return [];
  if (count === 1) return [roundPosition((start + end) / 2)];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => roundPosition(start + step * index));
}

function selectDefaultPositions(field, count) {
  if (count <= 0) return [];
  const preset = POSITION_PRESETS[field.key] || [];
  if (count <= preset.length) return preset.slice(0, count).map(roundPosition);

  const extra = evenPositions(count - preset.length, field.start, field.end)
    .filter((x) => !preset.includes(x));
  return [...preset, ...extra].slice(0, count).map(roundPosition);
}

function sanitizePositionList(field, input, count) {
  const fallback = selectDefaultPositions(field, count);
  const raw = Array.isArray(input) ? input : [];
  return Array.from({ length: count }, (_, index) => roundPosition(
    clampNumber(raw[index], 0, 1, fallback[index] ?? fallback.at(-1) ?? 0.5),
  ));
}

function roundPosition(value) {
  return Number(Number(value).toFixed(4));
}

function roundPercent(value) {
  return Number(Number(value).toFixed(1));
}

function uniqueId(kind, index) {
  return index === 0 ? kind : `${kind}-${index + 1}`;
}

function createBench(index, x) {
  const { width, height } = PROP_PX.bench;
  return {
    id: uniqueId("bench", index),
    kind: "bench",
    x,
    width,
    height,
    pose: "sitting",
    seats: [-0.01, 0.01],
    svg: BENCH_SVG,
  };
}

function createLamp(index, x) {
  const { width, height } = PROP_PX.lamp;
  return {
    id: uniqueId("lamp", index),
    kind: "lamp",
    x,
    width,
    height,
    lightRadius: 0.045,
    svg: LAMP_SVG,
  };
}

function createTree(index, x) {
  const { width, height } = PROP_PX.tree;
  return {
    id: uniqueId("tree", index),
    kind: "tree",
    x,
    width,
    height,
    pose: "resting",
    seats: [-0.008, 0.008],
    faceAway: true,
    shadeRadius: 0.045,
    svg: TREE_SVG,
  };
}

export function getScenePositionInputName(sceneKey, index) {
  const field = SCENE_FIELD_BY_KEY.get(sceneKey);
  if (!field) throw new Error(`Unknown scene field: ${sceneKey}`);
  return `scene-${field.kind}-x-${index + 1}`;
}

export function isSceneCountInputName(name = "") {
  return SCENE_FIELDS.some((field) => field.inputName === name)
    || name === SCENE_BIRDS_FIELD.inputName;
}

export function sanitizeSceneConfig(input = {}) {
  const base = isPlainObject(input) ? input : {};
  const next = {};

  for (const field of SCENE_FIELDS) {
    const count = clampInt(base[field.key], field.min, field.max, field.defaultValue);
    next[field.key] = count;
    next[field.positionsKey] = sanitizePositionList(field, base[field.positionsKey], count);
  }

  next[SCENE_BIRDS_FIELD.key] = clampInt(
    base[SCENE_BIRDS_FIELD.key],
    SCENE_BIRDS_FIELD.min,
    SCENE_BIRDS_FIELD.max,
    SCENE_BIRDS_FIELD.defaultValue,
  );

  return next;
}

/**
 * Coerce a user-entered destination into a safe absolute http(s) URL, or "".
 * Bare hosts (`example.com`) are upgraded to `https://`; anything that is not
 * http/https after parsing (e.g. `javascript:`) is rejected.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeConnectionUrl(value) {
  if (typeof value !== "string") return "";
  let trimmed = value.trim().slice(0, CONNECTION_URL_MAX);
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * The bare hostname of a URL (with a leading `www.` stripped), or the original
 * string if it does not parse. Used for default labels and the modal subtitle.
 *
 * @param {string} url
 * @returns {string}
 */
export function hostnameLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * @typedef {Object} Connection
 * @property {"left"|"right"} side Stage edge the signpost stands on.
 * @property {string} label Display name of the linked town.
 * @property {string} url Destination the visitor walks to.
 */

/**
 * Sanitize a list of neighbouring-town connections. Drops entries without a
 * valid side or destination, defaults a missing label to the destination host,
 * and caps each side at {@link MAX_CONNECTIONS_PER_SIDE}.
 *
 * @param {unknown} input
 * @returns {Array<Connection>}
 */
export function sanitizeConnections(input = []) {
  const list = Array.isArray(input) ? input : [];
  const perSide = { left: 0, right: 0 };
  const next = [];

  for (const raw of list) {
    if (!isPlainObject(raw)) continue;

    const side = CONNECTION_SIDES.includes(raw.side) ? raw.side : null;
    if (!side || perSide[side] >= MAX_CONNECTIONS_PER_SIDE) continue;

    const url = sanitizeConnectionUrl(raw.url);
    if (!url) continue;

    const rawLabel = typeof raw.label === "string" ? raw.label.trim() : "";
    const label = (rawLabel || hostnameLabel(url)).slice(0, CONNECTION_LABEL_MAX);

    perSide[side] += 1;
    next.push({ side, label, url });
  }

  return next;
}

/**
 * Group sanitized connections by the side their signpost stands on.
 *
 * @param {unknown} input
 * @returns {{ left: Array<Connection>, right: Array<Connection> }}
 */
export function connectionsBySide(input = []) {
  const grouped = { left: [], right: [] };
  for (const connection of sanitizeConnections(input)) {
    grouped[connection.side].push(connection);
  }
  return grouped;
}

export function isTransparentStyleValue(value) {
  return typeof value === "string" && value.trim().toLowerCase() === STYLE_TRANSPARENT;
}

/**
 * Sanitize one flat palette (the 7 style tokens) against a set of defaults.
 *
 * @param {Record<string, unknown>} input
 * @param {Record<string, string>} [defaults=DEFAULT_SITE_STYLE_LIGHT]
 * @returns {Record<string, string>}
 */
export function sanitizeStylePalette(input = {}, defaults = DEFAULT_SITE_STYLE_LIGHT) {
  const base = isPlainObject(input) ? input : {};
  const next = {};
  for (const { key } of STYLE_FIELDS) {
    const fallback = defaults[key];
    const value = typeof base[key] === "string" ? base[key].trim() : "";
    if (isTransparentStyleValue(value)) {
      next[key] = STYLE_TRANSPARENT;
      continue;
    }
    next[key] = value && value.length <= 64 && SAFE_COLOR_RE.test(value) ? value : fallback;
  }
  return next;
}

/**
 * Normalize a stored/site style config into `{ light, dark }`. A legacy flat
 * config (no `light`/`dark` keys) is read as the light palette; dark falls back
 * to the stock dark defaults.
 *
 * @param {unknown} input
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function sanitizeSiteStyle(input = {}) {
  const base = isPlainObject(input) ? input : {};
  const hasModes = isPlainObject(base.light) || isPlainObject(base.dark);
  const lightInput = hasModes ? base.light : base;
  const darkInput = hasModes ? base.dark : null;
  return {
    light: sanitizeStylePalette(lightInput, DEFAULT_SITE_STYLE_LIGHT),
    dark: sanitizeStylePalette(darkInput || {}, DEFAULT_SITE_STYLE_DARK),
  };
}

export function readSceneConfigFromForm(form) {
  const formData = new FormData(form);
  const next = {};

  for (const field of SCENE_FIELDS) {
    const count = clampInt(formData.get(field.inputName), field.min, field.max, field.defaultValue);
    const fallbackPositions = selectDefaultPositions(field, count);
    next[field.key] = count;
    next[field.positionsKey] = Array.from({ length: count }, (_, index) => {
      const fallbackPercent = (fallbackPositions[index] ?? 0.5) * 100;
      const percent = clampNumber(
        formData.get(getScenePositionInputName(field.key, index)),
        POSITION_INPUT_MIN,
        POSITION_INPUT_MAX,
        fallbackPercent,
      );
      return roundPosition(percent / 100);
    });
  }

  next[SCENE_BIRDS_FIELD.key] = clampInt(
    formData.get(SCENE_BIRDS_FIELD.inputName),
    SCENE_BIRDS_FIELD.min,
    SCENE_BIRDS_FIELD.max,
    SCENE_BIRDS_FIELD.defaultValue,
  );

  return next;
}

export function readStyleConfigFromForm(form) {
  const formData = new FormData(form);
  const readPalette = (mode) => Object.fromEntries(
    STYLE_FIELDS.map((field) => {
      const name = styleInputName(mode, field);
      const hiddenInput = form.querySelector(`input[type="hidden"][name="${name}"]`);
      const raw = hiddenInput instanceof HTMLInputElement
        ? hiddenInput.value
        : formData.get(name);
      return [field.key, String(raw || "").trim()];
    }),
  );
  return { light: readPalette("light"), dark: readPalette("dark") };
}

export function applySceneConfigToForm(form, config = {}) {
  for (const field of SCENE_FIELDS) {
    const input = form.elements.namedItem(field.inputName);
    if (input && "value" in input) {
      input.value = String(config[field.key] ?? field.defaultValue);
    }

    const positions = Array.isArray(config[field.positionsKey]) ? config[field.positionsKey] : [];
    positions.forEach((x, index) => {
      const positionInput = form.elements.namedItem(getScenePositionInputName(field.key, index));
      if (positionInput && "value" in positionInput) {
        positionInput.value = String(roundPercent(x * 100));
      }
    });
  }

  const birdsInput = form.elements.namedItem(SCENE_BIRDS_FIELD.inputName);
  if (birdsInput && "value" in birdsInput) {
    birdsInput.value = String(config[SCENE_BIRDS_FIELD.key] ?? SCENE_BIRDS_FIELD.defaultValue);
  }

  syncSceneCountProse(form);
}

export function applyConfigToForm(form, config = {}) {
  applySceneConfigToForm(form, config);

  for (const mode of STYLE_MODES) {
    const palette = isPlainObject(config[mode]) ? config[mode] : {};
    const defaults = mode === "dark" ? DEFAULT_SITE_STYLE_DARK : DEFAULT_SITE_STYLE_LIGHT;
    for (const field of STYLE_FIELDS) {
      const name = styleInputName(mode, field);
      const input = form.querySelector(`input[type="hidden"][name="${name}"]`)
        ?? form.elements.namedItem(name);
      if (input && "value" in input) {
        input.value = String(palette[field.key] ?? defaults[field.key]);
      }
    }
  }

  syncStyleColorFields(form);
}

export function getSceneCountNoun(field, count) {
  const n = Number(count);
  const singular = field.itemLabel.toLowerCase();
  const plural = field.label.toLowerCase();
  return n === 1 ? singular : plural;
}

export function syncSceneCountProse(form) {
  if (!(form instanceof HTMLFormElement)) return;

  for (const field of SCENE_FIELDS) {
    const input = form.elements.namedItem(field.inputName);
    if (!(input instanceof HTMLInputElement)) continue;

    const noun = input.closest(".scene-count")?.querySelector(".scene-count__noun");
    if (!(noun instanceof HTMLElement)) continue;

    const singular = noun.dataset.singular || field.itemLabel.toLowerCase();
    const plural = noun.dataset.plural || field.label.toLowerCase();
    const count = Number(input.value);
    noun.textContent = count === 1 ? singular : plural;
  }

  const birdsInput = form.elements.namedItem(SCENE_BIRDS_FIELD.inputName);
  if (birdsInput instanceof HTMLInputElement) {
    const noun = birdsInput.closest(".scene-count")?.querySelector(".scene-count__noun");
    if (noun instanceof HTMLElement) {
      const singular = noun.dataset.singular || SCENE_BIRDS_FIELD.itemLabel.toLowerCase();
      const plural = noun.dataset.plural || SCENE_BIRDS_FIELD.label.toLowerCase();
      const count = Number(birdsInput.value);
      noun.textContent = count === 1 ? singular : plural;
    }
  }
}

export function bindSceneCountProse(form) {
  if (!(form instanceof HTMLFormElement)) return;

  const prose = form.querySelector(".scene-counts");
  if (!(prose instanceof HTMLElement)) return;
  if (prose.dataset.sceneCountBound === "true") return;
  prose.dataset.sceneCountBound = "true";

  const sync = () => syncSceneCountProse(form);
  for (const field of SCENE_FIELDS) {
    const input = form.elements.namedItem(field.inputName);
    if (input instanceof HTMLInputElement) {
      input.addEventListener("input", sync);
    }
  }
  const birdsInput = form.elements.namedItem(SCENE_BIRDS_FIELD.inputName);
  if (birdsInput instanceof HTMLInputElement) {
    birdsInput.addEventListener("input", sync);
  }
  sync();
}

export function bindStyleColorFields(form) {
  if (!(form instanceof HTMLFormElement)) return;

  for (const mode of STYLE_MODES) {
    for (const field of STYLE_FIELDS) {
      const fieldDefault = mode === "dark" ? field.darkValue : field.defaultValue;
      const valueInput = form.querySelector(`input[type="hidden"][name="${styleInputName(mode, field)}"]`);
      if (!(valueInput instanceof HTMLInputElement)) continue;

      const control = valueInput.closest(".hosted-color-control");
      if (!(control instanceof HTMLElement)) continue;

      if (control.dataset.styleColorBound === "true") continue;
      control.dataset.styleColorBound = "true";

      const picker = control.querySelector("[data-style-picker]");
      const clearButton = control.querySelector("[data-style-clear]");
      const swatch = control.querySelector(".hosted-color-swatch");

      const syncFromValue = () => {
        syncStyleColorControlUI({ control, valueInput, picker, clearButton, fieldDefault });
      };

      if (picker instanceof HTMLInputElement) {
        picker.addEventListener("input", () => {
          valueInput.value = picker.value;
          syncFromValue();
          valueInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      if (swatch instanceof HTMLLabelElement) {
        swatch.addEventListener("click", (event) => {
          if (!isTransparentStyleValue(valueInput.value)) return;
          event.preventDefault();
          valueInput.value = fieldDefault;
          if (picker instanceof HTMLInputElement) {
            picker.value = fieldDefault;
            syncFromValue();
            picker.click();
          }
          valueInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      if (clearButton instanceof HTMLButtonElement) {
        clearButton.addEventListener("click", () => {
          const makeTransparent = !isTransparentStyleValue(valueInput.value);
          valueInput.value = makeTransparent ? STYLE_TRANSPARENT : fieldDefault;
          if (!makeTransparent && picker instanceof HTMLInputElement) {
            picker.value = fieldDefault;
          }
          syncFromValue();
          valueInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      syncFromValue();
    }
  }
}

function syncStyleColorControlUI({ control, valueInput, picker, clearButton, fieldDefault }) {
  const transparent = isTransparentStyleValue(valueInput.value);
  const swatch = control.querySelector(".hosted-color-swatch");

  if (picker instanceof HTMLInputElement) {
    picker.disabled = transparent;
    if (!transparent && /^#[0-9a-f]{6}$/i.test(valueInput.value)) {
      picker.value = valueInput.value;
    }
  }

  if (swatch instanceof HTMLLabelElement) {
    if (transparent) {
      swatch.removeAttribute("for");
      swatch.title = "Transparent — click to set a color";
    } else {
      swatch.htmlFor = picker instanceof HTMLInputElement ? picker.id : "";
      swatch.removeAttribute("title");
    }
  }

  if (clearButton instanceof HTMLButtonElement) {
    clearButton.setAttribute("aria-pressed", transparent ? "true" : "false");
    clearButton.title = transparent
      ? "Transparent (no color) — click to set a color"
      : "Set transparent (no color)";
    clearButton.setAttribute(
      "aria-label",
      transparent
        ? "Transparent, no color set; click to choose a color"
        : "Set this color to transparent (no color)",
    );
  }

  control.classList.toggle("hosted-color-control--transparent", transparent);
}

export function syncStyleColorFields(form) {
  if (!(form instanceof HTMLFormElement)) return;

  for (const mode of STYLE_MODES) {
    for (const field of STYLE_FIELDS) {
      const fieldDefault = mode === "dark" ? field.darkValue : field.defaultValue;
      const valueInput = form.querySelector(`input[type="hidden"][name="${styleInputName(mode, field)}"]`);
      if (!(valueInput instanceof HTMLInputElement)) continue;

      const control = valueInput.closest(".hosted-color-control");
      if (!(control instanceof HTMLElement)) continue;

      const picker = control.querySelector("[data-style-picker]");
      const clearButton = control.querySelector("[data-style-clear]");
      syncStyleColorControlUI({ control, valueInput, picker, clearButton, fieldDefault });
    }
  }
}

const STYLE_OVERRIDE_FIELDS = STYLE_FIELDS.filter((field) => field.overrideUI);

function stylePickerValue(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#7c766c";
}

function createStyleColorControl(mode, field) {
  const defaultValue = mode === "dark" ? field.darkValue : field.defaultValue;
  const inputName = styleInputName(mode, field);
  const modeLabel = mode === "dark" ? "Dark" : "Light";

  const control = document.createElement("div");
  control.className = "hosted-color-control";

  const swatchLabel = document.createElement("label");
  swatchLabel.className = "hosted-color-swatch";

  const picker = document.createElement("input");
  picker.type = "color";
  picker.id = inputName;
  picker.value = stylePickerValue(defaultValue);
  picker.dataset.stylePicker = inputName;

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = inputName;
  hidden.value = defaultValue;

  const state = document.createElement("span");
  state.className = "hosted-color-swatch__state";
  state.setAttribute("aria-hidden", "true");
  state.textContent = "None";

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "hosted-color-none";
  clearButton.dataset.styleClear = inputName;
  clearButton.setAttribute("aria-pressed", "false");
  clearButton.setAttribute("aria-label", `Set ${modeLabel.toLowerCase()} ${field.label.toLowerCase()} to transparent (no color)`);
  clearButton.title = "Set transparent (no color)";
  clearButton.textContent = "None";

  swatchLabel.htmlFor = inputName;
  swatchLabel.append(state, picker);
  control.append(swatchLabel, hidden, clearButton);
  return control;
}

export function renderStyleOverrideFields(container) {
  if (!(container instanceof HTMLElement)) return;

  container.replaceChildren();
  container.className = "hosted-style-matrix";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Style color overrides");

  const head = document.createElement("div");
  head.className = "hosted-style-matrix__head";
  head.setAttribute("aria-hidden", "true");

  const tokenHead = document.createElement("span");
  tokenHead.className = "hosted-style-matrix__token";

  const lightHead = document.createElement("span");
  lightHead.textContent = "Light";

  const darkHead = document.createElement("span");
  darkHead.textContent = "Dark";

  head.append(tokenHead, lightHead, darkHead);
  container.appendChild(head);

  for (const field of STYLE_OVERRIDE_FIELDS) {
    const row = document.createElement("div");
    row.className = "hosted-style-matrix__row";

    const label = document.createElement("span");
    label.className = "hosted-style-matrix__label";
    label.textContent = field.label;

    const lightCell = document.createElement("div");
    lightCell.className = "hosted-style-matrix__cell";
    lightCell.dataset.mode = "Light";
    lightCell.appendChild(createStyleColorControl("light", field));

    const darkCell = document.createElement("div");
    darkCell.className = "hosted-style-matrix__cell";
    darkCell.dataset.mode = "Dark";
    darkCell.appendChild(createStyleColorControl("dark", field));

    row.append(label, lightCell, darkCell);
    container.appendChild(row);
  }
}

export function getScenePositionGroups(sceneConfig = {}) {
  const scene = sanitizeSceneConfig(sceneConfig);
  return SCENE_FIELDS.map((field) => ({
    key: field.key,
    label: `${field.label} placement`,
    helper: `Each bracketed value is a percentage from left (0) to right (100).`,
    items: scene[field.positionsKey].map((x, index) => ({
      key: `${field.kind}-${index + 1}`,
      label: `${field.itemLabel} ${index + 1} position`,
      displayLabel: `${field.itemLabel} ${index + 1}`.toLowerCase(),
      inputName: getScenePositionInputName(field.key, index),
      min: POSITION_INPUT_MIN,
      max: POSITION_INPUT_MAX,
      step: POSITION_INPUT_STEP,
      value: roundPercent(x * 100),
    })),
  })).filter((group) => group.items.length > 0);
}

function appendInlineNumberField(parent, item) {
  const open = document.createElement("span");
  open.className = "scene-inline__slot";
  open.setAttribute("aria-hidden", "true");
  open.textContent = "[";

  const input = document.createElement("input");
  input.name = item.inputName;
  input.type = "number";
  input.min = String(item.min);
  input.max = String(item.max);
  input.step = String(item.step);
  input.value = String(item.value);
  input.inputMode = "numeric";
  input.setAttribute("aria-label", `${item.label} position`);

  const close = document.createElement("span");
  close.className = "scene-inline__slot";
  close.setAttribute("aria-hidden", "true");
  close.textContent = "]";

  parent.append(open, input, close);
}

export function renderScenePositionFields(container, sceneConfig = {}) {
  if (!(container instanceof HTMLElement)) return;
  const groups = getScenePositionGroups(sceneConfig);
  container.replaceChildren();

  if (groups.length === 0) {
    const note = document.createElement("p");
    note.className = "hosted-note";
    note.textContent = "Add at least one prop above to place it manually.";
    container.appendChild(note);
    return;
  }

  const hint = document.createElement("p");
  hint.className = "hosted-note hosted-position-hint";
  hint.textContent = groups[0].helper;
  container.appendChild(hint);

  for (const group of groups) {
    const prose = document.createElement("p");
    prose.className = "scene-placements";

    const run = document.createElement("span");
    run.className = "scene-placements__run";

    group.items.forEach((item, index) => {
      const isLast = index === group.items.length - 1;

      if (isLast && group.items.length > 1) {
        const and = document.createElement("span");
        and.className = "scene-placements__and";
        and.textContent = "and";
        run.appendChild(and);
      }

      const chunk = document.createElement("span");
      chunk.className = `scene-placements__chunk${isLast ? " scene-placements__chunk--last" : ""}`;

      const label = document.createElement("span");
      label.className = "scene-placement__label";
      label.textContent = item.displayLabel;

      const at = document.createElement("span");
      at.className = "scene-placement__at";
      at.textContent = " at ";

      const placement = document.createElement("span");
      placement.className = "scene-placement";
      appendInlineNumberField(placement, item);

      const unit = document.createElement("span");
      unit.className = "scene-placement__unit";
      unit.setAttribute("aria-hidden", "true");
      unit.textContent = "%";

      chunk.append(label, at, placement, unit);
      run.appendChild(chunk);

      if (!isLast) {
        const sep = document.createElement("span");
        sep.className = "scene-placements__sep";
        sep.textContent = ",";
        run.appendChild(sep);
      } else {
        const end = document.createElement("span");
        end.className = "scene-placements__end";
        end.textContent = ".";
        run.appendChild(end);
      }
    });

    prose.appendChild(run);
    container.appendChild(prose);
  }
}

export function buildSceneProps(config = DEFAULT_SCENE_CONFIG) {
  const scene = sanitizeSceneConfig(config);
  const props = [];

  scene.lampXs.forEach((x, index) => {
    props.push(createLamp(index, x));
  });
  scene.benchXs.forEach((x, index) => {
    props.push(createBench(index, x));
  });
  scene.treeXs.forEach((x, index) => {
    props.push(createTree(index, x));
  });

  return props.sort((a, b) => a.x - b.x);
}

export function buildBirdPerches(props = []) {
  const perches = [];
  for (const prop of props) {
    if (prop.kind === "bench") {
      perches.push(
        { id: `${prop.id}-left`, propId: prop.id, offsetX: -0.014, liftPx: 18, x: Number((prop.x - 0.014).toFixed(4)) },
        { id: `${prop.id}-right`, propId: prop.id, offsetX: 0.014, liftPx: 18, x: Number((prop.x + 0.014).toFixed(4)) },
      );
      continue;
    }

    if (prop.kind === "tree") {
      perches.push({
        id: `${prop.id}-branch`,
        propId: prop.id,
        offsetX: 0,
        liftPx: 44,
        x: prop.x,
      });
      continue;
    }
  }
  return perches;
}

/**
 * Apply one flat palette to a root element as inline CSS variables. Used by the
 * registration/admin live preview. Sets `data-townsquare-surface` so the shared
 * widget paints the stage; hosted embeds rely on pasted CSS from buildSiteCss.
 *
 * @param {HTMLElement} root
 * @param {Record<string, string>} [palette=DEFAULT_SITE_STYLE_LIGHT]
 */
export function applySiteStyle(root, palette = DEFAULT_SITE_STYLE_LIGHT) {
  const next = sanitizeStylePalette(palette, DEFAULT_SITE_STYLE_LIGHT);
  for (const [key, cssVar] of STYLE_VAR_MAP) {
    root.style.setProperty(cssVar, next[key]);
  }
  root.style.setProperty("--scene-edge", "color-mix(in oklab, var(--scene) 88%, var(--page) 12%)");
  root.style.setProperty("--you-deep", next.accent);
  root.style.setProperty("--text", next.ink);
  root.style.setProperty("--muted", next.ink);
  root.dataset.townsquareSurface = "";
}

function stageSurfaceCss(scope) {
  return [
    `${scope} .townsquare__stage {`,
    "  background: linear-gradient(",
    "    180deg,",
    "    var(--scene) 0%,",
    "    var(--scene) 72%,",
    "    var(--scene-edge) 72%,",
    "    var(--page) 72.4%,",
    "    var(--page) 100%",
    "  );",
    "}",
    `${scope} .townsquare__ground {`,
    "  background: var(--ground);",
    "}",
  ].join("\n");
}

function paletteDeclarations(palette) {
  const lines = [];
  for (const [key, cssVar] of STYLE_VAR_MAP) {
    lines.push(`  ${cssVar}: ${palette[key]};`);
  }
  lines.push("  --scene-edge: color-mix(in oklab, var(--scene) 88%, var(--page) 12%);");
  lines.push("  --you-deep: var(--you);");
  lines.push("  --text: var(--ink);");
  lines.push("  --muted: var(--ink);");
  return lines.join("\n");
}

/**
 * Build the scoped CSS a hosted site pastes into its page. Emits separate light
 * and dark palettes. The selector is doubled (e.g. `#townsquare-root#townsquare-root`)
 * so its specificity beats the stock light/dark token rules in tokens.css in
 * every theme state (light, explicit dark, and auto/`prefers-color-scheme`).
 *
 * @param {unknown} style A `{ light, dark }` site style config (legacy flat is normalized).
 * @param {string} [selector="#townsquare-root"]
 * @returns {string}
 */
export function buildSiteCss(style = DEFAULT_SITE_STYLE, selector = "#townsquare-root") {
  const next = sanitizeSiteStyle(style);
  const scope = `${selector}${selector}`;
  return [
    `${scope} {`,
    paletteDeclarations(next.light),
    "}",
    `${scope}[data-townsquare-theme="dark"] {`,
    paletteDeclarations(next.dark),
    "}",
    "@media (prefers-color-scheme: dark) {",
    `  ${scope}:is(:not([data-townsquare-theme]), [data-townsquare-theme="auto"]) {`,
    paletteDeclarations(next.dark),
    "  }",
    "}",
    stageSurfaceCss(scope),
  ].join("\n");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
