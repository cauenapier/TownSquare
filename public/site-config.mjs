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

export const STYLE_FIELDS = Object.freeze([
  Object.freeze({ key: "scene", label: "Background", inputName: "style-scene", defaultValue: "#e4e2dd", cssVar: "--scene" }),
  Object.freeze({ key: "page", label: "Ground", inputName: "style-page", defaultValue: "#efede9", cssVar: "--page" }),
  Object.freeze({ key: "surface", label: "Buttons and Tags", inputName: "style-surface", defaultValue: "#fdf8f4", cssVar: "--surface" }),
  Object.freeze({ key: "ink", label: "Ink", inputName: "style-ink", defaultValue: "#2a2926", cssVar: "--ink" }),
  Object.freeze({ key: "accent", label: "Accent", inputName: "style-accent", defaultValue: "#c8641f", cssVar: "--you" }),
  Object.freeze({ key: "other", label: "Other", inputName: "style-other", defaultValue: "#26241f", cssVar: "--other" }),
  Object.freeze({ key: "ground", label: "Ground line", inputName: "style-ground", defaultValue: "rgba(42, 41, 38, 0.16)", cssVar: "--ground" }),
]);

const SCENE_FIELD_BY_KEY = new Map(SCENE_FIELDS.map((field) => [field.key, field]));
const STYLE_VAR_MAP = new Map(STYLE_FIELDS.map((field) => [field.key, field.cssVar]));

const POSITION_PRESETS = Object.freeze({
  benches: Object.freeze([0.2, 0.72, 0.46, 0.08, 0.58, 0.86]),
  trees: Object.freeze([0.8, 0.58, 0.36, 0.9, 0.18, 0.68]),
  lamps: Object.freeze([0.12, 0.88, 0.36, 0.64]),
});

export const DEFAULT_SCENE_CONFIG = Object.freeze(buildDefaultSceneConfig());

export const DEFAULT_SITE_STYLE = Object.freeze(
  Object.fromEntries(STYLE_FIELDS.map((field) => [field.key, field.defaultValue])),
);

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

function formatPercent(value) {
  const rounded = roundPercent(value * 100);
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
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

export function isTransparentStyleValue(value) {
  return typeof value === "string" && value.trim().toLowerCase() === STYLE_TRANSPARENT;
}

export function sanitizeSiteStyle(input = {}) {
  const base = isPlainObject(input) ? input : {};
  const next = {};
  for (const { key, defaultValue } of STYLE_FIELDS) {
    const value = typeof base[key] === "string" ? base[key].trim() : "";
    if (isTransparentStyleValue(value)) {
      next[key] = STYLE_TRANSPARENT;
      continue;
    }
    next[key] = value && value.length <= 64 && SAFE_COLOR_RE.test(value) ? value : defaultValue;
  }
  return next;
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
  return Object.fromEntries(
    STYLE_FIELDS.map((field) => {
      const hiddenInput = form.querySelector(`input[type="hidden"][name="${field.inputName}"]`);
      const raw = hiddenInput instanceof HTMLInputElement
        ? hiddenInput.value
        : formData.get(field.inputName);
      return [field.key, String(raw || "").trim()];
    }),
  );
}

export function applyConfigToForm(form, config = {}) {
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

  for (const field of STYLE_FIELDS) {
    const input = form.querySelector(`input[type="hidden"][name="${field.inputName}"]`)
      ?? form.elements.namedItem(field.inputName);
    if (input && "value" in input) {
      input.value = String(config[field.key] ?? field.defaultValue);
    }
  }

  syncStyleColorFields(form);
  syncSceneCountProse(form);
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

  for (const field of STYLE_FIELDS) {
    const valueInput = form.querySelector(`input[type="hidden"][name="${field.inputName}"]`);
    if (!(valueInput instanceof HTMLInputElement)) continue;

    const control = valueInput.closest(".hosted-color-control");
    if (!(control instanceof HTMLElement)) continue;

    if (control.dataset.styleColorBound === "true") continue;
    control.dataset.styleColorBound = "true";

    const picker = control.querySelector("[data-style-picker]");
    const clearButton = control.querySelector("[data-style-clear]");

    const syncFromValue = () => {
      const transparent = isTransparentStyleValue(valueInput.value);
      if (picker instanceof HTMLInputElement) {
        picker.disabled = transparent;
        if (!transparent && /^#[0-9a-f]{6}$/i.test(valueInput.value)) {
          picker.value = valueInput.value;
        }
      }
      if (clearButton instanceof HTMLButtonElement) {
        clearButton.setAttribute("aria-pressed", transparent ? "true" : "false");
      }
      control.classList.toggle("hosted-color-control--transparent", transparent);
    };

    if (picker instanceof HTMLInputElement) {
      picker.addEventListener("input", () => {
        valueInput.value = picker.value;
        syncFromValue();
        valueInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    if (clearButton instanceof HTMLButtonElement) {
      clearButton.addEventListener("click", () => {
        const makeTransparent = !isTransparentStyleValue(valueInput.value);
        valueInput.value = makeTransparent ? STYLE_TRANSPARENT : field.defaultValue;
        if (!makeTransparent && picker instanceof HTMLInputElement) {
          picker.value = field.defaultValue;
        }
        syncFromValue();
        valueInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    syncFromValue();
  }
}

export function syncStyleColorFields(form) {
  if (!(form instanceof HTMLFormElement)) return;

  for (const field of STYLE_FIELDS) {
    const valueInput = form.querySelector(`input[type="hidden"][name="${field.inputName}"]`);
    if (!(valueInput instanceof HTMLInputElement)) continue;

    const control = valueInput.closest(".hosted-color-control");
    if (!(control instanceof HTMLElement)) continue;

    const picker = control.querySelector("[data-style-picker]");
    const clearButton = control.querySelector("[data-style-clear]");
    const transparent = isTransparentStyleValue(valueInput.value);

    if (picker instanceof HTMLInputElement) {
      picker.disabled = transparent;
      if (!transparent && /^#[0-9a-f]{6}$/i.test(valueInput.value)) {
        picker.value = valueInput.value;
      }
    }
    if (clearButton instanceof HTMLButtonElement) {
      clearButton.setAttribute("aria-pressed", transparent ? "true" : "false");
    }
    control.classList.toggle("hosted-color-control--transparent", transparent);
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

export function getSceneSummaryEntries(sceneConfig = {}) {
  const scene = sanitizeSceneConfig(sceneConfig);
  const entries = [];

  for (const field of SCENE_FIELDS) {
    entries.push({ label: field.label, value: scene[field.key] });
    if (scene[field.key] > 0) {
      entries.push({
        label: `${field.itemLabel} X positions`,
        value: scene[field.positionsKey].map((x) => formatPercent(x)).join(", "),
      });
    }
  }

  entries.push({ label: SCENE_BIRDS_FIELD.label, value: scene[SCENE_BIRDS_FIELD.key] });

  return entries;
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

export function applySiteStyle(root, style = DEFAULT_SITE_STYLE) {
  const next = sanitizeSiteStyle(style);
  for (const [key, cssVar] of STYLE_VAR_MAP) {
    root.style.setProperty(cssVar, next[key]);
  }
  root.style.setProperty("--scene-edge", "color-mix(in oklab, var(--scene) 88%, var(--page) 12%)");
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
  lines.push("  --scene-edge: color-mix(in oklab, var(--scene) 88%, var(--page) 12%);");
  lines.push("  --you-deep: var(--you);");
  lines.push("  --text: var(--ink);");
  lines.push("  --muted: var(--ink);");
  lines.push("}");
  return lines.join("\n");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
