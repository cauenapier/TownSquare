/**
 * Dev scene: the real TownSquare widget driven by simulated peers.
 *
 * The page mounts `mountTownSquare` in `simulate` mode, so the "you" figure and
 * the whole runtime — movement, tap-to-walk, jump/high-five, quiet, chat, prop
 * settle, birds, layout — are exactly the production code. The only thing this
 * file owns is the crowd: simulated visitors that wander and chatter, fed
 * through the same peer API the socket uses, plus the reading-tuning panel.
 */

import { mountTownSquare } from "../townsquare.mjs";
import { DEFAULT_LAYOUT_CONFIG } from "../widget/bubble-layout.mjs";
import { sayMessage } from "../widget/chat.mjs";
import { CHARACTER_COLORS, MAX_X, MIN_X, randomSpawnX } from "../widget/constants.mjs";
import { setWalking } from "../widget/dom.mjs";
import { clamp } from "../widget/math.mjs";
import { applyPeerState, removePeer } from "../widget/presence.mjs";
import { syncBirdsFromHello } from "../widget/birds.mjs";
import { bindCopy } from "../lib/ui-common.mjs";

const DEFAULT_CHARACTER_COUNT = 12;
const MAX_CHARACTER_COUNT = 60;
const MIN_CHARACTER_COUNT = 1;
const MOVEMENT_SPEED_MIN = 0.018;
const MOVEMENT_SPEED_MAX = 0.055;
const LINES = [
  "Anyone else seeing this?",
  "Heading over there.",
  "I found a quiet spot.",
  "That corner is busy.",
  "One sec.",
  "Looks good from here.",
  "Can you try it again?",
  "I am walking the route now.",
  "Meet by the bench.",
  "This feels more alive.",
];

/**
 * Live tuning state, read every frame by the running scene. `layout` is a stable
 * object the production loop reads through `ctx.options.layout`, so sliders that
 * mutate it in place land without rebuilding (and resetting) the scene.
 */
const tuning = {
  layout: { ...DEFAULT_LAYOUT_CONFIG },
  /** Multiplier on how often simulated visitors speak; 1 = baseline. */
  talkRate: 1,
};

const root = document.getElementById("dev-scene-root");
const form = document.getElementById("dev-controls");
const countInput = document.getElementById("character-count");
const walkingInput = document.getElementById("characters-walking");

if (!(root instanceof HTMLElement)) {
  throw new Error("Dev scene root element not found");
}

if (
  !(form instanceof HTMLFormElement)
  || !(countInput instanceof HTMLInputElement)
  || !(walkingInput instanceof HTMLInputElement)
) {
  throw new Error("Dev scene controls not found");
}

function readCount() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("characters") || params.get("count") || String(DEFAULT_CHARACTER_COUNT);
  return clamp(Number.parseInt(raw, 10) || DEFAULT_CHARACTER_COUNT, MIN_CHARACTER_COUNT, MAX_CHARACTER_COUNT);
}

function writeCount(count) {
  const url = new URL(window.location.href);
  url.searchParams.set("characters", String(count));
  url.searchParams.delete("count");
  window.history.replaceState(null, "", url);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Mount the production widget once and drive a wandering crowd of simulated
 * peers through its real peer API. Returns controls the page wires to the form.
 *
 * @param {import("../widget/context.mjs").WidgetContext} ctx
 */
function createSimulation(ctx) {
  /** @type {Array<{ id: string, x: number, direction: number, speed: number, nextTurnAt: number, nextSayAt: number }>} */
  let actors = [];
  let walking = true;
  let random = seededRandom(1);
  let frame = null;
  let lastFrameAt = performance.now();

  function clearActors() {
    for (const actor of actors) removePeer(ctx, actor.id);
    actors = [];
  }

  function setSceneStatus(count) {
    ctx.statusRowEl.hidden = false;
    ctx.statusEl.textContent = `You plus ${count} simulated ${count === 1 ? "character" : "characters"}`;
  }

  function setCount(count) {
    clearActors();
    random = seededRandom(count * 9973);
    const now = performance.now();
    actors = Array.from({ length: count }, (_, index) => {
      const id = `sim-${index + 1}`;
      const x = randomSpawnX(random);
      applyPeerState(ctx, {
        id,
        x,
        displayName: `Visitor ${index + 1}`,
        color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
      });
      return {
        id,
        x,
        direction: random() < 0.5 ? -1 : 1,
        speed: MOVEMENT_SPEED_MIN + random() * (MOVEMENT_SPEED_MAX - MOVEMENT_SPEED_MIN),
        nextTurnAt: now + 1000 + random() * 3500,
        nextSayAt: now + 500 + random() * 5000,
      };
    });
    setSceneStatus(count);
  }

  function stepActor(actor, now, dt) {
    const peer = ctx.peers.get(actor.id);
    if (!peer) return;

    if (walking) {
      if (now >= actor.nextTurnAt) {
        actor.direction = random() < 0.5 ? -1 : 1;
        actor.nextTurnAt = now + 1200 + random() * 4400;
      }
      actor.x += actor.direction * actor.speed * dt;
      if (actor.x <= MIN_X || actor.x >= MAX_X) {
        actor.x = clamp(actor.x, MIN_X, MAX_X);
        actor.direction *= -1;
        actor.nextTurnAt = now + 900 + random() * 2500;
      }
      // applyPeerState re-renders the figure and faces it by its movement delta,
      // exactly as an incoming "move" message would.
      applyPeerState(ctx, { id: actor.id, x: actor.x });
      setWalking(peer.avatar, true);
    } else {
      setWalking(peer.avatar, false);
    }

    if (now >= actor.nextSayAt) {
      sayMessage(peer.avatar, { text: LINES[Math.floor(random() * LINES.length)], at: Date.now() });
      actor.nextSayAt = now + (2500 + random() * 8500) / tuning.talkRate;
    }
  }

  const tick = (now) => {
    const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    for (const actor of actors) stepActor(actor, now, dt);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    setCount,
    setWalking(next) {
      walking = next;
    },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame);
      clearActors();
    },
  };
}

