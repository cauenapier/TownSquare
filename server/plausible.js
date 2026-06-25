"use strict";

// Plausible analytics integration extracted from server.js: the script/event
// reverse proxy plus the optional <script> injection into served HTML. Built as
// a factory so its config and host hooks (getRequestIp, per-IP event rate limit)
// are injected rather than reaching into server.js globals.

const path = require("path");

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {object} options
 * @param {string} options.domain   PLAUSIBLE_DOMAIN ("" disables everything).
 * @param {string} options.upstream Plausible host base URL (no trailing slash).
 * @param {string} options.scriptSrc Public path/URL the snippet loads.
 * @param {string} options.apiPath  Path the first-party event proxy listens on.
 * @param {(req: import("http").IncomingMessage) => string} options.getRequestIp
 * @param {(ip: string) => boolean} options.isEventAllowed Per-IP rate-limit gate
 *   for the event proxy (returns false when the caller is over budget).
 */
function createPlausibleProxy({ domain, upstream, scriptSrc, apiPath, getRequestIp, isEventAllowed }) {
  const enabled = Boolean(domain);

  // First-party path the proxied script is served from (only when scriptSrc is
  // a local path, e.g. "/js/script.js"); null means the snippet points offsite.
  function scriptPath() {
    if (!scriptSrc.startsWith("/")) return null;
    return scriptSrc.split("?")[0];
  }

  function shouldInject(filePath) {
    return enabled && path.extname(filePath) === ".html";
  }

  function buildSnippet() {
    const attrs = [
      "defer",
      `data-domain="${escapeHtmlAttr(domain)}"`,
      `src="${escapeHtmlAttr(scriptSrc)}"`,
    ];
    if (apiPath) {
      attrs.splice(2, 0, `data-api="${escapeHtmlAttr(apiPath)}"`);
    }
    return `<script ${attrs.join(" ")}></script>`;
  }

  function injectIntoHtml(html) {
    const snippet = buildSnippet();
    const headClose = html.indexOf("</head>");
    if (headClose === -1) return html;
    return `${html.slice(0, headClose)}    ${snippet}\n  ${html.slice(headClose)}`;
  }

  async function proxyScript(req, res) {
    try {
      const response = await fetch(`${upstream}/js/script.js`, {
        headers: { "user-agent": req.headers["user-agent"] || "TownSquare" },
      });
      if (!response.ok) {
        res.writeHead(response.status, { "content-type": "text/plain; charset=utf-8" });
        res.end("upstream error");
        return;
      }

      res.writeHead(200, {
        "content-type": response.headers.get("content-type") || "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=86400, immutable",
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.warn(`Plausible script proxy failed: ${error.message}`);
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad gateway");
    }
  }

  function proxyEvent(req, res) {
    // Rate-limit per IP so the open event relay can't be used to amplify
    // traffic at the upstream using this server's address.
    if (!isEventAllowed(getRequestIp(req))) {
      res.writeHead(429, { "content-type": "text/plain; charset=utf-8" });
      res.end("rate limited");
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((size, part) => size + part.length, 0) > 4096) {
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        res.end("payload too large");
        req.destroy();
      }
    });

    req.on("end", () => {
      void forwardEvent(req, res, Buffer.concat(chunks));
    });
  }

  async function forwardEvent(req, res, body) {
    try {
      const response = await fetch(`${upstream}/api/event`, {
        method: "POST",
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
          "user-agent": req.headers["user-agent"] || "",
          "x-forwarded-for": getRequestIp(req),
        },
        body,
      });

      res.writeHead(response.status, {
        "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.warn(`Plausible event proxy failed: ${error.message}`);
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad gateway");
    }
  }

  return { enabled, apiPath, scriptPath, shouldInject, injectIntoHtml, proxyScript, proxyEvent };
}

module.exports = { createPlausibleProxy };
