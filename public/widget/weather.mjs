/**
 * Ambient weather — light rain, thunderstorm, and snow over the stage.
 *
 * Like the clouds, this layer is decorative and CSS-animated: JS only picks
 * the weather and scatters particle elements, then keyframes in widget.css do
 * all the motion (nothing here runs in the animation frame loop). Unlike the
 * clouds it also paints in the collapsed widget — precipitation, the sky tint,
 * and storm flashes are the at-a-glance tell — while the high-altitude detail
 * (weather clouds, lightning bolts, background depth precipitation) carries
 * the `weather--high` class and only shows in expanded mode, where the taller
 * sky gives it room.
 *
 * Which weather plays is a deterministic hash of the UTC hour, so every
 * visitor of a square sees the same sky at the same time with no server
 * involvement. The `weather` mount option (or `setWeatherOverride`, used by
 * the dev scene) pins it instead.
 */

import { CLOUD_SVG } from "./clouds.mjs";

export const WEATHER_KINDS = ["clear", "rain", "storm", "snow"];

const HOUR_MS = 60 * 60 * 1000;
const SCHEDULE_CHECK_MS = 60 * 1000;

const BOLT_SVG = `
  <svg viewBox="0 0 24 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M14 0 L4 21 H10 L6 40 L20 15 H12 L18 0 Z"></path>
  </svg>
`;

// Expanded-only weather clouds, hung high like the ambient ones but recolored
// per kind. Storms get a lower, heavier third bank.
const RAIN_CLOUD_PRESETS = [
  { top: 4, scale: 1.35, duration: 96, delay: -30 },
  { top: 13, scale: 1.0, duration: 118, delay: -72 },
];
const STORM_CLOUD_PRESETS = [
  { top: 2, scale: 1.7, duration: 88, delay: -24 },
  { top: 9, scale: 1.35, duration: 104, delay: -70 },
  { top: 17, scale: 1.1, duration: 78, delay: -48 },
];

// Two flash cycles with co-prime-ish periods so strikes never settle into an
// obvious loop. Bolts share a cycle's timing so they light up with its flash.
const STORM_FLASHES = [
  { duration: 9, delay: 0 },
  { duration: 13, delay: 4.5 },
];
const STORM_BOLTS = [
  { x: 24, top: 6, ...STORM_FLASHES[0] },
  { x: 66, top: 10, ...STORM_FLASHES[1] },
];

/**
 * @typedef {import("./context.mjs").WidgetContext & {
 *   weatherLayer?: HTMLElement,
 *   weather?: string,
 *   weatherOverride?: string | null,
 *   weatherTimer?: ReturnType<typeof setInterval> | null,
 * }} WeatherContext
 */

