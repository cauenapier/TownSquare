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
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "tmp", "ground-line-test");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(origin, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("managed server did not become healthy in time");
}

async function startManagedServer() {
  const port = await findFreePort();
  const host = "127.0.0.1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "townsquare-ground-line-"));
  const httpOrigin = `http://${host}:${port}`;

  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      DATA_DIR: dataDir,
      ALLOWED_ORIGINS: httpOrigin,
      ENABLE_DEV_TOOLS: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForHealth(httpOrigin);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  return {
    httpOrigin,
    cleanup: () => {
      child.kill("SIGTERM");
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

// --- Minimal PNG decoder (8-bit, non-interlaced RGB/RGBA — what Chromium's
// screenshot encoder produces) so pixel colors can be asserted without adding
// an image-decoding dependency. ---
function decodePng(buffer) {
  let offset = 8; // skip the PNG signature
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 8 + length + 4; // length + type + data + crc
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  let prevLine = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const line = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const outLine = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? outLine[x - channels] : 0;
      const b = prevLine[x];
      const c = x >= channels ? prevLine[x - channels] : 0;
      let value = line[x];
      if (filterType === 1) value += a;
      else if (filterType === 2) value += b;
      else if (filterType === 3) value += Math.floor((a + b) / 2);
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      outLine[x] = value & 0xff;
    }
    outLine.copy(pixels, y * stride);
    prevLine = outLine;
  }

  return { width, height, channels, stride, pixels };
}

function pixelAt(image, x, y) {
  const idx = Math.round(y) * image.stride + Math.round(x) * image.channels;
  return { r: image.pixels[idx], g: image.pixels[idx + 1], b: image.pixels[idx + 2] };
}

function hexToRgb(hex) {
  const clean = hex.trim().replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean;
  const num = Number.parseInt(value, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

function assertColorNear(actual, expected, label) {
  const delta = Math.max(
    Math.abs(actual.r - expected.r),
    Math.abs(actual.g - expected.g),
    Math.abs(actual.b - expected.b),
  );
  assert.ok(
    delta <= 3,
    `${label}: expected rgb(${expected.r}, ${expected.g}, ${expected.b}), `
      + `got rgb(${actual.r}, ${actual.g}, ${actual.b}) (max channel delta ${delta})`,
  );
}

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
