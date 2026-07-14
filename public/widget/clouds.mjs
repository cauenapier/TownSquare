/**
 * Ambient clouds — a decorative DOM layer that drifts across the sky.
 *
 * Purely client-side eye-candy: there are no server events behind it, and
 * motion is CSS-only (this module never runs in the animation frame loop).
 * The layer only paints in expanded mode — CSS keeps it hidden otherwise, so
 * the idle drift animations don't run while the widget is collapsed.
 */

// Also reused by weather.mjs for its rain/storm cloud banks.
export const CLOUD_SVG = `
  <svg viewBox="0 0 64 28" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M14 24
      C7 24 3 20 3 15
      C3 11 6 8 10 8
      C11 4 15 1 20 1
      C25 1 29 4 30 8
      C32 5 35 4 38 4
      C44 4 48 8 48 13
      C53 13 58 16 58 20
      C58 23 55 24 51 24
      Z"></path>
  </svg>
`;

// Each cloud gets its own lane (vertical band), size, speed, and start offset so
// the drift never reads as a single repeating strip.
const CLOUD_PRESETS = [
  { top: 8, scale: 1.0, duration: 64, delay: -20 },
  { top: 20, scale: 0.7, duration: 86, delay: -34 },
  { top: 32, scale: 1.25, duration: 52, delay: -18 },
  { top: 14, scale: 0.85, duration: 74, delay: -58 },
];

/**
 * @typedef {import("./context.mjs").WidgetContext & { cloudLayer?: HTMLElement }} CloudsContext
 */

/**
 * @param {HTMLElement} stage
 * @returns {HTMLElement}
 */
export function mountCloudLayer(stage) {
  const layer = document.createElement("div");
  layer.className = "townsquare__clouds";
  layer.setAttribute("aria-hidden", "true");

  for (const preset of CLOUD_PRESETS) {
    const cloud = document.createElement("div");
    cloud.className = "cloud";
    cloud.style.setProperty("--cloud-top", `${preset.top}%`);
    cloud.style.setProperty("--cloud-scale", String(preset.scale));
    cloud.style.setProperty("--cloud-duration", `${preset.duration}s`);
    cloud.style.setProperty("--cloud-delay", `${preset.delay}s`);
    cloud.innerHTML = CLOUD_SVG;
    layer.appendChild(cloud);
  }

  stage.appendChild(layer);
  return layer;
}

/**
 * @param {CloudsContext} ctx
 */
export function initClouds(ctx) {
  ctx.cloudLayer = mountCloudLayer(ctx.stage);
}

/**
 * @param {CloudsContext} ctx
 */
export function destroyClouds(ctx) {
  ctx.cloudLayer?.remove();
  ctx.cloudLayer = undefined;
}
