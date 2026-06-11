/**
 * DOM construction and avatar/scene rendering for the TownSquare widget.
 */

import { BENCH } from "./constants.mjs";
import { figureMarkup } from "./figure.mjs";

/**
 * @typedef {Object} GhostMessage
 * @property {HTMLElement} el Bubble element living in the `above` stack.
 * @property {boolean} solid Whether this is the live (un-faded) bubble.
 * @property {ReturnType<typeof setTimeout> | null} timer This line's own fade-out timer.
 */

/**
 * @typedef {Object} AvatarView
 * @property {HTMLElement} el
 * @property {HTMLElement} above Container holding the ghost stack of bubbles.
 * @property {Array<GhostMessage>} messages Newest last; the live bubble is at the end.
 * @property {HTMLElement} tray Hover surface listing recent history.
 * @property {HTMLElement} trayList Container the history rows render into.
 * @property {Array<{ text: string, at: number }>} history Recent messages, newest last.
 * @property {number} [bubbleShift] Applied column nudge in px (see bubble-layout.mjs).
 * @property {number} [tailShift] Applied tail base counter-shift in px (see bubble-layout.mjs).
 * @property {number} [tailTip] Applied tail tip lean in px (see bubble-layout.mjs).
 * @property {number} [bubbleScale] Applied proximity scale (see bubble-layout.mjs).
 * @property {number} [bubbleFade] Applied proximity opacity (see bubble-layout.mjs).
 * @property {HTMLElement} [below] Container for the nameplate / composer (self only).
 * @property {HTMLButtonElement} [plate] The "you · say something" way-in.
 * @property {HTMLFormElement} [composer]
 * @property {HTMLInputElement} [input]
 * @property {HTMLButtonElement} [send]
 */

const ENTER_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6v5a3 3 0 0 1-3 3H5"></path>
    <path d="M9 10l-4 4 4 4"></path>
  </svg>
