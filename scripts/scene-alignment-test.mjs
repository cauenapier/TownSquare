// Screenshot regression test for scene grounding: every prop (bench, tree,
// lamp) and the visitor figure must visually TOUCH the ground line — no gap
// between the art's lowest rendered pixel and the top of the ground line, and
// no sinking below it. Also checks the sitting pose: the figure's seat must
// land on the bench's seat surface, not float above or clip below it.
//
// Measures real rendered pixels (device scale 3, so tolerances are in thirds
// of a CSS px) against the ground line's box edge, via the fixture
// public/dev/scene-alignment-test.html.
//
// Usage:
//   node scripts/scene-alignment-test.mjs            # assert
//   node scripts/scene-alignment-test.mjs --report   # just print measurements
//
// Env:
//   TOWNSQUARE_HTTP_ORIGIN  test against an already-running server instead of
//                           spawning a managed one (must have ENABLE_DEV_TOOLS=1)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { decodePng, startManagedServer } from "./lib/widget-shot-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "scene-alignment-test");
const SCALE = 3; // deviceScaleFactor: measure in 1/3 CSS px steps
const REPORT_ONLY = process.argv.includes("--report");

// "Touching" the ground line: the art's lowest ink may not float visibly above
// the line's top edge (max 1 device px of light), and may overlap it by at most
// the line's own thickness plus stroke rounding — path baselines sit ON the
// plane, so the fixed-px half-stroke/round-cap (~0.8-0.9px) hugs the 1px line.
const MAX_FLOAT_PX = 1 / SCALE;
const MAX_SINK_PX = 1.4;

function colorDelta(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function pixel(image, x, y) {
  const idx = y * image.stride + x * image.channels;
  return { r: image.pixels[idx], g: image.pixels[idx + 1], b: image.pixels[idx + 2] };
}

// Lowest row (in image px) within [x0,x1) x [y0,y1) whose color differs from
// `background` by more than `threshold` on some channel. Returns -1 if none.
function lowestForegroundRow(image, { x0, x1, y0, y1 }, background, threshold = 24) {
  for (let y = y1 - 1; y >= y0; y--) {
    for (let x = x0; x < x1; x++) {
      if (colorDelta(pixel(image, x, y), background) > threshold) return y;
    }
  }
  return -1;
}

async function measureScene(page, screenshotPath) {
  const stage = page.locator(".townsquare__stage");
  const stageBox = await stage.boundingBox();
  const groundBox = await page.locator(".townsquare__ground").boundingBox();
  assert.ok(stageBox && groundBox, "could not measure stage/ground geometry");

  await stage.screenshot({ path: screenshotPath });
  const image = decodePng(fs.readFileSync(screenshotPath));
  const skyRgb = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.getElementById("townsquare-root"))
      .getPropertyValue("--scene");
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g).map(Number);
    probe.remove();
    return { r: rgb[0], g: rgb[1], b: rgb[2] };
  });

  // Ground line top edge, in image rows: first row of the ground band.
  const lineTopRow = Math.round((groundBox.y - stageBox.y) * SCALE);

  return {
    stageBox,
    image,
    skyRgb,
    lineTopRow,
    // Gap between an element's lowest art pixel and the line top, in CSS px.
    // 0 = touching; positive = floating above; negative = sunk below the line.
    async gapFor(selector, { belowLineSlack = 0 } = {}) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `could not measure ${selector}`);
      const region = {
        x0: Math.max(0, Math.floor((box.x - stageBox.x) * SCALE)),
        x1: Math.min(image.width, Math.ceil((box.x + box.width - stageBox.x) * SCALE)),
        y0: Math.max(0, Math.floor((box.y - stageBox.y) * SCALE)),
        // Allow scanning slightly past the line when a pose may legitimately
        // overlap it; foreground detection still works there because the art's
        // ink differs from the ground fill as much as from the sky.
        y1: Math.min(image.height, lineTopRow + Math.round(belowLineSlack * SCALE)),
      };
      const row = lowestForegroundRow(image, region, skyRgb);
      assert.ok(row !== -1, `no rendered art found for ${selector}`);
      return (lineTopRow - (row + 1)) / SCALE;
    },
  };
}

