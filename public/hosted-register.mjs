import { bindCopy } from "./ui-common.mjs";
import { createStatusSetter } from "./hosted-common.mjs";

const registerView = document.getElementById("register-view");
const successView = document.getElementById("success-view");
const form = document.getElementById("register-form");
const submitButton = document.getElementById("register-submit");
const statusEl = document.getElementById("register-status");
const successSiteEl = document.getElementById("success-site");
const snippetEl = document.getElementById("embed-snippet");
const adminTokenEl = document.getElementById("admin-token");
const adminLink = document.getElementById("admin-link");

const setStatus = createStatusSetter(statusEl, { toggleHidden: true });

function showSuccess(body) {
  successSiteEl.textContent = `${body.site.name} — ${body.site.origin}`;
  adminTokenEl.value = body.adminToken;
  snippetEl.value = body.embedSnippet;
  adminLink.href = body.adminUrl;

  registerView.hidden = true;
  successView.hidden = false;
  window.scrollTo({ top: 0 });
}

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

bindCopy("copy-token", { text: () => adminTokenEl.value, source: adminTokenEl });
bindCopy("copy-snippet", { text: () => snippetEl.value, source: snippetEl });