// Deterministic 0..1 hash of an hour index — every client agrees on it.
function hashHour(hourIndex) {
  let h = (hourIndex ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x045d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x045d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * The shared ambient forecast: mostly clear, with rain/snow spells and the
 * occasional thunderstorm, changing on the UTC hour for everyone at once.
 *
 * @param {number} [now]
 * @returns {string}
 */
export function scheduledWeather(now = Date.now()) {
  const r = hashHour(Math.floor(now / HOUR_MS));
  if (r < 0.58) return "clear";
  if (r < 0.75) return "rain";
  if (r < 0.92) return "snow";
  return "storm";
}

function normalizeWeather(kind) {
  return WEATHER_KINDS.includes(kind) ? kind : null;
}

/**
 * @param {{ high?: boolean, storm?: boolean }} [variant]
 * @returns {HTMLElement}
 */
function makeDrop({ high = false, storm = false } = {}) {
  const drop = document.createElement("div");
  drop.className = high ? "weather-drop weather--high" : "weather-drop";
  const duration = (storm ? 0.7 + Math.random() * 0.35 : 1.0 + Math.random() * 0.55)
    * (high ? 1.7 : 1);
  drop.style.setProperty("--wx", `${(Math.random() * 100).toFixed(1)}%`);
  drop.style.setProperty("--w-duration", `${duration.toFixed(2)}s`);
  drop.style.setProperty("--w-delay", `${(-Math.random() * 12).toFixed(2)}s`);
  drop.style.setProperty("--w-scale", ((high ? 0.5 : 0.8) + Math.random() * 0.35).toFixed(2));
  return drop;
}

/**
 * @param {{ high?: boolean }} [variant]
 * @returns {HTMLElement}
 */
function makeFlake({ high = false } = {}) {
  const flake = document.createElement("div");
  flake.className = high ? "weather-flake weather--high" : "weather-flake";
  const duration = high ? 7 + Math.random() * 4 : 4.5 + Math.random() * 3;
  flake.style.setProperty("--wx", `${(Math.random() * 100).toFixed(1)}%`);
  flake.style.setProperty("--w-duration", `${duration.toFixed(2)}s`);
  flake.style.setProperty("--w-delay", `${(-Math.random() * 16).toFixed(2)}s`);
  flake.style.setProperty("--w-scale", ((high ? 0.45 : 0.75) + Math.random() * 0.4).toFixed(2));
  flake.style.setProperty("--w-sway", `${(4 + Math.random() * 6).toFixed(1)}px`);
  flake.style.setProperty("--w-sway-duration", `${(1.8 + Math.random() * 1.6).toFixed(2)}s`);
  flake.appendChild(document.createElement("i"));
  return flake;
}

function makeWeatherCloud(preset) {
  const cloud = document.createElement("div");
  cloud.className = "cloud weather-cloud weather--high";
  cloud.style.setProperty("--cloud-top", `${preset.top}%`);
  cloud.style.setProperty("--cloud-scale", String(preset.scale));
  cloud.style.setProperty("--cloud-duration", `${preset.duration}s`);
  cloud.style.setProperty("--cloud-delay", `${preset.delay}s`);
  cloud.innerHTML = CLOUD_SVG;
  return cloud;
}

function makeFlash({ duration, delay }) {
  const flash = document.createElement("div");
  flash.className = "weather-flash";
  flash.style.setProperty("--flash-duration", `${duration}s`);
  flash.style.setProperty("--flash-delay", `${delay}s`);
  return flash;
}

function makeBolt({ x, top, duration, delay }) {
  const bolt = document.createElement("div");
  bolt.className = "weather-bolt weather--high";
  bolt.style.setProperty("--bolt-x", `${x}%`);
  bolt.style.setProperty("--bolt-top", `${top}%`);
  bolt.style.setProperty("--flash-duration", `${duration}s`);
  bolt.style.setProperty("--flash-delay", `${delay}s`);
  bolt.innerHTML = BOLT_SVG;
  return bolt;
}

/**
 * @param {HTMLElement} layer
 * @param {string} kind
 */
function buildWeather(layer, kind) {
  layer.replaceChildren();
  if (kind === "rain") {
    for (const preset of RAIN_CLOUD_PRESETS) layer.appendChild(makeWeatherCloud(preset));
    for (let i = 0; i < 12; i += 1) layer.appendChild(makeDrop({ high: true }));
    for (let i = 0; i < 14; i += 1) layer.appendChild(makeDrop());
  } else if (kind === "storm") {
    for (const preset of STORM_CLOUD_PRESETS) layer.appendChild(makeWeatherCloud(preset));
    for (const preset of STORM_BOLTS) layer.appendChild(makeBolt(preset));
    for (const preset of STORM_FLASHES) layer.appendChild(makeFlash(preset));
    for (let i = 0; i < 12; i += 1) layer.appendChild(makeDrop({ high: true, storm: true }));
    for (let i = 0; i < 20; i += 1) layer.appendChild(makeDrop({ storm: true }));
  } else if (kind === "snow") {
    for (let i = 0; i < 14; i += 1) layer.appendChild(makeFlake({ high: true }));
    for (let i = 0; i < 14; i += 1) layer.appendChild(makeFlake());
    const ground = document.createElement("div");
    ground.className = "weather-ground";
    layer.appendChild(ground);
  }
}

/**
 * @param {WeatherContext} ctx
 * @param {string} kind
 */
function applyWeather(ctx, kind) {
  if (!ctx.weatherLayer || ctx.weather === kind) return;
  ctx.weather = kind;
  for (const candidate of WEATHER_KINDS) {
    ctx.app.classList.toggle(`townsquare--weather-${candidate}`, candidate === kind);
  }
  buildWeather(ctx.weatherLayer, kind);
}

/**
 * @param {WeatherContext} ctx
 */
function currentWeather(ctx) {
  return ctx.weatherOverride || scheduledWeather();
}

/**
 * Pin the weather (dev scene, previews) or pass null to rejoin the shared
 * hourly schedule.
 *
 * @param {WeatherContext} ctx
 * @param {string | null} kind
 */
export function setWeatherOverride(ctx, kind) {
  ctx.weatherOverride = normalizeWeather(kind);
  applyWeather(ctx, currentWeather(ctx));
}

/**
 * @param {WeatherContext} ctx
 */
export function initWeather(ctx) {
  const layer = document.createElement("div");
  layer.className = "townsquare__weather";
  layer.setAttribute("aria-hidden", "true");
  ctx.stage.appendChild(layer);
  ctx.weatherLayer = layer;
  ctx.weather = "";
  ctx.weatherOverride = normalizeWeather(ctx.options.weather);
  applyWeather(ctx, currentWeather(ctx));
  // Follow the schedule across hour rollovers; a pinned override just keeps
  // winning inside currentWeather, so the timer stays armed either way.
  ctx.weatherTimer = setInterval(() => applyWeather(ctx, currentWeather(ctx)), SCHEDULE_CHECK_MS);
}

/**
 * @param {WeatherContext} ctx
 */
export function destroyWeather(ctx) {
  if (ctx.weatherTimer) clearInterval(ctx.weatherTimer);
  ctx.weatherTimer = null;
  for (const candidate of WEATHER_KINDS) {
    ctx.app.classList.remove(`townsquare--weather-${candidate}`);
  }
  ctx.weatherLayer?.remove();
  ctx.weatherLayer = undefined;
  ctx.weather = undefined;
  ctx.weatherOverride = undefined;
}
