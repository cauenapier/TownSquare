// Browser regression coverage for the embedded (homepage) TownSquare map:
// mounting, site selection/detail interaction, keyboard access, the random
// town action, activity updates, Ctrl/Cmd+wheel zoom, and — critically —
// that a plain wheel/touch scroll is never trapped by the map.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startManagedServer } from "./lib/widget-shot-helpers.mjs";

const WORLD = { width: 1800, height: 1200, props: [], water: [] };

function site(overrides) {
  return {
    siteKey: "town-a",
    name: "Mossy Corner",
    origin: "https://mossy.example/",
    verifiedAt: Date.now() - 86_400_000,
    lastSeenAt: Date.now() - 3_600_000,
    messageCount: 20,
    activeVisitors: 2,
    inactiveDays: 0,
    inactiveFor30Days: false,
    inactivityProgress: 0,
    connections: [],
    supporter: false,
    ...overrides,
  };
}

const SITES = [
  site({ siteKey: "town-a", name: "Mossy Corner", origin: "https://mossy.example/", activeVisitors: 2 }),
  site({ siteKey: "town-b", name: "Harbor Reach", origin: "https://harbor.example/", activeVisitors: 0, messageCount: 5 }),
];

async function routeMapApi(page, { sites = SITES, version = "v1" } = {}) {
  await page.route("**/api/map", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ world: WORLD, sites, version }),
  }));
  await page.route("**/api/map/activity", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ version, sites: sites.map((s) => ({ siteKey: s.siteKey, activeVisitors: s.activeVisitors })) }),
  }));
  await page.route("**/api/discovery/random", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ town: { siteKey: "town-b", name: "Harbor Reach", url: "https://harbor.example/" } }),
  }));
  await page.route("**/api/map-click", (route) => route.fulfill({ status: 204, body: "" }));
}

