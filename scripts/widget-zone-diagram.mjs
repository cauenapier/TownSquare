// Generate a visual zone diagram that labels and identifies all the widget zones.
// This helps verify that the action-zone and other regions are correctly colored
// and positioned. Creates annotated screenshots showing zone boundaries.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startManagedServer } from "./lib/widget-shot-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "widget-zone-diagram");

async function generateZoneDiagram(page, httpOrigin) {
  // Navigate to expanded view with ocean palette
  await page.goto(`${httpOrigin}/dev/widget-color-test.html?mode=inline`, { waitUntil: "networkidle" });
  await page.waitForSelector("#townsquare-root[data-townsquare-surface]");
  await page.waitForFunction(() => window.__tsColor?.ready === true);

  // Apply ocean palette
  const oceanPalette = {
    sky: "#1d3f6e",
    groundFill: "#d9c7a3",
    actionZoneFill: "#a89968",
    groundLine: "rgba(0, 0, 0, 0.2)",
  };
  await page.evaluate((p) => window.__tsColor.applyStyle(p), oceanPalette);
  await page.waitForTimeout(300);

  // Expand to full-screen
  await page.locator(".townsquare__control--expand").click();
  await page.waitForSelector(".townsquare--expanded");
  await page.waitForTimeout(300);

  // Get zone measurements
  const zones = await page.evaluate(() => {
    const widgets = {
      townsquare: document.querySelector(".townsquare"),
      stage: document.querySelector(".townsquare__stage"),
      ground: document.querySelector(".townsquare__ground"),
      actionZone: document.querySelector(".townsquare__action-zone"),
      toolbar: document.querySelector(".townsquare__toolbar"),
      composer: document.querySelector(".townsquare-avatar__composer"),
      profileBtn: document.querySelector(".townsquare__toolbar .townsquare-avatar__profile-button"),
    };

    const zones = {};
    for (const [name, el] of Object.entries(widgets)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      zones[name] = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        computed: {
          background: window.getComputedStyle(el).backgroundColor,
          display: window.getComputedStyle(el).display,
        },
      };
    }
    return zones;
  });

  console.log("\n=== Widget Zone Diagram ===\n");
  console.log("Zone Layout (from top to bottom):\n");

  for (const [name, zone] of Object.entries(zones)) {
    console.log(`${name}:`);
    console.log(`  Position: x=${zone.x}, y=${zone.y}`);
    console.log(`  Size: ${zone.width}px × ${zone.height}px`);
    console.log(`  Background: ${zone.computed.background}`);
    console.log(`  Display: ${zone.computed.display}`);
    console.log();
  }

  // Create annotated screenshot
  const screenshotPath = path.join(OUT_DIR, "zone-diagram-expanded.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Generate SVG overlay with zone labels
  const svgPath = path.join(OUT_DIR, "zone-labels.svg");
  const svgContent = generateZoneLabelSvg(zones);
  fs.writeFileSync(svgPath, svgContent);

  console.log(`Screenshots saved to ${OUT_DIR}`);
  console.log(`  - zone-diagram-expanded.png (full page)`);
  console.log(`  - zone-labels.svg (zone boundaries and labels)`);

  return zones;
}

function generateZoneLabelSvg(zones) {
  if (!zones.townsquare) return "<svg></svg>";

  const tsZone = zones.townsquare;
  const width = tsZone.width;
  const height = tsZone.height;

  const zoneColors = {
    stage: "#4CAF50",      // green
    ground: "#FFC107",     // amber
    actionZone: "#2196F3", // blue
    toolbar: "#FF5722",    // deep orange
    composer: "#9C27B0",   // purple
  };

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .zone-label { font-family: monospace; font-size: 12px; font-weight: bold; fill: white; text-shadow: 1px 1px 2px black; }
        .zone-rect { fill: none; stroke-width: 2; opacity: 0.7; }
      </style>
    </defs>
    <rect width="${width}" height="${height}" fill="#f0f0f0" opacity="0.1"/>
  `;

  for (const [name, color] of Object.entries(zoneColors)) {
    const zone = zones[name];
    if (!zone) continue;

    const relX = zone.x - zones.townsquare.x;
    const relY = zone.y - zones.townsquare.y;
    const x = Math.max(0, relX);
    const y = Math.max(0, relY);
    const w = Math.min(zone.width, width - x);
    const h = Math.min(zone.height, height - y);

    if (w > 0 && h > 0) {
      svg += `
    <!-- ${name} -->
    <rect x="${x}" y="${y}" width="${w}" height="${h}" class="zone-rect" stroke="${color}"/>
    <text x="${x + 4}" y="${y + 16}" class="zone-label" fill="${color}">${name}</text>
      `;
    }
  }

  svg += "\n</svg>";
  return svg;
}

async function main() {
  const external = Boolean(process.env.TOWNSQUARE_HTTP_ORIGIN);
  const managed = external ? null : await startManagedServer();
  const httpOrigin = external ? process.env.TOWNSQUARE_HTTP_ORIGIN : managed.httpOrigin;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 1000 } });
    await generateZoneDiagram(page, httpOrigin);
  } finally {
    await browser.close();
    managed?.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || `Zone diagram generation failed: ${error.message}`);
  process.exit(1);
});
