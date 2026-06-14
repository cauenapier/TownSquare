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

export const DEFAULT_SCENE_CONFIG = Object.freeze({
  benches: 2,
  trees: 1,
  lamps: 1,
  branches: 0,
});

export const DEFAULT_SITE_STYLE = Object.freeze({
  scene: "#e4e2dd",
  page: "#efede9",
  surface: "#fdf8f4",
  ink: "#2a2926",
  accent: "#c8641f",
  other: "#26241f",
  ground: "rgba(42, 41, 38, 0.16)",
});

const STYLE_VAR_MAP = new Map([
  ["scene", "--scene"],
  ["page", "--page"],
  ["surface", "--surface"],
  ["ink", "--ink"],
  ["accent", "--you"],
  ["other", "--other"],
  ["ground", "--ground"],
]);

const SCENE_LIMITS = Object.freeze({
  benches: 0,
  trees: 0,
  lamps: 0,
  branches: 0,
});

const SCENE_MAX = Object.freeze({
  benches: 6,
  trees: 6,
  lamps: 4,
  branches: 8,
});

const POSITION_PRESETS = Object.freeze({
  benches: Object.freeze([0.2, 0.72, 0.46, 0.08, 0.58, 0.86]),
  trees: Object.freeze([0.8, 0.58, 0.36, 0.9, 0.18, 0.68]),
  lamps: Object.freeze([0.12, 0.88, 0.36, 0.64]),
  branches: Object.freeze([0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78]),
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

const BRANCH_SVG = `
  <svg viewBox="0 0 42 28" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M4 18 C11 18 17 16 22 12 C26 9 31 6 38 6"></path>
    <path d="M18 13 L11 9"></path>
    <path d="M25 10 L20 4"></path>
    <path d="M31 8 L28 2"></path>
  </svg>
`;

/**
 * @typedef {Object} SceneProp
 * @property {string} id
 * @property {number} x
 * @property {number} zoneRadius
 * @property {number} width
 * @property {number} height
 * @property {string} [pose]
 * @property {Array<number>} [seats]
 * @property {boolean} [faceAway]
 * @property {number} [shadeRadius]
 * @property {number} [lightRadius]
 * @property {string} [kind]
 * @property {string} svg
 */

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function evenPositions(count, start, end) {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => Number((start + step * index).toFixed(4)));
}

function selectPositions(kind, count, start, end) {
  if (count <= 0) return [];
  const preset = POSITION_PRESETS[kind] || [];
  if (count <= preset.length) return preset.slice(0, count);

  const extra = evenPositions(count - preset.length, start, end).filter((x) => !preset.includes(x));
  return [...preset, ...extra].slice(0, count);
}

function uniqueId(kind, index) {
  return index === 0 ? kind : `${kind}-${index + 1}`;
}

function createBench(index, x) {
  return {
    id: uniqueId("bench", index),
    kind: "bench",
    x,
    zoneRadius: 0.035,
    width: 52,
    height: 18,
    pose: "sitting",
    seats: [-0.01, 0.01],
    svg: BENCH_SVG,
  };
}

function createLamp(index, x) {
  return {
    id: uniqueId("lamp", index),
    kind: "lamp",
    x,
    zoneRadius: 0,
    width: 20,
    height: 56,
    lightRadius: 0.045,
    svg: LAMP_SVG,
  };
}

function createTree(index, x) {
  return {
    id: uniqueId("tree", index),
    kind: "tree",
    x,
    zoneRadius: 0.015,
    width: 56,
    height: 76,
    pose: "resting",
    seats: [-0.008, 0.008],
    faceAway: true,
    shadeRadius: 0.045,
    svg: TREE_SVG,
  };
}

function createBranch(index, x) {
  return {
    id: uniqueId("branch", index),
    kind: "branch",
    x,
    zoneRadius: 0,
    width: 42,
    height: 28,
    svg: BRANCH_SVG,
  };
}

export function sanitizeSceneConfig(input = {}) {
  const base = isPlainObject(input) ? input : {};
  return {
    benches: clampInt(base.benches, SCENE_LIMITS.benches, SCENE_MAX.benches, DEFAULT_SCENE_CONFIG.benches),
    trees: clampInt(base.trees, SCENE_LIMITS.trees, SCENE_MAX.trees, DEFAULT_SCENE_CONFIG.trees),
    lamps: clampInt(base.lamps, SCENE_LIMITS.lamps, SCENE_MAX.lamps, DEFAULT_SCENE_CONFIG.lamps),
    branches: clampInt(base.branches, SCENE_LIMITS.branches, SCENE_MAX.branches, DEFAULT_SCENE_CONFIG.branches),
  };
}

export function sanitizeSiteStyle(input = {}) {
  const base = isPlainObject(input) ? input : {};
  const next = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SITE_STYLE)) {
    const value = typeof base[key] === "string" ? base[key].trim() : "";
    next[key] = value && value.length <= 64 && SAFE_COLOR_RE.test(value) ? value : fallback;
  }
  return next;
}

export function buildSceneProps(config = DEFAULT_SCENE_CONFIG) {
  const scene = sanitizeSceneConfig(config);
  const props = [];

  selectPositions("lamps", scene.lamps, 0.16, 0.84).forEach((x, index) => {
    props.push(createLamp(index, x));
  });
  selectPositions("benches", scene.benches, 0.08, 0.86).forEach((x, index) => {
    props.push(createBench(index, x));
  });
  selectPositions("trees", scene.trees, 0.18, 0.9).forEach((x, index) => {
    props.push(createTree(index, x));
  });
  selectPositions("branches", scene.branches, 0.2, 0.8).forEach((x, index) => {
    props.push(createBranch(index, x));
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

    if (prop.kind === "branch") {
      perches.push({
        id: `${prop.id}-perch`,
        propId: prop.id,
        offsetX: 0,
        liftPx: 12,
        x: prop.x,
      });
    }
  }
  return perches;
}

export function applySiteStyle(root, style = DEFAULT_SITE_STYLE) {
  const next = sanitizeSiteStyle(style);
  for (const [key, cssVar] of STYLE_VAR_MAP) {
    root.style.setProperty(cssVar, next[key]);
  }
  root.style.setProperty("--you-deep", next.accent);
  root.style.setProperty("--text", next.ink);
  root.style.setProperty("--muted", next.ink);
}

export function buildSiteCss(style = DEFAULT_SITE_STYLE, selector = "#townsquare-root") {
  const next = sanitizeSiteStyle(style);
  const lines = [`${selector} {`];
  for (const [key, cssVar] of STYLE_VAR_MAP) {
    lines.push(`  ${cssVar}: ${next[key]};`);
  }
  lines.push("  --you-deep: var(--you);");
  lines.push("  --text: var(--ink);");
  lines.push("  --muted: var(--ink);");
  lines.push("}");
  return lines.join("\n");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
