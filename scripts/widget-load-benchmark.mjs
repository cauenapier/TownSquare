// Cold-load benchmark for a real generated hosted embed on a synthetic host.
// Compare BASELINE=1 node scripts/widget-load-benchmark.mjs with the default run.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import managedServer from "./lib/managed-server.js";

const { findFreePort, startManagedServer } = managedServer;
const RTT_MS = 80;
const RUNS = Number(process.env.RUNS || 5);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const managed = await startManagedServer({
  dataPrefix: "townsquare-speed-",
  captureOutput: true,
  env: process.env.PLUS_ASSETS_DIR
    ? { TOWNSQUARE_PLUGIN_ASSETS_DIR: process.env.PLUS_ASSETS_DIR }
    : {},
});
const hostPort = await findFreePort();
const HOST_ORIGIN = `http://127.0.0.1:${hostPort}`;
let hostHtml = "";
const host = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(hostHtml);
});
await new Promise((resolve) => host.listen(hostPort, "127.0.0.1", resolve));
let browser;
try {
  const response = await fetch(`${managed.httpOrigin}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Speed benchmark", origin: HOST_ORIGIN }),
  });
  const site = await response.json();
  if (!response.ok) throw new Error(site.error || "site registration failed");
  const snippet = process.env.PLUS_ASSETS_DIR
    ? site.embedSnippet.replace('    theme: "host"', '    pluginModules: [{ name: "scene-cat", module: "/plus/scene-cat/widget.mjs" }],\n    preview: true,\n    theme: "host"')
    : site.embedSnippet;
  if (process.env.PLUS_ASSETS_DIR && !snippet.includes("pluginModules:")) {
    throw new Error(`Could not add Plus module to generated snippet: ${site.embedSnippet}`);
  }
  const originalModule = process.env.BASELINE ? await readFile(resolve("public/townsquare.mjs")) : null;
  const originalCss = process.env.BASELINE ? await readFile(resolve("public/widget.css")) : null;
  browser = await chromium.launch();

  for (const position of ["above", "below"]) {
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const requests = [];
      const errors = [];
      page.on("request", (request) => {
        if (request.url().startsWith(managed.httpOrigin)) requests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.addInitScript(() => {
        window.__speed = { lcp: 0, cls: 0, mounted: null };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__speed.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__speed.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        const observer = new MutationObserver(() => {
          const root = document.getElementById("townsquare-root");
          if (root?.children.length && window.__speed.mounted === null) {
            window.__speed.mounted = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await page.route(`${managed.httpOrigin}/**`, async (route) => {
        await pause(RTT_MS);
        await route.continue();
      });
      if (originalModule && originalCss) {
        await page.route(`${managed.httpOrigin}/townsquare.mjs`, async (route) => {
          await pause(RTT_MS);
          await route.fulfill({
            status: 200,
            contentType: "application/javascript",
            headers: { "access-control-allow-origin": "*" },
            body: originalModule,
          });
        });
        await page.route(`${managed.httpOrigin}/widget.css`, async (route) => {
          await pause(RTT_MS);
          await route.fulfill({ status: 200, contentType: "text/css", body: originalCss });
        });
      }
      const spacer = position === "below" ? "<div style='height:1200px'></div>" : "";
      hostHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font:20px system-ui"><main style="min-height:320px;padding:24px"><h1>Host page heading</h1><p>Host page content and first paint.</p></main>${spacer}${snippet}</body></html>`;
      await page.goto(`${HOST_ORIGIN}/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__speed.mounted !== null);
      await pause(500);
      const timing = await page.evaluate(() => ({
        ...window.__speed,
        dcl: performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd,
        load: performance.getEntriesByType("navigation")[0]?.loadEventEnd,
      }));
      const pluginLoaded = await page.locator(".ts-plus-cat-layer").count() > 0;
      if (process.env.PLUS_ASSETS_DIR && !pluginLoaded) {
        throw new Error(`Plus scene-cat browser module did not mount: ${errors.join("; ")}; requests: ${requests.join(", ")}`);
      }
      if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
      runs.push({
        ...timing,
        requests: requests.length,
        scripts: requests.filter((url) => url.endsWith(".mjs")).length,
        styles: requests.filter((url) => url.endsWith(".css")).length,
        errors,
      });
      await context.close();
    }
    const median = (key) => {
      const sorted = runs.map((run) => run[key]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    console.log(JSON.stringify({
      position,
      mode: process.env.BASELINE ? "original assets" : "served assets",
      rttMs: RTT_MS,
      runs: RUNS,
      median: Object.fromEntries(["lcp", "cls", "dcl", "load", "mounted", "requests", "scripts", "styles"].map((key) => [key, median(key)])),
      errors: runs.flatMap((run) => run.errors),
    }));
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => host.close(resolve));
  await managed.cleanup();
}
