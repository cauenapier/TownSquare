/**
 * Ambient birds — client-side DOM layer driven by server spawn/flee events.
 *
 * Motion is CSS-only; this module never runs in the animation frame loop.
 */

import { MAX_X, MIN_X } from "./constants.mjs";

const BIRD_FLYING_SVG = `
  <svg viewBox="0 0 12 8" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="bird-wing bird-wing--left" d="M6 2 L1 6"></path>
    <path class="bird-wing bird-wing--right" d="M6 2 L11 6"></path>
  </svg>
`;

const BIRD_PERCHED_SVG = `
  <svg viewBox="0 0 18 11" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <path d="M2.2 5.6 L0.8 4.8 L1 6.5"></path>
    <path d="M2.5 5.8 C2.2 3.8 4.5 2.6 7.2 2.8 C9.8 2.5 12 3.8 12.2 5.6 C12.3 7.2 10.8 8.4 8.4 8.4 C6.2 8.4 2.8 7.4 2.5 5.8"></path>
    <path d="M4.8 4.2 Q7.2 5.4 6.2 7.2"></path>
    <circle cx="11.8" cy="4.2" r="1.15"></circle>
    <line x1="12.8" y1="4.1" x2="15.2" y2="3.8"></line>
    <line x1="6.8" y1="8.4" x2="6.3" y2="11"></line>
    <line x1="9.2" y1="8.4" x2="9.7" y2="11"></line>
  </svg>
`;

/**
 * @param {BirdView} bird
 */
function setBirdFlyingArt(bird) {
  bird.el.innerHTML = BIRD_FLYING_SVG;
}

/**
 * @param {BirdView} bird
 */
function setBirdPerchedArt(bird) {
  bird.el.innerHTML = BIRD_PERCHED_SVG;
}

/**
 * @typedef {Object} BirdView
 * @property {HTMLElement} el
 * @property {number} x
 * @property {string} perchId
 */

/**
 * @typedef {import("./context.mjs").WidgetContext & { birds?: Map<number, BirdView>, birdLayer?: HTMLElement }} BirdsContext
 */

/**
 * @param {HTMLElement} stage
 * @returns {HTMLElement}
 */
export function mountBirdLayer(stage) {
  const layer = document.createElement("div");
  layer.className = "townsquare__birds";
  layer.setAttribute("aria-hidden", "true");
  stage.appendChild(layer);
  return layer;
}

/**
 * @param {BirdsContext} ctx
 */
export function initBirds(ctx) {
  ctx.birds = new Map();
  ctx.birdLayer = mountBirdLayer(ctx.stage);
}

/**
 * @param {BirdsContext} ctx
 * @param {string} perchId
 * @returns {{ x: number, liftPx: number } | null}
 */
function perchLayout(ctx, perchId) {
  const perch = ctx.birdPerchesById?.get(perchId);
  if (!perch) return null;
  return { x: perch.x, liftPx: perch.liftPx };
}

/**
 * @param {number} id
 * @param {number} x
 * @param {number} liftPx
 * @returns {BirdView}
 */
function createBirdElement(id, x, liftPx) {
  const el = document.createElement("div");
  el.className = "bird";
  el.dataset.birdId = String(id);
  el.style.setProperty("--bird-x", String(x));
  el.style.setProperty("--bird-lift", `${liftPx}px`);
  setBirdFlyingArt({ el });
  return { el, x, perchId: "" };
}

/**
 * @param {BirdsContext} ctx
 * @param {BirdView} bird
 * @param {string} perchId
 */
function setBirdPerch(ctx, bird, perchId) {
  bird.perchId = perchId;
  const layout = perchLayout(ctx, perchId);
  if (!layout) return;
  bird.x = layout.x;
  bird.el.style.setProperty("--bird-x", String(layout.x));
  bird.el.style.setProperty("--bird-lift", `${layout.liftPx}px`);
}

/**
 * @param {BirdView} bird
 */
function removeBirdElement(bird) {
  bird.el.remove();
}

/**
 * @param {"left" | "right"} from
 * @returns {number}
 */
function entryX(from) {
  return from === "left" ? MIN_X - 0.06 : MAX_X + 0.06;
}

