/**
 * DOM construction and avatar/scene rendering for the TownSquare widget.
 */

import { BENCH } from "./constants.mjs";

/**
 * @typedef {Object} AvatarView
 * @property {HTMLElement} el
 * @property {HTMLElement} bubble
 * @property {Array<{ text: string, at: number }>} messages
 * @property {HTMLElement} tray
 * @property {HTMLElement} trayList
 * @property {ReturnType<typeof setTimeout> | null} bubbleTimer
 * @property {HTMLFormElement} [composer]
 * @property {HTMLInputElement} [input]
 */

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @param {import("../townsquare.mjs").MountOptions} mountOptions
 * @returns {HTMLElement}
 */
export function renderShell(container, mountOptions) {
  const element = document.createElement("section");
  element.className = "townsquare";

  const statusRow = document.createElement("div");
  statusRow.className = "townsquare__status";

  const status = document.createElement("span");
  status.dataset.role = "status";
  status.textContent = "Connecting…";

  const instructions = document.createElement("span");
  instructions.textContent = mountOptions.instructions || "Use ← and → to walk. Pause by the bench to sit.";

  statusRow.append(status, instructions);

  const stageEl = document.createElement("div");
  stageEl.className = "townsquare__stage";
  stageEl.dataset.role = "stage";

  const ground = document.createElement("div");
  ground.className = "townsquare__ground";
  stageEl.appendChild(ground);

  const hint = document.createElement("div");
  hint.className = "townsquare__hint";
  hint.textContent = mountOptions.hint || "Embedded into a normal page instead of running as a disconnected mockup.";

  element.append(statusRow, stageEl, hint);
  container.appendChild(element);
  return element;
}

/**
 * Create an avatar figure with optional self-only chat controls.
 *
 * @param {{ isSelf: boolean, onSubmitChat?: (input: HTMLInputElement, composer: HTMLFormElement) => void }} options
 * @returns {AvatarView}
 */
export function createAvatar({ isSelf, onSubmitChat }) {
  const el = document.createElement("div");
  el.className = `avatar ${isSelf ? "avatar--self" : "avatar--peer"}`;
  el.innerHTML = `
    <svg viewBox="0 0 20 44" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <g class="figure-core">
        <circle class="head" cx="10" cy="6.2" r="3.4"></circle>
        <line x1="10" y1="10" x2="10" y2="26"></line>
        <g class="joint arm-l">
          <line x1="9.4" y1="14" x2="6.1" y2="20"></line>
          <g class="joint elbow-l">
            <line x1="6.1" y1="20" x2="4.7" y2="26"></line>
          </g>
        </g>
        <g class="joint arm-r">
          <line x1="10.6" y1="14" x2="13.9" y2="20"></line>
          <g class="joint elbow-r">
            <line x1="13.9" y1="20" x2="15.3" y2="26"></line>
          </g>
        </g>
        <g class="joint leg-l">
          <line x1="9.2" y1="26" x2="7.1" y2="34"></line>
          <g class="joint knee-l">
            <line x1="7.1" y1="34" x2="5.4" y2="42"></line>
          </g>
        </g>
        <g class="joint leg-r">
          <line x1="10.8" y1="26" x2="12.9" y2="34"></line>
          <g class="joint knee-r">
            <line x1="12.9" y1="34" x2="14.6" y2="42"></line>
          </g>
        </g>
      </g>
    </svg>
  `;

  const bubble = document.createElement("div");
  bubble.className = "avatar__bubble";
  bubble.hidden = true;
  el.appendChild(bubble);

  const tray = document.createElement("section");
  tray.className = "avatar__tray";
  tray.setAttribute("aria-label", "Recent messages");
  tray.hidden = true;

  const trayList = document.createElement("div");
  trayList.className = "avatar__tray-list";
  tray.appendChild(trayList);
  el.appendChild(tray);

  /** @type {AvatarView} */
  const avatar = {
    el,
    bubble,
    messages: [],
    tray,
    trayList,
    bubbleTimer: null,
  };

  if (!isSelf) {
    return avatar;
  }

  const controls = document.createElement("div");
  controls.className = "avatar__controls";

  const toggle = document.createElement("button");
  toggle.className = "avatar__chat-toggle";
  toggle.type = "button";
  toggle.textContent = "💬";
  toggle.setAttribute("aria-label", "Say something");

  const composer = document.createElement("form");
  composer.className = "avatar__composer";
  composer.hidden = true;
  toggle.setAttribute("aria-expanded", "false");

  const input = document.createElement("input");
  input.className = "avatar__input";
  input.type = "text";
  input.maxLength = 140;
  input.placeholder = "Say something…";

  const send = document.createElement("button");
  send.className = "avatar__send";
  send.type = "submit";
  send.textContent = "↵";
  send.setAttribute("aria-label", "Send message");

  composer.append(input, send);
  controls.append(toggle, composer);
  el.appendChild(controls);

  toggle.addEventListener("click", () => {
    composer.hidden = !composer.hidden;
    toggle.setAttribute("aria-expanded", String(!composer.hidden));
    if (!composer.hidden) input.focus();
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmitChat?.(input, composer);
  });

  return {
    ...avatar,
    composer,
    input,
  };
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
  avatar.el.classList.toggle("avatar--edge-right", x > 0.78);
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} movingLeft
 */
export function setFacing(avatar, movingLeft) {
  avatar.el.classList.toggle("flip", !movingLeft);
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
 * @param {{ text: string, at: number }} message
 * @returns {HTMLElement}
 */
export function renderTrayMessageRow(message) {
  const row = document.createElement("div");
  row.className = "avatar__tray-message";

  const text = document.createElement("p");
  text.textContent = message.text;

  const time = document.createElement("time");
  const date = new Date(message.at);
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  row.append(text, time);
  return row;
}
