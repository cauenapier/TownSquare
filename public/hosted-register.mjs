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

let previewHandle = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.classList.toggle("hosted-status--error", isError);
}

function bindCopy(buttonId, source) {
  const button = document.getElementById(buttonId);
  const originalText = button.textContent;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.value);
    } catch {
      source.focus();
      source.select();
      return;
    }

    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = originalText;
    }, 1200);
  });
}

function readSceneConfig() {
  const formData = new FormData(form);
  return {
    benches: Number(formData.get("scene-benches") || 0),
    trees: Number(formData.get("scene-trees") || 0),
    lamps: Number(formData.get("scene-lamps") || 0),
    branches: Number(formData.get("scene-branches") || 0),
  };
}

function readStyleConfig() {
  const formData = new FormData(form);
  return {
    scene: String(formData.get("style-scene") || "").trim(),
    page: String(formData.get("style-page") || "").trim(),
    surface: String(formData.get("style-surface") || "").trim(),
    ink: String(formData.get("style-ink") || "").trim(),
    accent: String(formData.get("style-accent") || "").trim(),
  };
}

function mountPreview() {
  if (!(previewRoot instanceof HTMLElement)) return;
  previewHandle?.destroy();
  previewHandle = mountTownSquare(previewRoot, {
    serverOrigin: window.location.origin,
    scene: readSceneConfig(),
    style: readStyleConfig(),
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

form.addEventListener("input", () => {
  mountPreview();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus("Creating your TownSquare...");

  try {
    const formData = new FormData(form);
    const response = await fetch("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: formData.get("origin"),
        name: formData.get("name"),
        sceneConfig: readSceneConfig(),
        styleConfig: readStyleConfig(),
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      setStatus(body.error || "Could not create this TownSquare.", true);
      return;
    }

    setStatus("");
    showSuccess(body);
  } catch {
    setStatus("Could not reach the server. Check your connection and try again.", true);
  } finally {
    submitButton.disabled = false;
  }
});

bindCopy("copy-token", adminTokenEl);
bindCopy("copy-snippet", snippetEl);
bindCopy("copy-style", styleSnippetEl);
mountPreview();