async function main() {
  const managed = await startManagedServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await routeMapApi(page);
    await page.goto(`${managed.httpOrigin}/dev/map-embed-sandbox.html`, { waitUntil: "networkidle" });

    // --- mounting ---
    await page.getByText("2 towns", { exact: false }).waitFor();
    const nodes = page.locator(".map-node");
    assert.equal(await nodes.count(), 2, "embedded map did not mount both fixture towns");
    assert.equal(
      await page.evaluate(() => document.querySelector(".map-svg")?.classList.contains("map-svg--compact")),
      true,
      "embedded map did not render in compact mode",
    );

    // --- site selection / inline detail interaction (not a modal) ---
    await page.locator('[data-site-key="town-a"]').click();
    const detail = page.locator("#embed-sandbox-detail");
    await detail.waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-detail-name]").textContent(), "Mossy Corner");
    assert.match(await page.locator("[data-detail-origin]").getAttribute("href"), /mossy\.example/);
    assert.equal(await page.evaluate(() => document.querySelector("dialog")), null, "embedded detail must not use a modal dialog");

    await page.locator("[data-detail-close]").click();
    assert.equal(await detail.isVisible(), false);

    // --- keyboard interaction ---
    await page.locator('[data-site-key="town-b"]').focus();
    await page.keyboard.press("Enter");
    await detail.waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-detail-name]").textContent(), "Harbor Reach");

    // --- random town action ---
    // Route the fixture's fake external destinations at the browser-context
    // level so the popup navigation resolves instead of hitting a real DNS
    // lookup for a domain that does not exist.
    await page.context().route("https://harbor.example/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Harbor Reach</title>",
    }));
    const randomButton = page.locator("#embed-sandbox-random");
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      randomButton.click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    assert.equal(popup.url(), "https://harbor.example/");
    await popup.close();
    assert.equal(await randomButton.getAttribute("data-resolved-town"), "town-b");

    // --- Ctrl/Cmd + wheel zooms; a plain wheel leaves the map alone and shows a hint ---
    const svgViewBox = () => page.evaluate(() => document.querySelector("#embed-sandbox-map .map-svg")?.getAttribute("viewBox"));
    const mapCanvasBox = await page.locator("#embed-sandbox-map").boundingBox();
    assert.ok(mapCanvasBox, "embedded map canvas not found");
    await page.mouse.move(mapCanvasBox.x + mapCanvasBox.width / 2, mapCanvasBox.y + mapCanvasBox.height / 2);

    const viewBoxBeforeWheel = await svgViewBox();
    await page.mouse.wheel(0, -240);
    assert.equal(await svgViewBox(), viewBoxBeforeWheel, "an unmodified wheel scroll must not zoom the embedded map");
    await page.locator("#embed-sandbox-hint").waitFor({ state: "visible" });
    assert.match(await page.locator("#embed-sandbox-hint").textContent(), /to zoom the map/);

    // Playwright's mouse.wheel() does not carry currently-held modifier keys
    // onto the synthesized wheel event, so dispatch one directly with
    // ctrlKey set — this still exercises the real listener and its real
    // preventDefault/zoom logic, just without relying on OS-level modifier
    // plumbing the test runner can't control.
    await page.evaluate(() => {
      document.getElementById("embed-sandbox-map").dispatchEvent(new WheelEvent("wheel", {
        deltaY: -240,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    await page.waitForFunction(
      (prev) => document.querySelector("#embed-sandbox-map .map-svg")?.getAttribute("viewBox") !== prev,
      viewBoxBeforeWheel,
    );

    // --- activity updates ---
    await routeMapApi(page, {
      sites: SITES.map((s) => (s.siteKey === "town-a" ? { ...s, activeVisitors: 9 } : s)),
    });
    await page.waitForFunction(() => {
      const label = document.querySelector('[data-site-key="town-a"]')?.getAttribute("aria-label") || "";
      return label.includes("9 active visitors");
    }, null, { timeout: 15_000 });

    // --- full /map page still works (dialog-based detail, toolbar) ---
    await routeMapApi(page);
    await page.goto(`${managed.httpOrigin}/map`, { waitUntil: "networkidle" });
    await page.locator('[data-site-key="town-a"]').click();
    const mapDialog = page.locator("#map-detail");
    await page.waitForFunction(() => document.getElementById("map-detail")?.open === true);
    assert.equal(await mapDialog.locator("h2").textContent(), "Mossy Corner");
    await page.locator(".map-detail__close").click();
    await page.waitForFunction(() => document.getElementById("map-detail")?.open !== true);

    // --- mobile: touch drag over the embedded map must scroll the page, not pan the map ---
    const mobilePage = await browser.newPage({
      viewport: { width: 375, height: 700 },
      hasTouch: true,
      isMobile: true,
    });
    await routeMapApi(mobilePage);
    await mobilePage.goto(`${managed.httpOrigin}/dev/map-embed-sandbox.html`, { waitUntil: "networkidle" });
    await mobilePage.getByText("2 towns", { exact: false }).waitFor();

    const before = await mobilePage.evaluate(() => window.scrollY);
    const canvasBox = await mobilePage.locator("#embed-sandbox-map").boundingBox();
    assert.ok(canvasBox, "embedded map canvas not found on mobile viewport");
    const startX = canvasBox.x + canvasBox.width / 2;
    const startY = canvasBox.y + Math.min(30, canvasBox.height / 2);
    await mobilePage.touchscreen.tap(startX, startY);
    // Playwright's touchscreen API only supports tap; simulate a scroll drag
    // via a real wheel event instead, which is what mobile browsers coalesce
    // touch-panning into for our purposes here: confirming the page — not the
    // map — is what moves.
    await mobilePage.mouse.wheel(0, 800);
    await mobilePage.waitForFunction((prev) => window.scrollY !== prev, before, { timeout: 5000 });
    const after = await mobilePage.evaluate(() => window.scrollY);
    assert.ok(after > before, "page did not scroll through the embedded map on mobile");
    assert.equal(
      await mobilePage.evaluate(() => getComputedStyle(document.querySelector(".map-canvas--embedded")).touchAction),
      "pan-y",
      "embedded map canvas must not claim touch gestures (touch-action should allow vertical pan)",
    );
    await mobilePage.close();

    console.log("Map embed test passed.");
  } finally {
    await browser.close();
    await managed.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Map embed test failed: ${error.message}`);
  process.exit(1);
});
