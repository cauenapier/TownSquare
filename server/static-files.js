"use strict";

// Static asset serving extracted from server.js: route→file resolution (with
// path-traversal containment and friendly aliases), dev/staging gating, content
// headers, and the candidate-fallback file responder. Built as a factory so the
// roots, feature flags, and the optional HTML-injection hook are injected.

const fs = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Friendly URLs → the HTML file that backs them.
const ALIASES = new Map([
  ["/register", "/hosted/register.html"],
  ["/admin", "/hosted/admin.html"],
  ["/admin/chat", "/hosted/chat.html"],
  ["/service-admin", "/hosted/service-admin.html"],
  ["/map", "/map.html"],
  ["/dev", "/dev/dev.html"],
  ["/walk-sandbox", "/dev/walk-sandbox.html"],
  ["/staging", "/staging.html"],
]);

// True only if `candidate` is `root` itself or a descendant of it. A bare
// `startsWith(root)` is unsafe: a sibling like `${root}-evil` shares the prefix
// but is outside the directory, so require the path separator boundary.
function isInsideRoot(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
}

function getStaticHeaders(filePath) {
  const headers = {
    "cache-control": "no-store",
    "content-type": getContentType(filePath),
  };

  if ([".css", ".mjs"].includes(path.extname(filePath))) {
    headers["access-control-allow-origin"] = "*";
  }

  return headers;
}

function isDevToolsRequest(pathname) {
  return pathname === "/dev"
    || pathname === "/walk-sandbox"
    || pathname.startsWith("/dev/");
}

function isStagingPageRequest(pathname) {
  return pathname === "/staging" || pathname === "/staging.html";
}

/**
 * @param {object} options
 * @param {string} options.publicDir Core static root.
 * @param {string} [options.pluginAssetsDir] Optional overlay root tried second.
 * @param {boolean} options.devToolsEnabled
 * @param {boolean} options.stagingPageEnabled
 * @param {(filePath: string) => boolean} options.shouldInjectHtml
 * @param {(html: string) => string} options.injectHtml
 */
function createStaticFiles({
  publicDir,
  pluginAssetsDir,
  devToolsEnabled,
  stagingPageEnabled,
  shouldInjectHtml,
  injectHtml,
}) {
  function resolvePublicFile(requestUrl, hostHeader) {
    const url = new URL(requestUrl, `http://${hostHeader}`);
    if (!devToolsEnabled && isDevToolsRequest(url.pathname)) {
      return null;
    }
    if (!stagingPageEnabled && isStagingPageRequest(url.pathname)) {
      return null;
    }
    const pathname = ALIASES.get(url.pathname) || url.pathname;
    const normalized = path.normalize(pathname).replace(/^\.+/, "");

    // Candidate files are tried in order: the core public dir first, then the
    // optional plugin assets overlay. Each must stay inside its own root.
    const candidates = [];
    const corePath = path.join(publicDir, normalized);
    if (isInsideRoot(corePath, publicDir)) candidates.push(corePath);
    if (pluginAssetsDir) {
      const pluginPath = path.join(pluginAssetsDir, normalized);
      if (isInsideRoot(pluginPath, pluginAssetsDir)) candidates.push(pluginPath);
    }

    return candidates.length > 0 ? candidates : null;
  }

  function serveCandidate(candidates, index, res) {
    const filePath = candidates[index];
    fs.readFile(filePath, (error, data) => {
      if (error) {
        if (error.code === "ENOENT" && index + 1 < candidates.length) {
          serveCandidate(candidates, index + 1, res);
          return;
        }
        const status = error.code === "ENOENT" ? 404 : 500;
        const body = status === 404 ? "not found" : "server error";
        res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        res.end(body);
        return;
      }

      let body = data;
      if (path.extname(filePath) === ".html" && shouldInjectHtml(filePath)) {
        body = Buffer.from(injectHtml(data.toString("utf8")), "utf8");
      }

      res.writeHead(200, getStaticHeaders(filePath));
      res.end(body);
    });
  }

  return { resolvePublicFile, serveCandidate, isDevToolsRequest, isStagingPageRequest };
}

module.exports = { createStaticFiles };
