// Screenshot regression test for the sky/ground colors painted behind the stage
// (see #townsquare-root[data-townsquare-surface] in widget.css and the matching
// pasted-CSS gradient from buildSiteCss). The sibling ground-line-test.mjs only
// checks the default palette, so it can't catch a color that fails to *apply*.
// This one drives several distinct palettes and asserts the rendered pixels.
//
// It exercises both theming paths:
//
//   1. inline / live-preview — mount with a `style` palette (applySiteStyle
//      writes inline vars + flips data-townsquare-surface). Recolored per
//      palette via the mount handle.
//
//   2. pasted / hosted-embed — the CSS a hosted site pastes into its own page
//      (buildSiteCss) owns the palette and the stage gradient. This path also
//      guards the version-skew bug we fixed: the gradient references
//      --ts-ground-offset (defined only in widget.css); when a host is still
//      serving a browser-cached older widget.css without that variable, a bare
//      var() would invalidate the whole gradient and the colors would vanish.
//      The 52px fallback must keep them painting — so this test simulates a
//      widget.css that never defined the variable and asserts the colors (and
//      the ground line) survive.
//
// Screenshots of every case are saved to `tmp/widget-color-test/` for review.
//
// Usage:
//   node scripts/widget-color-test.mjs
//
// Env:
//   TOWNSQUARE_HTTP_ORIGIN  test against an already-running server instead of
//                           spawning a managed one (must have ENABLE_DEV_TOOLS=1)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  assertColorNear,
  decodePng,
  hexToRgb,
  pixelAt,
  startManagedServer,
} from "./lib/widget-shot-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "widget-color-test");

// Visually distinct sky/ground pairs. `ground` is the thin ground-line color
// (--ground); the pixel checks target the sky/ground *fill*, so only sky/page
// need to be far apart from each other (and from the stock defaults).
const PALETTES = [
  { name: "ocean", sky: "#1d3f6e", page: "#d9c7a3", ground: "rgba(0, 0, 0, 0.2)" },
  { name: "poppy", sky: "#b3202a", page: "#123f2a", ground: "rgba(0, 0, 0, 0.25)" },
  { name: "inverted", sky: "#f0e8d8", page: "#2a2620", ground: "rgba(255, 255, 255, 0.2)" },
  { name: "orchid", sky: "#6a2ea0", page: "#e8a0c0", ground: "rgba(0, 0, 0, 0.2)" },
];

async function stageBackgroundImage(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".townsquare__stage");
    return getComputedStyle(stage).backgroundImage;
  });
}

// Screenshot the stage and assert the pixel just above the ground line is the
// sky color and the pixel just below it is the ground (page) color — comparing
// against the *intended* palette, so a color that silently fails to apply is
// caught (not just internal self-consistency).
async function assertStageColors(page, { label, screenshotPath, skyHex, pageHex }) {
  const stage = page.locator(".townsquare__stage");
  const groundBox = await page.locator(".townsquare__ground").boundingBox();
  const stageBox = await stage.boundingBox();
  assert.ok(groundBox && stageBox, `${label}: could not measure stage/ground geometry`);

  await stage.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));

  // Sample 10px clear of the 1px transition band, and at 15% width so the
  // center-spawned preview avatar's plate/shadow can't paint over the sample.
  const sampleX = Math.round(image.width * 0.15);
  const lineTopY = groundBox.y - stageBox.y;
  const skyY = lineTopY - 10;
  const groundY = lineTopY + 10;
  assert.ok(skyY >= 0, `${label}: not enough room above the ground line to sample the sky (line at y=${lineTopY})`);
  assert.ok(groundY < image.height, `${label}: not enough room below the ground line to sample the ground (line at y=${lineTopY}, image height ${image.height})`);

  assertColorNear(pixelAt(image, sampleX, skyY), hexToRgb(skyHex), `${label}: sky pixel (${sampleX}, ${Math.round(skyY)})`);
  assertColorNear(pixelAt(image, sampleX, groundY), hexToRgb(pageHex), `${label}: ground pixel (${sampleX}, ${Math.round(groundY)})`);

  return { groundBox, stageBox };
}

function colorDelta(actual, expected) {
  return Math.max(
    Math.abs(actual.r - expected.r),
    Math.abs(actual.g - expected.g),
    Math.abs(actual.b - expected.b),
  );
}

function assertColorFar(actual, expected, label, minDelta = 40) {
  const delta = colorDelta(actual, expected);
  assert.ok(
    delta >= minDelta,
    `${label}: expected a color clearly different from rgb(${expected.r}, ${expected.g}, ${expected.b}), `
      + `got rgb(${actual.r}, ${actual.g}, ${actual.b}) (max channel delta ${delta} < ${minDelta})`,
  );
}