async function main() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const managed = external ? null : await startManagedServer();
  const httpOrigin = external ? process.env.TOWNSQUARE_HTTP_ORIGIN : managed.httpOrigin;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 520, height: 420 },
      deviceScaleFactor: SCALE,
    });
    await page.goto(`${httpOrigin}/dev/scene-alignment-test.html`, { waitUntil: "networkidle" });
    await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
    await page.waitForFunction(() => window.__tsAlign?.ready === true);
    await page.waitForTimeout(400); // prop settle + initial layout

    const check = (label, gap) => {
      const ok = gap <= MAX_FLOAT_PX && gap >= -MAX_SINK_PX;
      console.log(`${ok ? "ok  " : "FAIL"} ${label}: gap to ground line = ${gap.toFixed(2)}px`);
      if (!ok) failures.push(`${label}: gap ${gap.toFixed(2)}px (want -${MAX_SINK_PX} <= gap <= ${MAX_FLOAT_PX.toFixed(2)})`);
    };

    // Move the visitor over a prop and force a pose class (pose classes are
    // pure CSS, so this exercises exactly what production applies).
    const poseOn = async (propSelector, poseClass) => {
      await page.evaluate(([sel, cls]) => {
        const avatar = document.querySelector(".townsquare-avatar--self");
        const prop = document.querySelector(sel);
        const stage = document.querySelector(".townsquare__stage");
        const propBox = prop.getBoundingClientRect();
        const stageBox = stage.getBoundingClientRect();
        const center = ((propBox.x + propBox.width / 2 - stageBox.x) / stageBox.width) * 100;
        avatar.style.setProperty("--avatar-x", String(center));
        avatar.classList.remove("townsquare-avatar--sitting", "townsquare-avatar--resting");
        if (cls) avatar.classList.add(cls);
      }, [propSelector, poseClass]);
      await page.waitForTimeout(400); // pose transition is 220ms
    };

    // --- standing: props and the visitor's feet touch the ground line ---
    {
      const scene = await measureScene(page, path.join(OUT_DIR, "standing.png"));
      check("bench", await scene.gapFor(".prop--bench", { belowLineSlack: 2 }));
      check("tree", await scene.gapFor(".prop--tree", { belowLineSlack: 2 }));
      check("lamp", await scene.gapFor(".prop--lamp", { belowLineSlack: 2 }));
      check("visitor feet", await scene.gapFor(".townsquare-avatar--self", { belowLineSlack: 2 }));
    }

    // --- sitting on the bench: feet stay planted, torso end rests on the seat ---
    {
      await poseOn(".prop--bench", "townsquare-avatar--sitting");
      const scene = await measureScene(page, path.join(OUT_DIR, "sitting.png"));
      // Feet: the pose's dangling feet must still touch the ground line (the
      // sitting bottom-offset in widget.css sinks the box by the pose's foot
      // drop precisely so this holds).
      check("sitting feet", await scene.gapFor(".townsquare-avatar--self", { belowLineSlack: 3 }));

      // Torso end vs seat: hip = box bottom + 14.4px (y=26 in the 42-unit
      // figure at 0.9 px/unit). It must land on the seat plank centerline
      // (--ts-bench-seat-height) within stroke-contact distance.
      const { hipAbovePlane, seatTopPx } = await page.evaluate(() => {
        const avatar = document.querySelector(".townsquare-avatar--self");
        const scoped = getComputedStyle(document.querySelector(".townsquare"));
        const plane = Number.parseFloat(scoped.getPropertyValue("--ts-ground-level"));
        return {
          hipAbovePlane: Number.parseFloat(getComputedStyle(avatar).bottom) + 14.4 - plane,
          seatTopPx: Number.parseFloat(scoped.getPropertyValue("--ts-bench-seat-height")),
        };
      });
      const seatGap = hipAbovePlane - seatTopPx;
      const ok = Math.abs(seatGap) <= 1.4; // half-strokes of torso cap + plank
      console.log(
        `${ok ? "ok  " : "FAIL"} sitting hip: ${hipAbovePlane.toFixed(2)}px above plane vs seat at ${seatTopPx}px (gap ${seatGap.toFixed(2)}px)`,
      );
      if (!ok) failures.push(`sitting hip: seat gap ${seatGap.toFixed(2)}px (want |gap| <= 1.4)`);
    }

    // --- resting under the tree: the lounging figure still touches the ground ---
    {
      await poseOn(".prop--tree", "townsquare-avatar--resting");
      const scene = await measureScene(page, path.join(OUT_DIR, "resting.png"));
      check("resting figure", await scene.gapFor(".townsquare-avatar--self", { belowLineSlack: 3 }));
    }

    if (REPORT_ONLY) {
      console.log("\n(report mode: not asserting)");
      return;
    }
    assert.equal(failures.length, 0, `scene alignment failures:\n${failures.join("\n")}`);
    console.log(`\nScene alignment test passed. Screenshots saved to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await managed?.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Scene alignment test failed: ${error.message}`);
  process.exit(1);
});
