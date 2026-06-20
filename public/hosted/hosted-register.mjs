import { bindCopy } from "../lib/ui-common.mjs";
import { setStatus } from "./hosted-common.mjs";
import {
  applyConfigToForm,
  applySceneConfigToForm,
  bindSceneCountProse,
  bindStyleColorFields,
  isSceneCountInputName,
  readSceneConfigFromForm,
  readStyleConfigFromForm,
  renderScenePositionFields,
  renderStyleOverrideFields,
  sanitizeSceneConfig,
} from "../shared/site-config.mjs";
import { getMatchingWwwOrigin } from "../shared/url.mjs";
import { createCustomizationPreview } from "./hosted-preview.mjs";

const registerView = document.getElementById("register-view");
const successView = document.getElementById("success-view");
const form = document.getElementById("register-form");
const siteOriginInput = document.getElementById("site-origin");
const includeMatchingWwwInput = document.getElementById("include-matching-www");
const includeMatchingWwwLabel = document.getElementById("include-matching-www-label");
const includeMatchingWwwNote = document.getElementById("include-matching-www-note");
const submitButton = document.getElementById("register-submit");
const statusEl = document.getElementById("register-status");
const successSiteEl = document.getElementById("success-site");
const snippetEl = document.getElementById("embed-snippet");
const styleSnippetEl = document.getElementById("style-snippet");
const adminTokenEl = document.getElementById("admin-token");
const adminLink = document.getElementById("admin-link");
const previewRoot = document.getElementById("townsquare-root");
const scenePositionFields = document.getElementById("scene-position-fields");
const styleOverrideFields = document.getElementById("style-override-fields");

const previewModeButtons = document.querySelectorAll("[data-preview-mode]");

const preview = createCustomizationPreview({
  root: previewRoot,
  readingLabel: "Registration preview",
  readConfig: (mode) => ({
    scene: readSceneConfigFromForm(form),
    style: readStyleConfigFromForm(form)[mode],
  }),
});
preview.bindThemeToggle(previewModeButtons);

function syncScenePositionInputs(sceneConfig = readSceneConfigFromForm(form)) {
  const next = sanitizeSceneConfig(sceneConfig);
  renderScenePositionFields(scenePositionFields, next);
  applySceneConfigToForm(form, next);
}

function showSuccess(body) {
  const aliasText = Array.isArray(body.site.allowedOrigins) && body.site.allowedOrigins.length > 1
    ? ` (also allows ${body.site.allowedOrigins.filter((origin) => origin !== body.site.origin).join(", ")})`
    : "";
  successSiteEl.textContent = `${body.site.name} — ${body.site.origin}${aliasText}`;
  adminTokenEl.value = body.adminToken;
  snippetEl.value = body.embedSnippet;
  styleSnippetEl.value = body.styleSnippet;
  adminLink.href = body.adminUrl;

  preview.destroy();
  registerView.hidden = true;
  successView.hidden = false;
  window.scrollTo({ top: 0 });
}

function updateMatchingWwwControls() {
  const matching = getMatchingWwwOrigin(siteOriginInput.value);
  if (!matching) {
    includeMatchingWwwInput.checked = false;
    includeMatchingWwwInput.disabled = true;
    includeMatchingWwwLabel.textContent = "Also allow the matching www/non-www version";
    includeMatchingWwwNote.textContent = "Shown for standard domain names like example.com or www.example.com.";
    return;
  }

  includeMatchingWwwInput.disabled = false;
  includeMatchingWwwLabel.textContent = `Also allow ${matching}`;
  includeMatchingWwwNote.textContent = "Recommended if both versions of your site work.";
}

form.addEventListener("input", (event) => {
  if (event.target === siteOriginInput) {
    updateMatchingWwwControls();
  }
  if (isSceneCountInputName(event.target?.name || "")) {
    syncScenePositionInputs(readSceneConfigFromForm(form));
  }
  preview.mount();
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
        includeMatchingWww: includeMatchingWwwInput.checked,
        name: formData.get("name"),
        email: formData.get("email"),
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

bindCopy("copy-token", { text: () => adminTokenEl.value, source: adminTokenEl });
bindCopy("copy-snippet", { text: () => snippetEl.value, source: snippetEl });
bindCopy("copy-style", { text: () => styleSnippetEl.value, source: styleSnippetEl });
renderStyleOverrideFields(styleOverrideFields);
bindStyleColorFields(form);
bindSceneCountProse(form);
applyConfigToForm(form);
syncScenePositionInputs();
updateMatchingWwwControls();
preview.mount();
