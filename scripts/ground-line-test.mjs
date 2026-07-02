// Regression test for the sky/ground color split painted behind the stage
// (see #townsquare-root[data-townsquare-surface] in widget.css).
//
// The gradient used to switch color at a fixed 72% of the stage's height,
// which only lined up with the actual ground line (.townsquare__ground, a
// fixed 52px above the stage's bottom edge) when the stage was exactly
// 180px tall — the default collapsed size. In expanded mode the stage is
// flex-sized (much taller), so the ground color started 72% down from the
// top, well above the real line.
//
// This is self-contained: it spawns its own server (isolated data dir, dev
// tools enabled) and mounts a static customization-preview widget instance
// via public/dev/ground-line-test.html, then checks — in both collapsed and
// expanded layout — that the rendered pixel just above the ground line is
// the sky color and the pixel just below it is the ground (page) color.
// Screenshots of the stage are saved to `tmp/ground-line-test/` for visual
// review alongside the pixel assertions.
//
// Usage:
//   node scripts/ground-line-test.mjs
//
// Env:
//   TOWNSQUARE_HTTP_ORIGIN  test against an already-running server instead of
//                           spawning a managed one (must have ENABLE_DEV_TOOLS=1)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assertColorNear,
  decodePng,
  hexToRgb,
  pixelAt,
  startManagedServer,
} from "./lib/widget-shot-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "ground-line-test");

async function checkStage(page, { label, screenshotPath }) {
  const stage = page.locator(".townsquare__stage");
  const groundBox = await page.locator(".townsquare__ground").boundingBox();
  const stageBox = await stage.boundingBox();
  assert.ok(groundBox && stageBox, `${label}: could not measure stage/ground geometry`);

  const { scene, page: pageColor } = await page.evaluate(() => {
    const root = document.getElementById("townsquare-root");
    const styles = getComputedStyle(root);
    return {
      scene: styles.getPropertyValue("--scene").trim(),
      page: styles.getPropertyValue("--page").trim(),
    };
  });

  await stage.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));

  // Sample well clear of the 1px transition band (10px to either side) so
  // anti-aliasing at the boundary can't produce a false pass or failure. Also
  // stay away from the horizontal center: the preview avatar spawns there
  // (PREVIEW_SPAWN_X), and its shadow/plate would otherwise paint over the
  // sample point with --surface instead of the sky/ground colors under test.
  const sampleX = Math.round(image.width * 0.15);
  const lineTopY = groundBox.y - stageBox.y;
  const skyY = lineTopY - 10;
  const groundY = lineTopY + 10;
  assert.ok(skyY >= 0, `${label}: not enough room above the ground line to sample the sky (line at y=${lineTopY})`);
  assert.ok(groundY < image.height, `${label}: not enough room below the ground line to sample the ground (line at y=${lineTopY}, image height ${image.height})`);

  assertColorNear(pixelAt(image, sampleX, skyY), hexToRgb(scene), `${label}: sky pixel (${sampleX}, ${Math.round(skyY)})`);
  assertColorNear(pixelAt(image, sampleX, groundY), hexToRgb(pageColor), `${label}: ground pixel (${sampleX}, ${Math.round(groundY)})`);
}

async function main() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const managed = external ? null : await startManagedServer();
  const httpOrigin = external ? process.env.TOWNSQUARE_HTTP_ORIGIN : managed.httpOrigin;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
    await page.goto(`${httpOrigin}/dev/ground-line-test.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
    await page.waitForTimeout(300); // let prop settle / initial layout finish

    await checkStage(page, {
      label: "collapsed",
      screenshotPath: path.join(OUT_DIR, "collapsed.png"),
    });

    await page.locator(".townsquare__control--expand").click();
    await page.waitForSelector(".townsquare--expanded");
    await page.waitForTimeout(300);

    await checkStage(page, {
      label: "expanded",
      screenshotPath: path.join(OUT_DIR, "expanded.png"),
    });

    console.log(`Ground line test passed. Screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    managed?.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Ground line test failed: ${error.message}`);
  process.exit(1);
});
