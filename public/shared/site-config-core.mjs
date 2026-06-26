/**
 * Pure, Node-safe scene + style configuration core.
 *
 * Extracted from site-config.mjs so the server (and any Node consumer) imports
 * only DOM-free logic. The browser-only form/render helpers live in
 * site-config.mjs, which re-exports everything here.
 */

const SAFE_COLOR_RE = /^[#(),.%\sA-Za-z0-9-]+$/;
export const STYLE_TRANSPARENT = "transparent";
export const POSITION_INPUT_MIN = 0;
export const POSITION_INPUT_MAX = 100;
export const POSITION_INPUT_STEP = 1;

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
export const STYLE_VAR_MAP = new Map(STYLE_FIELDS.map((field) => [field.key, field.cssVar]));

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

export function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function clampNumber(value, min, max, fallback) {
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

export function selectDefaultPositions(field, count) {
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

export function roundPosition(value) {
  return Number(Number(value).toFixed(4));
}

export function roundPercent(value) {
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
    `  ${scope}[data-townsquare-theme="auto"] {`,
    paletteDeclarations(next.dark),
    "  }",
    "}",
    stageSurfaceCss(scope),
  ].join("\n");
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