// --- expanded / fullscreen path. Guards two regressions in .townsquare--expanded:
//   1. a transparent sky must NOT fill the whole scene with the ground color
//      (the backdrop falls back to the sky layer / Canvas, not --page);
//   2. no horizontal padding, so the full-bleed stage paints edge to edge with
//      no ground-colored strip down the sides.
async function checkExpanded(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  const sky = { hex: "#1d3f6e", rgb: hexToRgb("#1d3f6e") };
  const groundPage = { hex: "#2e7d32", rgb: hexToRgb("#2e7d32") };
  await page.evaluate((p) => window.__tsColor.applyStyle(p), {
    sky: sky.hex, page: groundPage.hex, ground: "rgba(0, 0, 0, 0.25)",
  });
  await page.waitForTimeout(120);
  await page.locator(".townsquare__control--expand").click();
  await page.waitForSelector(".townsquare--expanded");
  await page.waitForTimeout(300);

  // Screenshot the whole viewport (in absolute page coords) so the would-be
  // padding strip down the sides is in frame — an element screenshot of the
  // stage alone would crop it out.
  const measure = async (name) => {
    const groundBox = await page.locator(".townsquare__ground").boundingBox();
    assert.ok(groundBox, `expanded/${name}: could not measure ground geometry`);
    const screenshotPath = path.join(OUT_DIR, `expanded-${name}.png`);
    await page.screenshot({ path: screenshotPath });
    return { image: decodePng(fs.readFileSync(screenshotPath)), lineTopY: groundBox.y };
  };

  // Opaque sky/ground: sample at the very left edge, above the ground line, to
  // prove there's no ground-colored padding strip — the full-bleed stage paints
  // the sky right up to the viewport edge.
  {
    const { image, lineTopY } = await measure("opaque");
    assertColorNear(pixelAt(image, 4, Math.round(lineTopY * 0.4)), sky.rgb, "expanded/opaque: sky at left edge (no padding strip)");
    assertColorNear(pixelAt(image, image.width - 5, Math.round(lineTopY * 0.4)), sky.rgb, "expanded/opaque: sky at right edge (no padding strip)");
  }

  // Transparent sky: the scene must not be flooded with the ground color. The
  // sky region reads as the neutral Canvas backdrop, only the strip is --page.
  {
    await page.evaluate((p) => window.__tsColor.applyStyle(p), {
      sky: "transparent", page: groundPage.hex, ground: "rgba(0, 0, 0, 0.25)",
    });
    await page.waitForTimeout(150);
    const { image, lineTopY } = await measure("transparent-sky");
    const sampleX = Math.round(image.width * 0.15);
    assertColorFar(pixelAt(image, sampleX, Math.round(lineTopY * 0.3)), groundPage.rgb, "expanded/transparent-sky: sky must not be flooded with the ground color");
    assertColorNear(pixelAt(image, sampleX, lineTopY + 10), groundPage.rgb, "expanded/transparent-sky: ground strip is still --page");
  }
}

// --- inline / live-preview path: recolor via the mount handle. ---
async function checkInlinePalettes(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300); // let prop settle / initial layout finish

  for (const palette of PALETTES) {
    await page.evaluate((p) => window.__tsColor.applyStyle(p), palette);
    await page.waitForTimeout(120);
    await assertStageColors(page, {
      label: `inline/${palette.name}`,
      screenshotPath: path.join(OUT_DIR, `inline-${palette.name}.png`),
      skyHex: palette.sky,
      pageHex: palette.page,
    });
  }
}

// --- pasted / hosted-embed path: buildSiteCss owns the palette + gradient. ---
async function checkPastedPalette(page, httpOrigin, buildSiteCss) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=pasted`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  const palette = PALETTES[1];
  // Pin both modes to the same colors so theme resolution (light vs auto-dark)
  // can't swap in the stock dark palette under our assertions.
  const css = buildSiteCss({ light: palette, dark: palette });
  await page.addStyleTag({ content: css });
  await page.waitForTimeout(120);

  assert.notStrictEqual(
    await stageBackgroundImage(page),
    "none",
    "pasted-fresh: the pasted CSS should paint a stage gradient",
  );
  await assertStageColors(page, {
    label: "pasted-fresh",
    screenshotPath: path.join(OUT_DIR, "pasted-fresh.png"),
    skyHex: palette.sky,
    pageHex: palette.page,
  });

  // Simulate a host still serving a browser-cached older widget.css that never
  // defined --ts-ground-offset: `initial` reverts the custom property to the
  // guaranteed-invalid value, exactly as if the declaration were absent. Without
  // the 52px fallback this would drop the whole gradient (background-image:
  // none) and the ground line would lose its offset.
  await page.addStyleTag({
    content: "#townsquare-root .townsquare { --ts-ground-offset: initial; }",
  });
  await page.waitForTimeout(120);

  assert.notStrictEqual(
    await stageBackgroundImage(page),
    "none",
    "pasted-stale-widget-css: the 52px fallback should keep the gradient painting when --ts-ground-offset is absent",
  );
  const { groundBox, stageBox } = await assertStageColors(page, {
    label: "pasted-stale-widget-css",
    screenshotPath: path.join(OUT_DIR, "pasted-stale-widget-css.png"),
    skyHex: palette.sky,
    pageHex: palette.page,
  });

  // The ground line must also fall back to its 52px offset from the stage's
  // bottom edge (its inset uses the same variable).
  const offset = stageBox.y + stageBox.height - groundBox.y;
  assert.ok(
    Math.abs(offset - 52) <= 2,
    `pasted-stale-widget-css: ground line should fall back to 52px above the stage bottom, got ${offset.toFixed(1)}px`,
  );
}

async function main() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const managed = external ? null : await startManagedServer();
  const httpOrigin = external ? process.env.TOWNSQUARE_HTTP_ORIGIN : managed.httpOrigin;

  const { buildSiteCss } = await import(
    pathToFileURL(path.join(__dirname, "..", "public", "shared", "site-config-core.mjs")).href
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
    await checkInlinePalettes(page, httpOrigin);
    await checkPastedPalette(page, httpOrigin, buildSiteCss);
    await checkExpanded(page, httpOrigin);
    console.log(`Widget color test passed. Screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    managed?.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Widget color test failed: ${error.message}`);
  process.exit(1);
});
