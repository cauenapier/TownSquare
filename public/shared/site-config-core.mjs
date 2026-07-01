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

/** Board art the owner can pick for their message board prop. */
export const MESSAGE_BOARD_VARIANTS = Object.freeze(["corkboard", "chalkboard", "sign"]);
/** Longest a message-board title may be before it is trimmed. */
export const MESSAGE_BOARD_TITLE_MAX = 80;
/** Longest a message-board body may be before it is trimmed. */
export const MESSAGE_BOARD_BODY_MAX = 1000;

/** Muted prop/bird/tree tone; kept in sync with `--prop-ink` in public/tokens.css. */
export const PROP_INK_MIX = "color-mix(in oklab, var(--text) 58%, var(--muted) 42%)";

// `defaultValue` is the light palette default; `darkValue` mirrors the dark
// tokens in public/tokens.css so a brand-new site's dark palette matches the
// stock dark theme out of the box.
export const STYLE_FIELDS = Object.freeze([
  // The sky above the ground line. Renamed from "scene" → "sky" (clearer for
  // owners); `legacyKey` keeps older stored palettes keyed "scene" loading, and
  // `cssVar` stays `--scene` so CSS already pasted into hosted pages still wins.
  Object.freeze({ key: "sky", legacyKey: "scene", label: "Sky", defaultValue: "#e4e2dd", darkValue: "#242521", cssVar: "--scene", overrideUI: true }),
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

// A notice sign on a single post — same silhouette as the edge signposts but
// with a square panel instead of a pointed flag. The `--<variant>` class fills
// the panel differently in CSS; the line-art frame is shared.
const MESSAGE_BOARD_SVG = `
  <svg viewBox="0 0 26 44" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <line x1="13" y1="18" x2="13" y2="43"></line>
    <rect class="panel" x="4" y="3" width="18" height="15"></rect>
    <line class="note" x1="8" y1="8" x2="18" y2="8"></line>
    <line class="note" x1="8" y1="11" x2="18" y2="11"></line>
    <line class="note" x1="8" y1="14" x2="14" y2="14"></line>
  </svg>
`;

/** Stage width the pixel art sizes below were authored against. */
export const REFERENCE_STAGE_WIDTH = 743;

/** @type {Readonly<Record<string, { width: number, height: number }>>} */
const PROP_PX = Object.freeze({
  bench: { width: 52, height: 18 },
  lamp: { width: 20, height: 56 },
  tree: { width: 56, height: 76 },
  "message-board": { width: 18, height: 30 },
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

/**
 * Build the render-ready message-board prop from a sanitized board config, or
 * `null` when the board is disabled. Shaped like a {@link SceneProp} so the
 * widget renderer can place it on the stage, but kept out of {@link buildSceneProps}
 * because it is a single optional object rather than a count-based scene field.
 *
 * @param {ReturnType<typeof sanitizeMessageBoard>} board
 * @returns {(SceneProp & { variant: string, accent: string }) | null}
 */
export function createMessageBoardProp(board) {
  if (!board || !board.enabled) return null;
  const { width, height } = PROP_PX["message-board"];
  return {
    id: "message-board",
    kind: "message-board",
    x: board.x,
    width,
    height,
    variant: board.variant,
    accent: board.accent,
    svg: MESSAGE_BOARD_SVG,
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

/**
 * @typedef {Object} MessageBoard
 * @property {boolean} enabled Whether the board is shown (true once it has text).
 * @property {number} x Normalized stage position (0 left … 1 right).
 * @property {string} variant One of {@link MESSAGE_BOARD_VARIANTS}.
 * @property {string} accent Owner accent color, or "" to inherit the palette.
 * @property {string} title Heading shown in the board modal.
 * @property {string} body Message text shown in the board modal.
 */

/** A disabled, blank board — the default for sites that never set one up. */
export const DEFAULT_MESSAGE_BOARD = Object.freeze({
  enabled: false,
  x: 0.5,
  variant: MESSAGE_BOARD_VARIANTS[0],
  accent: "",
  title: "",
  body: "",
});

/**
 * Normalize an owner's message-board config. Always returns a complete object;
 * `enabled` is true only when there is a non-empty title or body so an empty
 * board never renders. Mirrors the validation used by scene positions and the
 * style palette (clamped x, allow-listed variant, color-safe accent).
 *
 * @param {unknown} input
 * @returns {MessageBoard}
 */
export function sanitizeMessageBoard(input = {}) {
  const base = isPlainObject(input) ? input : {};

  const x = roundPosition(clampNumber(base.x, 0, 1, DEFAULT_MESSAGE_BOARD.x));
  const variant = MESSAGE_BOARD_VARIANTS.includes(base.variant)
    ? base.variant
    : DEFAULT_MESSAGE_BOARD.variant;

  const rawAccent = typeof base.accent === "string" ? base.accent.trim() : "";
  let accent = "";
  if (isTransparentStyleValue(rawAccent)) {
    accent = STYLE_TRANSPARENT;
  } else if (rawAccent && rawAccent.length <= 64 && SAFE_COLOR_RE.test(rawAccent)) {
    accent = rawAccent;
  }

  const title = (typeof base.title === "string" ? base.title.trim() : "").slice(0, MESSAGE_BOARD_TITLE_MAX);
  const body = (typeof base.body === "string" ? base.body.trim() : "").slice(0, MESSAGE_BOARD_BODY_MAX);

  return { enabled: Boolean(title || body), x, variant, accent, title, body };
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
  for (const { key, legacyKey } of STYLE_FIELDS) {
    const fallback = defaults[key];
    // Read the current key; fall back to a renamed field's old key so palettes
    // stored before the rename keep their colour. Re-saves emit only `key`.
    const raw =
      typeof base[key] === "string"
        ? base[key]
        : legacyKey && typeof base[legacyKey] === "string"
          ? base[legacyKey]
          : "";
    const value = raw.trim();
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
