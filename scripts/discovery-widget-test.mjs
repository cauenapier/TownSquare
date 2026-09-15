// Browser regression coverage for the compact discovery popover.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startManagedServer } from "./lib/widget-shot-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "discovery-widget-test");

function assertInsideViewport(box, viewport, label) {
  assert.ok(box, `${label}: popover could not be measured`);
  assert.ok(box.x >= 0 && box.y >= 0, `${label}: popover overflowed the top/left viewport edge`);
  assert.ok(box.x + box.width <= viewport.width, `${label}: popover overflowed the right viewport edge`);
  assert.ok(box.y + box.height <= viewport.height, `${label}: popover overflowed the bottom viewport edge`);
}

async function openPopover(page) {
  const button = page.getByRole("button", { name: "Explore TownSquare" });
  await button.click();
  const popover = page.getByRole("dialog", { name: "TownSquare" });
  await popover.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".townsquare__discovery-action")?.hasAttribute("href"));
  return { button, popover };
}

async function main() {
  const managed = await startManagedServer();
  const browser = await chromium.launch();
  const events = [];
  let randomAvailable = true;
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 720, height: 640 } });
    await page.route("**/api/discovery/random**", (route) => route.fulfill(randomAvailable ? {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        town: { siteKey: "destination", name: "Mossy Corner", url: "https://destination.example/" },
      }),
    } : {
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "No other public towns are available right now." }),
    }));
    await page.route("**/api/discovery/event", async (route) => {
      events.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`${managed.httpOrigin}/dev/discovery-test.html`, { waitUntil: "networkidle" });

    const { button, popover } = await openPopover(page);
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    assert.equal((await button.textContent()).trim(), "", "compass control still rendered question-mark text");
    assert.ok(await button.locator("svg").count(), "compass control did not render an icon");
    assertInsideViewport(await popover.boundingBox(), { width: 720, height: 640 }, "desktop");

    const randomLink = page.getByRole("link", { name: /Visit another town/ });
    const buildLink = page.getByRole("link", { name: /Build your own TownSquare/ });
    assert.equal(await randomLink.getAttribute("target"), "_blank");
    assert.equal(await buildLink.getAttribute("target"), "_blank");
    assert.equal(await randomLink.getAttribute("href"), "https://destination.example/");
    assert.match(await buildLink.getAttribute("href"), /\/register$/);
    assert.ok(await page.getByText("Free & open source", { exact: true }).isVisible());
    const randomBox = await randomLink.boundingBox();
    const buildBox = await buildLink.boundingBox();
    assert.ok(randomBox && buildBox && Math.abs(randomBox.height - buildBox.height) <= 1, "primary actions were not equally prominent");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("townsquare__discovery-action")), true);
    await popover.screenshot({ path: path.join(OUT_DIR, "desktop.png") });

    await page.keyboard.press("Tab");
    assert.equal(await buildLink.evaluate((node) => node === document.activeElement), true, "Tab did not reach the second primary action");
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("link", { name: /View the map/ }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await popover.isHidden(), true);
    assert.equal(await button.evaluate((node) => node === document.activeElement), true, "Escape did not return focus to the compass");

    for (const link of [randomLink, buildLink, page.getByRole("link", { name: /View the map/ }), page.getByRole("link", { name: /What is TownSquare\?/ })]) {
      await openPopover(page);
      const label = await link.textContent();
      await link.evaluate((node) => node.addEventListener("click", (event) => event.preventDefault(), { capture: true, once: true }));
      await link.click();
      assert.equal(await popover.isHidden(), true, `${label} did not close the popover`);
    }

    await openPopover(page);
    await page.mouse.click(5, 500);
    assert.equal(await popover.isHidden(), true, "outside click did not close the popover");

    await page.setViewportSize({ width: 320, height: 480 });
    await openPopover(page);
    assertInsideViewport(await popover.boundingBox(), { width: 320, height: 480 }, "mobile");
    await popover.screenshot({ path: path.join(OUT_DIR, "mobile.png") });

    await page.keyboard.press("Escape");
    randomAvailable = false;
    await button.click();
    await page.getByText("No other towns available right now", { exact: true }).waitFor();
    assert.equal(await randomLink.getAttribute("aria-disabled"), "true");
    assert.equal(await randomLink.getAttribute("href"), null);
    await randomLink.evaluate((node) => node.click());
    assert.equal(await popover.isVisible(), true, "unavailable random action should stay safely inert");

    await page.setViewportSize({ width: 320, height: 280 });
    const shortBox = await popover.boundingBox();
    const shortButtonBox = await button.boundingBox();
    assertInsideViewport(shortBox, { width: 320, height: 280 }, "short mobile viewport");
    assert.ok(
      shortBox && shortButtonBox && (
        shortBox.y >= shortButtonBox.y + shortButtonBox.height
        || shortBox.y + shortBox.height <= shortButtonBox.y
      ),
      "short mobile viewport popover covered its compass anchor",
    );

    await page.waitForTimeout(200);
    assert.ok(events.filter((entry) => entry.event === "discovery_menu_opened").length >= 8);
    for (const event of ["random_town_clicked", "build_townsquare_clicked", "map_clicked", "about_clicked"]) {
      assert.equal(events.filter((entry) => entry.event === event).length, 1, `${event} was not reported exactly once`);
    }
    assert.ok(events.every((entry) => entry.siteKey === "source-site"));

    console.log(`Discovery widget test passed. Screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await managed.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Discovery widget test failed: ${error.message}`);
  process.exit(1);
});