/**
 * Seed a few perched birds so the no-socket dev scene still shows the ambient
 * layer. Uses the real bird code path; in production these arrive from the server.
 *
 * @param {import("../widget/context.mjs").WidgetContext} ctx
 */
function seedBirds(ctx) {
  const perches = [...ctx.birdPerchesById.values()].slice(0, 3);
  syncBirdsFromHello(ctx, perches.map((perch, index) => ({
    id: index + 1,
    perchId: perch.id,
    x: perch.x,
  })));
}

const { ctx } = mountTownSquare(root, { simulate: true, layout: tuning.layout });
seedBirds(ctx);
const simulation = createSimulation(ctx);

function applyCount(count) {
  countInput.value = String(count);
  writeCount(count);
  simulation.setCount(count);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCount(clamp(Number.parseInt(countInput.value, 10) || DEFAULT_CHARACTER_COUNT, MIN_CHARACTER_COUNT, MAX_CHARACTER_COUNT));
});

walkingInput.addEventListener("change", () => {
  simulation.setWalking(walkingInput.checked);
});

// --- Live tuning panel: proximity dials, talk rate, mobile frame -----------
// Sliders mutate `tuning` in place, so the running widget loop picks changes up
// on its next frame — no rebuild, no reset. The readout mirrors the current
// values so good settings can be read off and baked into DEFAULT_LAYOUT_CONFIG.

const host = document.querySelector(".dev-host");
const tuneInputs = /** @type {HTMLInputElement[]} */ (Array.from(document.querySelectorAll("[data-tune]")));
const frameButtons = /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll("[data-frame]")));
const readout = document.getElementById("tune-readout");
const resetButton = document.getElementById("tune-reset");
const copyButton = document.getElementById("tune-copy");

function currentValue(key) {
  return key === "talkRate" ? tuning.talkRate : tuning.layout[key];
}

function setTuning(key, value) {
  if (key === "talkRate") tuning.talkRate = value;
  else tuning.layout[key] = value;
}

function refreshReadout() {
  if (!readout) return;
  const lines = Object.entries(tuning.layout).map(([key, value]) => `  ${key}: ${value},`);
  readout.textContent = `talkRate: ${tuning.talkRate}\nlayout {\n${lines.join("\n")}\n}`;
}

function syncInput(input) {
  const key = input.dataset.tune;
  if (!key) return;
  input.value = String(currentValue(key));
  const label = input.parentElement?.querySelector("[data-tune-value]");
  if (label) label.textContent = String(currentValue(key));
}

for (const input of tuneInputs) {
  syncInput(input);
  input.addEventListener("input", () => {
    const key = input.dataset.tune;
    if (!key) return;
    setTuning(key, Number(input.value));
    syncInput(input);
    refreshReadout();
  });
}

function setFrame(width, button) {
  if (host instanceof HTMLElement) {
    host.style.maxWidth = width === "full" ? "" : `${width}px`;
    host.classList.toggle("dev-host--framed", width !== "full");
  }
  for (const candidate of frameButtons) {
    candidate.setAttribute("aria-pressed", String(candidate === button));
  }
}

for (const button of frameButtons) {
  button.addEventListener("click", () => setFrame(button.dataset.frame || "full", button));
}

resetButton?.addEventListener("click", () => {
  // Mutate in place so the loop keeps reading the same `tuning.layout` object.
  Object.assign(tuning.layout, DEFAULT_LAYOUT_CONFIG);
  tuning.talkRate = 1;
  for (const input of tuneInputs) syncInput(input);
  refreshReadout();
});

bindCopy(copyButton, {
  text: () => readout?.textContent || "",
  failedLabel: "Copy failed",
});

refreshReadout();

applyCount(readCount());
