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

// Admin/registration pages handle credentials and untrusted site data, so they
// get a strict-ish CSP (no inline script, no framing, no <base>/object) on top
// of X-Frame-Options. All their scripts are external modules, so script-src
// 'self' is safe; img/style/connect stay unrestricted so the live preview's
// assets and websocket keep working.
const SECURED_HTML = new Set(["admin.html", "service-admin.html", "chat.html", "register.html"]);
const ADMIN_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// Static, non-HTML asset types (widget JS, CSS, fonts, images) are safe to cache
// in the browser: an embedding host page otherwise re-downloads the whole widget
// on every view, which tanks its PageSpeed/LCP. Filenames are not content-hashed,
// so we use a moderate freshness window with stale-while-revalidate rather than a
// year-long immutable TTL — a deploy then propagates within the hour while repeat
// views stay cache-served. (Fingerprinted filenames could later move this to
// `immutable`.) HTML is excluded: it is content-injected and includes credentialed
// admin pages, so it must stay no-store.
const CACHEABLE_ASSET_EXTS = new Set([".css", ".mjs", ".js", ".json", ".png", ".svg"]);
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

function getStaticHeaders(filePath) {
  const ext = path.extname(filePath);
  const cacheable = CACHEABLE_ASSET_EXTS.has(ext) && !SECURED_HTML.has(path.basename(filePath));
  const headers = {
    "cache-control": cacheable ? STATIC_ASSET_CACHE_CONTROL : "no-store",
    "content-type": getContentType(filePath),
  };

  if ([".css", ".mjs"].includes(ext)) {
    headers["access-control-allow-origin"] = "*";
  }

  if (SECURED_HTML.has(path.basename(filePath))) {
    headers["content-security-policy"] = ADMIN_CSP;
    headers["x-frame-options"] = "DENY";
    headers["referrer-policy"] = "no-referrer";
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
