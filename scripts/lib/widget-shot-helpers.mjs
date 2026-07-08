// Shared plumbing for the screenshot-based widget regression tests
// (ground-line-test.mjs, widget-color-test.mjs): spinning up an isolated
// managed server, decoding Chromium's PNG screenshots without an image
// dependency, and asserting sampled pixel colors.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

export function findFreePort() {
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

export async function waitForHealth(origin, timeoutMs = 8000) {
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

// Spawn a throwaway server (isolated data dir, dev tools enabled) so the dev
// fixtures under /dev are reachable. Returns the origin plus a cleanup fn.
export async function startManagedServer() {
  const port = await findFreePort();
  const host = "127.0.0.1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "townsquare-widget-shot-"));
  const httpOrigin = `http://${host}:${port}`;

  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server.js")], {
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
export function decodePng(buffer) {
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

export function pixelAt(image, x, y) {
  const idx = Math.round(y) * image.stride + Math.round(x) * image.channels;
  return { r: image.pixels[idx], g: image.pixels[idx + 1], b: image.pixels[idx + 2] };
}

export function hexToRgb(hex) {
  const clean = hex.trim().replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean;
  const num = Number.parseInt(value, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function assertColorNear(actual, expected, label) {
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