/**
 * @param {BirdsContext} ctx
 * @param {number} id
 * @param {string} perchId
 * @param {number} x
 * @param {"left" | "right"} from
 */
function upsertArrivingBird(ctx, id, perchId, x, from) {
  if (!ctx.birdLayer || !ctx.birds) return;

  const layout = perchLayout(ctx, perchId);
  if (!layout) return;

  let bird = ctx.birds.get(id);
  if (!bird) {
    bird = createBirdElement(id, x, layout.liftPx);
    ctx.birds.set(id, bird);
    ctx.birdLayer.appendChild(bird.el);
  } else {
    setBirdPerch(ctx, bird, perchId);
  }

  bird.perchId = perchId;
  setBirdFlyingArt(bird);
  bird.el.className = "bird bird--arriving";
  bird.el.style.setProperty("--bird-from", String(entryX(from)));
  bird.el.style.setProperty("--bird-to", String(x));
  bird.el.style.setProperty("--bird-facing", from === "left" ? "1" : "-1");

  const onArrive = (event) => {
    if (event.animationName !== "bird-arrive") return;
    bird.el.removeEventListener("animationend", onArrive);
    setBirdPerchedArt(bird);
    bird.el.className = "bird bird--perched";
  };
  bird.el.addEventListener("animationend", onArrive);
}

/**
 * @param {BirdsContext} ctx
 * @param {number} id
 * @param {string} perchId
 * @param {number} x
 */
function upsertPerchedBird(ctx, id, perchId, x) {
  if (!ctx.birdLayer || !ctx.birds) return;

  const layout = perchLayout(ctx, perchId);
  if (!layout) return;

  let bird = ctx.birds.get(id);
  if (!bird) {
    bird = createBirdElement(id, x, layout.liftPx);
    bird.perchId = perchId;
    setBirdPerchedArt(bird);
    bird.el.className = "bird bird--perched";
    ctx.birds.set(id, bird);
    ctx.birdLayer.appendChild(bird.el);
    return;
  }

  setBirdPerch(ctx, bird, perchId);
  setBirdPerchedArt(bird);
  bird.el.className = "bird bird--perched";
}

/**
 * @param {BirdsContext} ctx
 * @param {Array<{ id: number, perchId: string, x: number, state?: string }>} birds
 */
export function syncBirdsFromHello(ctx, birds) {
  if (!ctx.birds || !ctx.birdLayer) return;

  for (const bird of birds || []) {
    if (typeof bird.id !== "number" || typeof bird.perchId !== "string") continue;
    upsertPerchedBird(ctx, bird.id, bird.perchId, bird.x);
  }
}

/**
 * @param {BirdsContext} ctx
 * @param {{ action: string, id: number, perchId: string, x: number, from?: "left" | "right" }} message
 */
export function applyBirdSpawn(ctx, message) {
  if (message.action !== "spawn") return;
  upsertArrivingBird(ctx, message.id, message.perchId, message.x, message.from || "left");
}

/**
 * @param {BirdsContext} ctx
 * @param {{ action: string, id: number, x: number, dir: number }} message
 */
export function applyBirdFlee(ctx, message) {
  if (message.action !== "flee" || !ctx.birds) return;

  const bird = ctx.birds.get(message.id);
  if (!bird) return;

  bird.x = message.x;
  bird.el.style.setProperty("--bird-x", String(message.x));
  bird.el.style.setProperty("--bird-dir", String(message.dir < 0 ? -1 : 1));
  bird.el.style.setProperty("--bird-facing", message.dir < 0 ? "-1" : "1");
  setBirdFlyingArt(bird);
  bird.el.className = "bird bird--fleeing";

  const onFlee = (event) => {
    if (event.animationName !== "bird-flee") return;
    bird.el.removeEventListener("animationend", onFlee);
    ctx.birds?.delete(message.id);
    removeBirdElement(bird);
  };
  bird.el.addEventListener("animationend", onFlee);
}

/**
 * @param {BirdsContext} ctx
 */
export function destroyBirds(ctx) {
  if (ctx.birds) {
    for (const bird of ctx.birds.values()) {
      removeBirdElement(bird);
    }
    ctx.birds.clear();
  }
  ctx.birdLayer?.remove();
  ctx.birdLayer = undefined;
}
