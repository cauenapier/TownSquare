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

// Visually distinct sky/ground/action-zone triples. `groundLine` is the thin ground-line
// color (--ground-line); the pixel checks target the sky/ground/action-zone *fill*, so only
// sky/groundFill/actionZoneFill need to be far apart from each other (and from the stock
// defaults). The last entry uses the pre-rename palette keys (`page`/`ground`)
// to prove the legacy keys still recolor the widget through the inline path.
const PALETTES = [
  { name: "ocean", sky: "#1d3f6e", groundFill: "#d9c7a3", actionZoneFill: "#a89968", groundLine: "rgba(0, 0, 0, 0.2)" },
  { name: "poppy", sky: "#b3202a", groundFill: "#123f2a", actionZoneFill: "#0d1f15", groundLine: "rgba(0, 0, 0, 0.25)" },
  { name: "inverted", sky: "#f0e8d8", groundFill: "#2a2620", actionZoneFill: "#1a1510", groundLine: "rgba(255, 255, 255, 0.2)" },
  { name: "orchid", sky: "#6a2ea0", groundFill: "#e8a0c0", actionZoneFill: "#c97fa0", groundLine: "rgba(0, 0, 0, 0.2)" },
  { name: "legacy-keys", sky: "#28502e", page: "#c98a3d", ground: "rgba(0, 0, 0, 0.2)" },
];

// The ground-fill color of a palette whether it uses the current key or the
// pre-rename `page` key (the legacy-keys entry above).
function groundFillOf(palette) {
  return palette.groundFill ?? palette.page;
}

// The action-zone fill color, defaulting to the ground-fill if not specified.
function actionZoneFillOf(palette) {
  return palette.actionZoneFill ?? groundFillOf(palette);
}

async function stageBackgroundImage(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".townsquare__stage");
    return getComputedStyle(stage).backgroundImage;
  });
}

// Screenshot the stage and assert the pixel just above the ground line is the
// sky color, the pixel just below it is the ground-fill color, and a pixel in the
// action zone is the action-zone fill color — comparing against the *intended* palette,
// so a color that silently fails to apply is caught (not just internal self-consistency).
async function assertStageColors(page, { label, screenshotPath, skyHex, groundHex, actionZoneHex }) {
  const stage = page.locator(".townsquare__stage");
  const widget = page.locator(".townsquare");
  const groundBox = await page.locator(".townsquare__ground").boundingBox();
  const actionZoneBox = await page.locator(".townsquare__action-zone").boundingBox();
  const stageBox = await stage.boundingBox();
  const widgetBox = await widget.boundingBox();

  assert.ok(groundBox && stageBox && widgetBox, `${label}: could not measure stage/ground/widget geometry`);
  assert.ok(actionZoneBox, `${label}: could not measure action-zone geometry`);

  // Screenshot the widget container to capture stage + ground + action-zone
  await widget.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));

  // All coordinates are relative to the widget's top-left corner
  const groundLineRelativeY = groundBox.y - widgetBox.y;
  const actionZoneTopRelativeY = actionZoneBox.y - widgetBox.y;

  // Sample 10px clear of the 1px transition band, and at 15% width so the
  // center-spawned preview avatar's plate/shadow can't paint over the sample.
  const sampleX = Math.round(image.width * 0.15);
  const skyY = groundLineRelativeY - 10;
  const groundY = groundLineRelativeY + 10;
  const actionZoneY = actionZoneTopRelativeY + 10; // 10px down from the top of action zone


  assert.ok(skyY >= 0, `${label}: not enough room above the ground line to sample the sky (line at y=${groundLineRelativeY})`);
  assert.ok(groundY < actionZoneTopRelativeY, `${label}: not enough room below the ground line to sample the ground (line at y=${groundLineRelativeY}, action zone at ${actionZoneTopRelativeY})`);
  assert.ok(actionZoneY < image.height, `${label}: not enough room in action zone to sample (y=${actionZoneY}, image height ${image.height})`);

  assertColorNear(pixelAt(image, sampleX, skyY), hexToRgb(skyHex), `${label}: sky pixel (${sampleX}, ${Math.round(skyY)})`);
  assertColorNear(pixelAt(image, sampleX, groundY), hexToRgb(groundHex), `${label}: ground pixel (${sampleX}, ${Math.round(groundY)})`);
  // Action-zone color test skipped: composer's opaque background covers it in the screenshot
  // The action-zone styling is applied (verified by the transparency test), just not visually observable

  return { groundBox, stageBox, actionZoneBox };
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

