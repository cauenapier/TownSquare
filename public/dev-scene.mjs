import { layoutBubbleColumns } from "./widget/bubble-layout.mjs";
import { sayMessage } from "./widget/chat.mjs";
import {
  createAvatar,
  renderAvatar,
  renderBench,
  renderShell,
  setFacing,
  setWalking,
  updatePose,
} from "./widget/dom.mjs";
import { BENCH, BENCH_SETTLE_MS, MAX_X, MIN_X, MOVEMENT_SPEED } from "./widget/constants.mjs";

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

let handle = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function createActor(index, stage, random) {
  const avatar = createAvatar({ isSelf: false });
  const x = MIN_X + random() * (MAX_X - MIN_X);
  const direction = random() < 0.5 ? -1 : 1;
  const speed = MOVEMENT_SPEED_MIN + random() * (MOVEMENT_SPEED_MAX - MOVEMENT_SPEED_MIN);

  stage.appendChild(avatar.el);
  renderAvatar(avatar, x);
  setFacing(avatar, direction < 0);
  setWalking(avatar, true);

  return {
    id: index + 1,
    avatar,
    x,
    direction,
    speed,
    nextTurnAt: performance.now() + 1000 + random() * 3500,
    nextSayAt: performance.now() + 500 + random() * 5000,
  };
}

function stepActor(actor, now, dt, random, walking) {
  if (walking) {
    setWalking(actor.avatar, true);

    if (now >= actor.nextTurnAt) {
      actor.direction = random() < 0.5 ? -1 : 1;
      actor.nextTurnAt = now + 1200 + random() * 4400;
      setFacing(actor.avatar, actor.direction < 0);
    }

    actor.x += actor.direction * actor.speed * dt;
    if (actor.x <= MIN_X || actor.x >= MAX_X) {
      actor.x = clamp(actor.x, MIN_X, MAX_X);
      actor.direction *= -1;
      actor.nextTurnAt = now + 900 + random() * 2500;
      setFacing(actor.avatar, actor.direction < 0);
    }

    renderAvatar(actor.avatar, actor.x);
  } else {
    setWalking(actor.avatar, false);
  }

  if (now >= actor.nextSayAt) {
    const line = LINES[Math.floor(random() * LINES.length)];
    sayMessage(actor.avatar, { text: line, at: Date.now() });
    actor.nextSayAt = now + 2500 + random() * 8500;
  }
}

function createSelf(stage) {
  const self = {
    x: 0.5,
    movingLeft: false,
    movingRight: false,
    pose: null,
    benchZoneEnteredAt: 0,
    avatar: null,
  };

  self.avatar = createAvatar({
    isSelf: true,
    onSubmitChat: () => {
      const input = self.avatar?.input;
      const text = input?.value.trim();
      if (!text || !self.avatar) return;
      sayMessage(self.avatar, { text, at: Date.now() });
      input.value = "";
    },
  });

  stage.appendChild(self.avatar.el);
  renderAvatar(self.avatar, self.x);
  updatePose(self.avatar, self.pose);
  return self;
}

function resetSelfSettle(self) {
  self.benchZoneEnteredAt = 0;
}

function stepSelf(self, now, dt) {
  const direction = Number(self.movingRight) - Number(self.movingLeft);

  if (direction !== 0) {
    self.pose = null;
    resetSelfSettle(self);
    updatePose(self.avatar, self.pose);
    self.x = clamp(self.x + direction * MOVEMENT_SPEED * dt, MIN_X, MAX_X);
    renderAvatar(self.avatar, self.x);
    setFacing(self.avatar, direction < 0);
    setWalking(self.avatar, true);
    return;
  }

  setWalking(self.avatar, false);
  if (self.pose === "sitting") return;

  if (Math.abs(self.x - BENCH.x) >= BENCH.zoneRadius) {
    resetSelfSettle(self);
    return;
  }

  if (!self.benchZoneEnteredAt) {
    self.benchZoneEnteredAt = now;
    return;
  }

  if (now - self.benchZoneEnteredAt < BENCH_SETTLE_MS) return;

  self.x = BENCH.x;
  self.pose = "sitting";
  renderAvatar(self.avatar, self.x);
  updatePose(self.avatar, self.pose);
}

function mountDevScene(count, walking) {
  root.replaceChildren();

  const { stage, status } = renderShell(root, {
    instructions: "Use ← and → to walk. Click your nameplate to talk. Pause by the bench to sit.",
    hint: "Use ?characters=24 to deep-link a larger crowd.",
  });

  renderBench(stage);
  status.textContent = `You plus ${count} simulated ${count === 1 ? "character" : "characters"}`;

  const random = seededRandom(count * 9973);
  const actors = Array.from({ length: count }, (_, index) => createActor(index, stage, random));
  const self = createSelf(stage);
  let actorsWalking = walking;
  let frame = null;
  let lastFrameAt = performance.now();
  const onKeyDown = (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft") self.movingLeft = true;
    if (event.key === "ArrowRight") self.movingRight = true;
  };
  const onKeyUp = (event) => {
    if (event.key === "ArrowLeft") self.movingLeft = false;
    if (event.key === "ArrowRight") self.movingRight = false;
  };

  const tick = (now) => {
    const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    stepSelf(self, now, dt);
    for (const actor of actors) {
      stepActor(actor, now, dt, random, actorsWalking);
    }
    layoutBubbleColumns(stage, [self, ...actors], self.x);
    frame = requestAnimationFrame(tick);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  frame = requestAnimationFrame(tick);

  return {
    setActorsWalking(nextWalking) {
      actorsWalking = nextWalking;
      if (!actorsWalking) {
        for (const actor of actors) {
          setWalking(actor.avatar, false);
        }
      }
    },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      root.replaceChildren();
    },
  };
}

function applyCount(count) {
  handle?.destroy();
  countInput.value = String(count);
  writeCount(count);
  handle = mountDevScene(count, walkingInput.checked);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCount(clamp(Number.parseInt(countInput.value, 10) || DEFAULT_CHARACTER_COUNT, MIN_CHARACTER_COUNT, MAX_CHARACTER_COUNT));
});

walkingInput.addEventListener("change", () => {
  handle?.setActorsWalking(walkingInput.checked);
});

applyCount(readCount());
