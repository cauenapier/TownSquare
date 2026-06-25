/**
 * Hosted/site-level scene + style configuration — browser form/render layer.
 *
 * Pure, Node-safe logic (constants, defaults, sanitizers, prop/CSS builders)
 * lives in site-config-core.mjs and is re-exported here, so existing importers
 * keep their imports unchanged. The DOM-coupled form binding and rendering
 * helpers below stay browser-only.
 */

import {
  SCENE_FIELDS,
  SCENE_BIRDS_FIELD,
  STYLE_FIELDS,
  STYLE_MODES,
  STYLE_TRANSPARENT,
  STYLE_VAR_MAP,
  styleInputName,
  DEFAULT_SITE_STYLE_LIGHT,
  DEFAULT_SITE_STYLE_DARK,
  getScenePositionInputName,
  sanitizeSceneConfig,
  sanitizeStylePalette,
  isTransparentStyleValue,
  isPlainObject,
  clampInt,
  clampNumber,
  selectDefaultPositions,
  roundPosition,
  roundPercent,
  POSITION_INPUT_MIN,
  POSITION_INPUT_MAX,
  POSITION_INPUT_STEP,
} from "./site-config-core.mjs";

export * from "./site-config-core.mjs";

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
