import { bindCopy, setStatus } from "./hosted-common.mjs";
import {
  applyConfigToForm,
  getScenePositionGroups,
  isSceneCountInputName,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  sanitizeSceneConfig,
} from "./site-config.mjs";
import { mountTownSquare } from "./townsquare.mjs";

const registerView = document.getElementById("register-view");
const successView = document.getElementById("success-view");
const form = document.getElementById("register-form");
const submitButton = document.getElementById("register-submit");
const statusEl = document.getElementById("register-status");
const successSiteEl = document.getElementById("success-site");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const adminTokenEl = document.getElementById("admin-token");
const adminLink = document.getElementById("admin-link");
const previewRoot = document.getElementById("townsquare-root");
const scenePositionFields = document.getElementById("scene-position-fields");

let previewHandle = null;

function renderScenePositionInputs(sceneConfig) {
  if (!(scenePositionFields instanceof HTMLElement)) return;
  const groups = getScenePositionGroups(sceneConfig);
  scenePositionFields.replaceChildren();

  if (groups.length === 0) {
    const note = document.createElement("p");
    note.className = "hosted-note";
    note.textContent = "Add at least one prop above to place it manually.";
    scenePositionFields.appendChild(note);
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "hosted-position-group";

    const heading = document.createElement("div");
    heading.className = "hosted-position-group-head";

    const title = document.createElement("strong");
    title.textContent = group.label;

    const helper = document.createElement("p");
    helper.className = "hosted-note";
    helper.textContent = group.helper;

    heading.append(title, helper);

    const grid = document.createElement("div");
    grid.className = "hosted-grid hosted-grid--compact";

    for (const item of group.items) {
      const label = document.createElement("label");
      const text = document.createElement("span");
      const input = document.createElement("input");

      text.textContent = item.label;
      input.name = item.inputName;
      input.type = "number";
      input.min = String(item.min);
      input.max = String(item.max);
      input.step = String(item.step);
      input.value = String(item.value);
      input.inputMode = "numeric";

      label.append(text, input);
      grid.appendChild(label);
    }

    section.append(heading, grid);
    scenePositionFields.appendChild(section);
  }
}

function syncScenePositionInputs(sceneConfig = readSceneConfigFromForm(form)) {
  const next = sanitizeSceneConfig(sceneConfig);
  renderScenePositionInputs(next);
  applyConfigToForm(form, next);
}

function mountPreview() {
  if (!(previewRoot instanceof HTMLElement)) return;
  const scene = readSceneConfigFromForm(form);
  const style = readStyleConfigFromForm(form);
  if (previewHandle) {
    previewHandle.updateConfig({ scene, style });
    return;
  }
  previewHandle = mountTownSquare(previewRoot, {
    serverOrigin: window.location.origin,
    scene,
    style,
    solo: true,
    readingLabel: "Registration preview",
    readingUrl: window.location.href,
  });
}

function showSuccess(body) {
  successSiteEl.textContent = `${body.site.name} — ${body.site.origin}`;
  adminTokenEl.value = body.adminToken;
  snippetEl.value = body.embedSnippet;
  styleSnippetEl.value = body.styleSnippet;
  adminLink.href = body.adminUrl;

  previewHandle?.destroy();
  previewHandle = null;
  registerView.hidden = true;
  successView.hidden = false;
  window.scrollTo({ top: 0 });
}

form.addEventListener("input", (event) => {
  if (isSceneCountInputName(event.target?.name || "")) {
    syncScenePositionInputs(readSceneConfigFromForm(form));
  }
  mountPreview();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus(statusEl, "Creating your TownSquare...", false, { hideWhenEmpty: true });

  try {
    const formData = new FormData(form);
    const response = await fetch("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: formData.get("origin"),
        name: formData.get("name"),
        sceneConfig: readSceneConfigFromForm(form),
        styleConfig: readStyleConfigFromForm(form),
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(statusEl, body.error || "Could not create this TownSquare.", true, { hideWhenEmpty: true });
      return;
    }

    setStatus(statusEl, "", false, { hideWhenEmpty: true });
    showSuccess(body);
  } catch {
    setStatus(statusEl, "Could not reach the server. Check your connection and try again.", true, { hideWhenEmpty: true });
  } finally {
    submitButton.disabled = false;
  }
});

bindCopy(document.getElementById("copy-token"), () => adminTokenEl.value, { fallbackTarget: adminTokenEl });
bindCopy(document.getElementById("copy-snippet"), () => snippetEl.value, { fallbackTarget: snippetEl });
bindCopy(document.getElementById("copy-style"), () => styleSnippetEl.value, { fallbackTarget: styleSnippetEl });
applyConfigToForm(form);
syncScenePositionInputs();
mountPreview();