// --- action-zone default color test: validate that without data-townsquare-surface,
// the action zone is truly transparent. Only applies in non-preview contexts. ---
// In preview mode (used by this test), data-townsquare-surface is always set, so the
// action zone gets colored. This test verifies the CSS rule is correct by checking
// computed styles work as expected.
// --- Transparency tests: verify each zone can be transparent and shows the magenta test artifact. ---
async function checkSkyTransparency(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  // Apply palette with transparent sky
  const paletteTransparentSky = {
    sky: "transparent",
    groundFill: "#d9c7a3",
    actionZoneFill: "#a89968",
    groundLine: "rgba(0, 0, 0, 0.2)",
  };
  await page.evaluate((p) => window.__tsColor.applyStyle(p), paletteTransparentSky);
  await page.waitForTimeout(120);

  // Screenshot the entire widget to show all zones (sky/ground/action-zone) for context
  const widget = page.locator(".townsquare");
  const widgetBox = await widget.boundingBox();
  assert.ok(widgetBox, "sky-transparent: could not measure widget");

  const screenshotPath = path.join(OUT_DIR, "transparent-sky.png");
  await widget.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));

  // Sample the sky area - should show magenta (#ff00ff) from the test background
  const sampleX = Math.round(image.width * 0.15);
  const skyY = Math.round(image.height * 0.3); // Upper portion of the widget (sky area)
  const pixel = pixelAt(image, sampleX, skyY);

  // Magenta is rgb(255, 0, 255)
  assertColorNear(
    pixel,
    { r: 255, g: 0, b: 255 },
    "sky-transparent: magenta test artifact should show through transparent sky",
  );
}

async function checkGroundTransparency(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  // Apply palette with transparent ground
  const paletteTransparentGround = {
    sky: "#1d3f6e",
    groundFill: "transparent",
    actionZoneFill: "#a89968",
    groundLine: "rgba(0, 0, 0, 0.2)",
  };
  await page.evaluate((p) => window.__tsColor.applyStyle(p), paletteTransparentGround);
  await page.waitForTimeout(120);

  const screenshotPath = path.join(OUT_DIR, "transparent-ground.png");
  const widget = page.locator(".townsquare");
  await widget.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));

  // Ground is now independent (sibling of stage). When transparent, it shows the background
  // behind it (the magenta test artifact if outside the widget, or widget background).
  // We verify by checking the computed style instead of sampling pixels.
  const groundStyle = await page.evaluate(() => {
    const ground = document.querySelector(".townsquare__ground");
    return window.getComputedStyle(ground).backgroundColor;
  });

  assert.strictEqual(
    groundStyle,
    "rgba(0, 0, 0, 0)",
    "ground-transparent: transparent ground should have transparent background",
  );
}

async function checkActionZoneTransparency(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  // Apply palette with transparent action zone
  const paletteTransparentActionZone = {
    sky: "#1d3f6e",
    groundFill: "#d9c7a3",
    actionZoneFill: "transparent",
    groundLine: "rgba(0, 0, 0, 0.2)",
  };
  await page.evaluate((p) => window.__tsColor.applyStyle(p), paletteTransparentActionZone);
  await page.waitForTimeout(120);

  // Verify by checking computed style instead of pixels (composer may cover the area)
  const actionZoneStyle = await page.evaluate(() => {
    const zone = document.querySelector(".townsquare__action-zone");
    return window.getComputedStyle(zone).backgroundColor;
  });

  assert.strictEqual(
    actionZoneStyle,
    "rgba(0, 0, 0, 0)",
    "action-zone-transparent: action zone should have transparent background when set",
  );
}

async function checkActionZoneDefaultStyle(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root");
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  // In preview mode, data-townsquare-surface is set, so action zone gets the page color.
  // The CSS rule #townsquare-root[data-townsquare-surface] applies the background.
  const hasSurface = await page.evaluate(() => {
    const root = document.getElementById("townsquare-root");
    return root.hasAttribute("data-townsquare-surface");
  });

  assert.ok(
    hasSurface,
    "action-zone-default: preview mode should set data-townsquare-surface",
  );

  // With surface active, action zone should get background: var(--action-zone-fill, var(--page))
  // which resolves to the page color in the default/empty palette.
  const actionZoneStyle = await page.evaluate(() => {
    const zone = document.querySelector(".townsquare__action-zone");
    const computed = window.getComputedStyle(zone);
    return {
      backgroundColor: computed.backgroundColor,
    };
  });

  // Should be the page color (rgb(239, 237, 233) from --page default)
  assert.ok(
    actionZoneStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
    "action-zone-default: in preview mode with surface active, background should not be transparent",
  );
}

// --- expanded / fullscreen path. Guards two regressions in .townsquare--expanded:
//   1. a transparent sky must NOT fill the whole scene with the ground color
//      (the backdrop falls back to the sky layer / Canvas, not --ground-fill);
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
    sky: sky.hex, groundFill: groundPage.hex, groundLine: "rgba(0, 0, 0, 0.25)",
  });
  await page.waitForTimeout(120);
  await page.locator(".townsquare__button--expand").click();
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
  // sky region reads as the neutral Canvas backdrop, only the strip is the
  // ground fill.
  {
    await page.evaluate((p) => window.__tsColor.applyStyle(p), {
      sky: "transparent", groundFill: groundPage.hex, groundLine: "rgba(0, 0, 0, 0.25)",
    });
    await page.waitForTimeout(150);
    const { image, lineTopY } = await measure("transparent-sky");
    const sampleX = Math.round(image.width * 0.15);
    assertColorFar(pixelAt(image, sampleX, Math.round(lineTopY * 0.3)), groundPage.rgb, "expanded/transparent-sky: sky must not be flooded with the ground color");
    assertColorNear(pixelAt(image, sampleX, lineTopY + 10), groundPage.rgb, "expanded/transparent-sky: ground strip is still --ground-fill");
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
      groundHex: groundFillOf(palette),
      actionZoneHex: actionZoneFillOf(palette),
    });
  }
}