`;

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @param {import("../townsquare.mjs").MountOptions} mountOptions
 * @returns {{ app: HTMLElement, stage: HTMLElement, status: HTMLElement }}
 */
export function renderShell(container, mountOptions) {
  const element = document.createElement("section");
  element.className = "townsquare";

  const statusRow = document.createElement("div");
  statusRow.className = "townsquare__status";

  const status = document.createElement("span");
  status.textContent = "Connecting…";

  const instructions = document.createElement("span");
  instructions.textContent = mountOptions.instructions || "Use ← and → to walk. Pause by the bench to sit.";

  statusRow.append(status, instructions);

  const stageEl = document.createElement("div");
  stageEl.className = "townsquare__stage";

  const ground = document.createElement("div");
  ground.className = "townsquare__ground";
  stageEl.appendChild(ground);

  const hint = document.createElement("div");
  hint.className = "townsquare__hint";
  hint.textContent = mountOptions.hint || "Embedded into a normal page instead of running as a disconnected mockup.";

  element.append(statusRow, stageEl, hint);
  container.appendChild(element);
  return { app: element, stage: stageEl, status };
}

/**
 * Create an avatar figure with optional self-only chat controls.
 *
 * @param {{ isSelf: boolean, onSubmitChat?: () => void }} options
 * @returns {AvatarView}
 */
export function createAvatar({ isSelf, onSubmitChat }) {
  const el = document.createElement("div");
  el.className = `avatar ${isSelf ? "avatar--self" : "avatar--peer"}`;
  el.innerHTML = figureMarkup('aria-hidden="true"');

  // The ghost stack: recent lines linger as fading bubbles above the live one.
  const above = document.createElement("div");
  above.className = "avatar__above";
  above.setAttribute("aria-hidden", "true");
  el.appendChild(above);

  // History tray: revealed on hover so past lines can be recovered after they fade.
  const tray = document.createElement("section");
  tray.className = "avatar__tray";
  tray.setAttribute("aria-label", "Recent messages");

  const trayList = document.createElement("div");
  trayList.className = "avatar__tray-list";
  tray.appendChild(trayList);
  el.appendChild(tray);

  /** @type {AvatarView} */
  const avatar = {
    el,
    above,
    messages: [],
    tray,
    trayList,
    history: [],
  };

  if (!isSelf) {
    return avatar;
  }

  // Self carries a persistent nameplate at its base — identity and the always-
  // there way in. Clicking it morphs the plate into the full composer in place.
  const below = document.createElement("div");
  below.className = "avatar__below";

  const plate = document.createElement("button");
  plate.className = "avatar__plate";
  plate.type = "button";
  plate.setAttribute("aria-label", "Say something");
  plate.innerHTML = `
    <span class="avatar__plate-dot"></span>
    <span class="avatar__plate-name">you</span>
    <span class="avatar__plate-hint">· say something</span>
  `;

  const composer = document.createElement("form");
  composer.className = "avatar__composer";
  composer.hidden = true;

  const input = document.createElement("input");
  input.className = "avatar__input";
  input.type = "text";
  input.maxLength = 140;
  input.placeholder = "Say something…";
  input.setAttribute("aria-label", "Say something");

  const send = document.createElement("button");
  send.className = "avatar__send";
  send.type = "submit";
  send.innerHTML = ENTER_ICON;
  send.setAttribute("aria-label", "Send message");

  composer.append(input, send);
  below.append(plate, composer);
  el.appendChild(below);

  /** @type {AvatarView} */
  const selfAvatar = { ...avatar, below, plate, composer, input, send };

  const openComposer = () => {
    plate.hidden = true;
    composer.hidden = false;
    input.value = "";
    setSendReady(selfAvatar, false);
    input.focus();
  };

  const closeComposer = () => {
    composer.hidden = true;
    plate.hidden = false;
    input.value = "";
    setSendReady(selfAvatar, false);
  };

  plate.addEventListener("click", openComposer);

  input.addEventListener("input", () => {
    setSendReady(selfAvatar, input.value.trim().length > 0);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposer();
    }
  });

  // Clicking away with nothing typed returns to the resting nameplate. A pending
  // value keeps the composer open so the send button stays reachable.
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") closeComposer();
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmitChat?.();
    closeComposer();
  });

  return selfAvatar;
}

/**
 * Toggle the composer's send button between resting and ready-to-send.
 *
 * @param {AvatarView} avatar
 * @param {boolean} ready
 */
function setSendReady(avatar, ready) {
  avatar.send?.classList.toggle("avatar__send--ready", ready);
}

/**
 * @param {HTMLElement} container
 */
export function renderBench(container) {
  const bench = document.createElement("div");
  bench.className = "prop prop--bench";
  bench.style.left = `${(BENCH.x * 100).toFixed(2)}%`;
  bench.style.width = `${BENCH.width}px`;
  bench.style.height = `${BENCH.height}px`;
  bench.innerHTML = BENCH.svg;
  container.appendChild(bench);
}

/**
 * @param {AvatarView} avatar
 * @param {number} x
 */
export function renderAvatar(avatar, x) {
  avatar.el.style.left = `${(x * 100).toFixed(2)}%`;
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} movingLeft
 */
export function setFacing(avatar, movingLeft) {
  avatar.el.classList.toggle("flip", movingLeft);
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} walking
 */
export function setWalking(avatar, walking) {
  avatar.el.classList.toggle("walking", walking);
}

/**
 * @param {AvatarView} avatar
 * @param {string | null} pose
 */
export function updatePose(avatar, pose) {
  avatar.el.classList.toggle("avatar--sitting", pose === "sitting");
  if (pose === "sitting") {
    setWalking(avatar, false);
  }
}

/**
 * Build a single speech bubble for the ghost stack.
 *
 * @param {string} text
 * @returns {HTMLElement}
 */
export function createBubble(text) {
  const bubble = document.createElement("div");
  bubble.className = "avatar__bubble";

  const body = document.createElement("span");
  body.className = "avatar__bubble-text";
  body.textContent = text;

  const tail = document.createElement("span");
  tail.className = "avatar__tail";

  bubble.append(body, tail);
  return bubble;
}

/**
 * Build a single row for the hover history tray.
 *
 * @param {{ text: string, at: number }} message
 * @returns {HTMLElement}
 */
export function createTrayRow(message) {
  const row = document.createElement("div");
  row.className = "avatar__tray-row";

  const text = document.createElement("span");
  text.className = "avatar__tray-msg";
  text.textContent = message.text;

  const time = document.createElement("time");
  time.className = "avatar__tray-time";
  const date = new Date(message.at);
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  row.append(text, time);
  return row;
}
