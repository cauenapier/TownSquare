// Widget screenshot matrix for responsive UI review.
//
// Boots against a running server (default http://localhost:8099) and captures
// the embeddable widget at a range of viewport widths, using the offline dev
// scene so the crowd is populated without a live socket. Also reports console
// errors and horizontal-overflow geometry so layout regressions are catchable.
//
// Usage:
//   ENABLE_DEV_TOOLS=1 PORT=8099 node server.js &
//   node scripts/widget-shots.mjs
//
// Env:
//   BASE        server origin (default http://localhost:8099)
//   OUT         output directory (default ./tmp/widget-shots)
//   CHARACTERS  simulated crowd size (default 8)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8099";
const OUT = process.env.OUT || "./tmp/widget-shots";
const CHARACTERS = Number(process.env.CHARACTERS || 8);
mkdirSync(OUT, { recursive: true });

// width x height, label. Heights are generous so nothing is cut by the viewport.
const VIEWPORTS = [
  [320, 700, "320-small-phone"],
  [375, 812, "375-iphone"],
  [390, 844, "390-phone"],
  [768, 1024, "768-tablet"],
  [1280, 900, "1280-laptop"],
];

const browser = await chromium.launch();
const results = [];

for (const [width, height, label] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

  await page.goto(`${BASE}/dev?offline=1&characters=${CHARACTERS}`, { waitUntil: "networkidle" });
  // Let the crowd spread out and chat bubbles appear.
  await page.waitForTimeout(3500);

  const host = page.locator(".dev-host");
  await host.screenshot({ path: `${OUT}/widget-${label}.png` });

  // Geometry sanity: does the widget overflow horizontally?
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#dev-scene-root");
    if (!el) return null;
    return {
      overflowX: el.scrollWidth - el.clientWidth,
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      width: Math.round(el.getBoundingClientRect().width),
    };
  });

  // Focus the chat composer and capture that state, then check whether the
  // composer covers any peer name tags. The composer is docked in the fixed
  // bottom bar (legacy float exposed a plate to click open; if present, click it).
  const plate = page.locator(".townsquare-avatar__plate").first();
  let composer = null;
  const input = page.locator(".townsquare-avatar__input").first();
  if (await plate.count()) await plate.click();
  if (await input.count()) {
    await input.focus();
    await page.waitForTimeout(500);
    await host.screenshot({ path: `${OUT}/widget-${label}-composer.png` });

    composer = await page.evaluate(() => {
      const form = document.querySelector(".townsquare-avatar__composer:not([hidden])")
        || document.querySelector(".townsquare-avatar__input")?.closest(".townsquare-avatar__composer");
      if (!form) return { open: false };
      const c = form.getBoundingClientRect();
      const intersects = (a, b) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      // Peer name tags that the open composer visually covers.
      const covered = [...document.querySelectorAll(".townsquare-avatar__peer-label")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width && r.height && intersects(c, r))
        .map(({ el }) => el.textContent.trim());
      return { open: true, coversNameTags: covered.length, covered };
    });
  }

  // Name tags must not cover one another (incl. your own over a peer's): report
  // the worst horizontal overlap between any two visible tags.
  const labels = await page.evaluate(() => {
    const tags = [...document.querySelectorAll(".townsquare-avatar__below")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height);
    let worst = 0;
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i], b = tags[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 0 && oy > 0) worst = Math.max(worst, ox);
      }
    }
    return { count: tags.length, worstHorizontalOverlapPx: Math.round(worst) };
  });

  // Hover the character nearest your figure and confirm its history tray opens
  // in front of everything (not painted over by neighbours or your own figure).
  let tray = null;
  // Freeze the crowd so labels stop moving and we can aim a real pointer at one.
  const walkingToggle = page.locator("#characters-walking");
  if (await walkingToggle.count() && await walkingToggle.isChecked()) {
    await walkingToggle.uncheck();
    await page.waitForTimeout(400);
  }
  const hoverPoint = await page.evaluate(() => {
    const self = document.querySelector(".townsquare-avatar--self")?.getBoundingClientRect();
    if (!self) return null;
    const sx = self.left + self.width / 2;
    const peers = [...document.querySelectorAll(".townsquare-avatar--peer.townsquare-avatar--has-history")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.querySelector(".townsquare-avatar__peer-label");
        const lr = label?.getBoundingClientRect();
        return { el, d: Math.abs(r.left + r.width / 2 - sx), lr };
      })
      .filter((p) => p.lr?.width && p.lr.height)
      .sort((a, b) => a.d - b.d);
    for (const { el, lr } of peers) {
      const x = lr.left + lr.width / 2;
      const y = lr.top + lr.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { x, y };
    }
    return null;
  });
  if (hoverPoint) {
    // Real mouse position triggers CSS :hover; locator.hover() fails when avatars
    // walk or a neighbour's label sits on top of the target.
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await page.waitForTimeout(500);
    await host.screenshot({ path: `${OUT}/widget-${label}-tray.png` });
    tray = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".townsquare-avatar__tray")]
        .find((t) => Number(getComputedStyle(t).opacity) > 0.5 && t.getBoundingClientRect().width);
      if (!el) return { open: false };
      const r = el.getBoundingClientRect();
      // Sample interior points: every topmost element should belong to the tray.
      let covered = 0, samples = 0;
      for (let gx = 0.15; gx <= 0.85; gx += 0.175) {
        for (let gy = 0.2; gy <= 0.8; gy += 0.2) {
          const top = document.elementFromPoint(r.left + r.width * gx, r.top + r.height * gy);
          samples++;
          if (top && !el.contains(top)) covered++;
        }
      }
      return { open: true, z: getComputedStyle(el.closest(".townsquare-avatar")).zIndex, coveredBySomethingElse: covered, samples };
    });
  }

  results.push({ label, viewport: width, overflow, composer, labels, tray, errs });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