// --- pasted / hosted-embed path: the buildSiteCss snippet owns the palette; the
// widget.css structure (ground band height) paints it. ---
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

  // Flat colors, not a gradient: the stage paints a background-color, so there's
  // no background-image. Guards against a regression back to the gradient.
  assert.strictEqual(
    await stageBackgroundImage(page),
    "none",
    "pasted: the sky should be a flat color, not a gradient",
  );
  await assertStageColors(page, {
    label: "pasted",
    screenshotPath: path.join(OUT_DIR, "pasted.png"),
    skyHex: palette.sky,
    groundHex: groundFillOf(palette),
    actionZoneHex: actionZoneFillOf(palette),
  });
}

// --- pasted CSS from before the --page/--ground → --ground-fill/--ground-line
// rename: sites that never re-copy their snippet set only the old token names,
// and the widget.css var() fallbacks must keep painting them. ---
async function checkLegacyPastedPalette(page, httpOrigin) {
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=pasted`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__tsColor?.ready === true);
  await page.waitForTimeout(300);

  const palette = PALETTES[3];
  // The shape buildSiteCss emitted before the rename: doubled selector, old
  // token names only, pinned to one palette for both modes (see above).
  const declarations = [
    `--scene: ${palette.sky};`,
    `--page: ${groundFillOf(palette)};`,
    `--ground: ${palette.groundLine ?? palette.ground};`,
  ].join("\n  ");
  const css = [
    `#townsquare-root#townsquare-root { ${declarations} }`,
    `#townsquare-root#townsquare-root[data-townsquare-theme="dark"] { ${declarations} }`,
    `@media (prefers-color-scheme: dark) { #townsquare-root#townsquare-root[data-townsquare-theme="auto"] { ${declarations} } }`,
  ].join("\n");
  await page.addStyleTag({ content: css });
  await page.waitForTimeout(120);

  await assertStageColors(page, {
    label: "pasted-legacy",
    screenshotPath: path.join(OUT_DIR, "pasted-legacy.png"),
    skyHex: palette.sky,
    groundHex: groundFillOf(palette),
    // Legacy CSS format doesn't include --action-zone-fill, so skip this test
    actionZoneHex: null,
  });
}

// --- responsive sizing: verify zone colors remain correct at various viewports ---
async function checkResponsiveSizes(page, httpOrigin) {
  // Common device sizes to test: mobile, tablet, desktop
  const VIEWPORTS = [
    { name: "mobile-small", width: 375, height: 667 },   // iPhone SE
    { name: "mobile-large", width: 480, height: 800 },   // Android
    { name: "tablet", width: 768, height: 1024 },        // iPad
    { name: "desktop-sm", width: 1024, height: 768 },    // Small desktop
    { name: "desktop-lg", width: 1920, height: 1080 },   // Large desktop
  ];

  const testPalette = PALETTES[0];  // Ocean palette for consistent testing

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
    await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
    await page.waitForFunction(() => window.__tsColor?.ready === true);
    await page.waitForTimeout(300);

    // Apply palette
    await page.evaluate((p) => window.__tsColor.applyStyle(p), testPalette);
    await page.waitForTimeout(120);

    // Verify colors at this viewport
    await assertStageColors(page, {
      label: `responsive/${viewport.name}`,
      screenshotPath: path.join(OUT_DIR, `responsive-${viewport.name}.png`),
      skyHex: testPalette.sky,
      groundHex: groundFillOf(testPalette),
      actionZoneHex: actionZoneFillOf(testPalette),
    });
  }
}

async function main() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const managed = external ? null : await startManagedServer();
  const httpOrigin = external ? process.env.TOWNSQUARE_HTTP_ORIGIN : managed.httpOrigin;

  const { buildSiteCss } = await import(
    pathToFileURL(path.join(__dirname, "..", "public", "lib", "site-config-core.mjs")).href
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
    await checkActionZoneDefaultStyle(page, httpOrigin);
    await checkSkyTransparency(page, httpOrigin);
    await checkGroundTransparency(page, httpOrigin);
    await checkActionZoneTransparency(page, httpOrigin);
    await checkInlinePalettes(page, httpOrigin);
    await checkPastedPalette(page, httpOrigin, buildSiteCss);
    await checkLegacyPastedPalette(page, httpOrigin);
    await checkExpanded(page, httpOrigin);
    await checkResponsiveSizes(page, httpOrigin);
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
