/**
 * DOM construction and avatar/scene rendering for the TownSquare widget.
 */

import { DISPLAY_NAME_MAX, MESSAGE_MAX, PROPS, READING_LABEL_MAX } from "./constants.mjs";
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
 * @property {HTMLElement} [below] Container for the nameplate / composer.
 * @property {HTMLElement} [nameEl] Visible name label.
 * @property {HTMLAnchorElement} [readingEl] Visible current page link.
 * @property {HTMLElement} [readingLabelEl] Page label text inside the link.
 * @property {HTMLButtonElement} [plate] The "you · say something" way-in.
 * @property {HTMLElement} [dot]
 * @property {HTMLButtonElement} [profileButton]
 * @property {HTMLFormElement} [profileForm]
 * @property {HTMLInputElement} [profileInput]
 * @property {Array<HTMLButtonElement>} [colorSwatches]
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

const QUIET_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19 12.8A7.2 7.2 0 0 1 11.2 5 6.8 6.8 0 1 0 19 12.8Z"></path>
  </svg>
`;

const EXPAND_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 4H4v4"></path>
    <path d="M16 4h4v4"></path>
    <path d="M20 16v4h-4"></path>
    <path d="M4 16v4h4"></path>
  </svg>
`;

const PENCIL_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>
  </svg>
`;

const TOWNSQUARE_URL = "https://townsquare.cauenapier.com/";

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @returns {{ app: HTMLElement, stage: HTMLElement, statusRow: HTMLElement, status: HTMLElement, quietButton: HTMLButtonElement, expandButton: HTMLButtonElement, helpButton: HTMLButtonElement, helpPanel: HTMLElement }}
 */
export function renderShell(container) {
  const element = document.createElement("section");
  element.className = "townsquare";

  const controls = document.createElement("div");
  controls.className = "townsquare__controls";

  const quietButton = document.createElement("button");
  quietButton.className = "townsquare__control";
  quietButton.type = "button";
  quietButton.innerHTML = QUIET_ICON;
  quietButton.setAttribute("aria-label", "Turn quiet mode on");
  quietButton.setAttribute("aria-pressed", "false");
  quietButton.title = "Quiet mode";

  const expandButton = document.createElement("button");
  expandButton.className = "townsquare__control townsquare__control--expand";
  expandButton.type = "button";
  expandButton.innerHTML = EXPAND_ICON;
  expandButton.setAttribute("aria-label", "Expand widget");
  expandButton.setAttribute("aria-pressed", "false");
  expandButton.title = "Expand";

  const helpButton = document.createElement("button");
  helpButton.className = "townsquare__control townsquare__help-button";
  helpButton.type = "button";
  helpButton.setAttribute("aria-label", "About TownSquare");
  helpButton.setAttribute("aria-expanded", "false");
  helpButton.setAttribute("aria-controls", "townsquare-help-panel");
  helpButton.title = "About TownSquare";
  helpButton.textContent = "?";

  const helpPanel = document.createElement("div");
  helpPanel.className = "townsquare__help-panel";
  helpPanel.id = "townsquare-help-panel";
  helpPanel.hidden = true;

  const helpTitle = document.createElement("strong");
  helpTitle.textContent = "TownSquare";

  const description = document.createElement("p");
  description.textContent = "A tiny shared place for people visiting this site.";

  const instructions = document.createElement("p");
  instructions.textContent =
    "Move with the arrow keys, or tap where you want to walk. Tap your nameplate to chat, and tap a character to see their recent messages.";

  const link = document.createElement("a");
  link.href = TOWNSQUARE_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "townsquare.cauenapier.com";

  helpPanel.append(helpTitle, description, instructions, link);

  controls.append(quietButton, expandButton, helpButton, helpPanel);

  const statusRow = document.createElement("div");
  statusRow.className = "townsquare__status";

  const status = document.createElement("span");
  status.textContent = "Connecting…";

  statusRow.append(status);

  const stageEl = document.createElement("div");
  stageEl.className = "townsquare__stage";

  const ground = document.createElement("div");
  ground.className = "townsquare__ground";
  stageEl.appendChild(ground);

  element.append(controls, statusRow, stageEl);
  container.appendChild(element);
  return {
    app: element,
    stage: stageEl,
    statusRow,
    status,
    quietButton,
    expandButton,
    helpButton,
    helpPanel,
  };
}

/**
 * Toggle the About panel from the help button; closes on outside click.
 *
 * @param {HTMLButtonElement} helpButton
 * @param {HTMLElement} helpPanel
 * @returns {() => void}
 */
export function wireHelpPanel(helpButton, helpPanel) {
  const setHelpOpen = (open) => {
    helpPanel.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
  };

  const onHelpClick = () => setHelpOpen(helpPanel.hidden);
  const onHelpPointerDown = (event) => {
    if (helpPanel.hidden) return;
    const target = event.target;
    if (target instanceof Node && (helpButton.contains(target) || helpPanel.contains(target))) return;
    setHelpOpen(false);
  };

  helpButton.addEventListener("click", onHelpClick);
  document.addEventListener("pointerdown", onHelpPointerDown, true);

  return () => {
    helpButton.removeEventListener("click", onHelpClick);
    document.removeEventListener("pointerdown", onHelpPointerDown, true);
    setHelpOpen(false);
  };
}

/**
 * Create an avatar figure with optional self-only chat controls.
 *
 * On touch devices the floating composer under the figure is fragile (edge
 * clipping, virtual keyboard cover), so callers can pass `composerHost` to
 * dock the composer as a bar at the bottom of the widget instead.
 *
 * @param {{
 *   isSelf: boolean,
 *   profile?: { displayName?: string, color?: string, readingLabel?: string, readingUrl?: string },
 *   colors?: Array<string>,
 *   onProfileChange?: (profile: { displayName: string, color: string }) => void,
 *   onSubmitChat?: () => void,
 *   composerHost?: HTMLElement
 * }} options
 * @returns {AvatarView}
 */
export function createAvatar({ isSelf, profile = {}, colors = [], onProfileChange, onSubmitChat, composerHost }) {
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
    const below = document.createElement("div");
    below.className = "avatar__below avatar__below--peer";

    const label = document.createElement("div");
    label.className = "avatar__peer-label";

    const nameEl = document.createElement("span");
    nameEl.className = "avatar__peer-name";

    const readingEl = document.createElement("a");
    readingEl.className = "avatar__reading avatar__reading--peer";
    readingEl.target = "_blank";
    readingEl.rel = "noopener noreferrer";
    readingEl.addEventListener("click", (event) => event.stopPropagation());

    const readingPrefix = document.createElement("span");
    readingPrefix.className = "avatar__reading-prefix";
    readingPrefix.textContent = "visiting";

    const readingLabelEl = document.createElement("span");
    readingLabelEl.className = "avatar__reading-label";

    readingEl.append(readingPrefix, readingLabelEl);
    label.append(nameEl, readingEl);
    below.appendChild(label);
    el.appendChild(below);

    const peerAvatar = { ...avatar, below, nameEl, readingEl, readingLabelEl };
    setAvatarProfile(peerAvatar, profile);
    return peerAvatar;
  }

  const color = profile.color || "";

  // Self carries a persistent nameplate at its base: identity, the chat way in,
  // and a compact profile editor for the accountless session identity.
  const below = document.createElement("div");
  below.className = "avatar__below";

  const plateRow = document.createElement("div");
  plateRow.className = "avatar__plate-row";

  const plate = document.createElement("button");
  plate.className = "avatar__plate";
  plate.type = "button";
  plate.setAttribute("aria-label", "Say something");

  const dot = document.createElement("span");
  dot.className = "avatar__plate-dot";

  const nameEl = document.createElement("span");
  nameEl.className = "avatar__plate-name";

  const hint = document.createElement("span");
  hint.className = "avatar__plate-hint";
  hint.textContent = "· say something";
  plate.append(dot, nameEl, hint);

  const profileButton = document.createElement("button");
  profileButton.className = "avatar__profile-button";
  profileButton.type = "button";
  profileButton.innerHTML = PENCIL_ICON;
  profileButton.setAttribute("aria-label", "Edit character");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.title = "Edit character";

  plateRow.append(plate, profileButton);

  const profileForm = document.createElement("form");
  profileForm.className = "avatar__profile";
  profileForm.hidden = true;

  const profileInput = document.createElement("input");
  profileInput.className = "avatar__profile-input";
  profileInput.type = "text";
  profileInput.maxLength = DISPLAY_NAME_MAX;
  profileInput.placeholder = "Display name";
  profileInput.autocomplete = "off";
  profileInput.setAttribute("aria-label", "Display name");

  const swatches = document.createElement("div");
  swatches.className = "avatar__swatches";

  /** @type {Array<HTMLButtonElement>} */
  const colorSwatches = colors.map((swatchColor) => {
    const swatch = document.createElement("button");
    swatch.className = "avatar__swatch";
    swatch.type = "button";
    swatch.style.setProperty("--swatch", swatchColor);
    swatch.dataset.color = swatchColor;
    swatch.setAttribute("aria-label", `Use color ${swatchColor}`);
    swatches.appendChild(swatch);
    return swatch;
  });

  const profileDone = document.createElement("button");
  profileDone.className = "avatar__profile-done";
  profileDone.type = "submit";
  profileDone.innerHTML = ENTER_ICON;
  profileDone.setAttribute("aria-label", "Save character");

  profileForm.append(profileInput, swatches, profileDone);

  const composer = document.createElement("form");
  composer.className = "avatar__composer";
  composer.hidden = true;

  const input = document.createElement("input");
  input.className = "avatar__input";
  input.type = "text";
  input.maxLength = MESSAGE_MAX;
  input.placeholder = "Say something…";
  input.setAttribute("aria-label", "Say something");

  const send = document.createElement("button");
  send.className = "avatar__send";
  send.type = "submit";
  send.innerHTML = ENTER_ICON;
  send.setAttribute("aria-label", "Send message");

  composer.append(input, send);
  if (composerHost) {
    composer.classList.add("avatar__composer--docked");
    below.append(plateRow, profileForm);
    composerHost.appendChild(composer);
  } else {
    below.append(plateRow, profileForm, composer);
  }
  el.appendChild(below);

  /** @type {AvatarView} */
  const selfAvatar = {
    ...avatar,
    below,
    nameEl,
    dot,
    plate,
    profileButton,
    profileForm,
    profileInput,
    colorSwatches,
    composer,
    input,
    send,
  };

  const closeProfile = () => {
    profileForm.hidden = true;
    profileButton.setAttribute("aria-expanded", "false");
  };

  const submitProfile = (nextColor = el.dataset.color || color) => {
    const nextProfile = {
      displayName: profileInput.value,
      color: nextColor,
    };
    setAvatarProfile(selfAvatar, nextProfile);
    onProfileChange?.({
      displayName: nameEl.dataset.value || "",
      color: el.dataset.color || nextColor,
    });
  };

  const openProfile = () => {
    if (!composer.hidden) closeComposer();
    profileForm.hidden = false;
    profileButton.setAttribute("aria-expanded", "true");
    profileInput.value = nameEl.dataset.value || "";
    profileInput.focus();
  };

  const toggleProfile = () => {
    if (profileForm.hidden) {
      openProfile();
      return;
    }
    submitProfile();
    closeProfile();
  };

  profileButton.addEventListener("click", toggleProfile);

  profileInput.addEventListener("input", () => {
    submitProfile();
  });

  profileInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProfile();
    }
  });

  for (const swatch of colorSwatches) {
    swatch.addEventListener("click", () => {
      submitProfile(swatch.dataset.color || color);
    });
  }

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitProfile();
    closeProfile();
  });

  setAvatarProfile(selfAvatar, profile);

  const openComposer = () => {
    closeProfile();
    plate.hidden = true;
    profileButton.hidden = true;
    composer.hidden = false;
    input.value = "";
    setSendReady(selfAvatar, false);
    input.focus();
    if (composerHost) {
      // Keep the input visible once the virtual keyboard pushes the page around.
      setTimeout(() => {
        if (!composer.hidden) input.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 250);
    }
  };

  const closeComposer = () => {
    composer.hidden = true;
    plate.hidden = false;
    profileButton.hidden = false;
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
    if (composerHost) {
      // Docked bar stays open for back-and-forth; reopening costs a tiny tap.
      input.value = "";
      setSendReady(selfAvatar, false);
      input.focus();
    } else {
      closeComposer();
    }
  });

  return selfAvatar;
}

/**
 * @param {AvatarView} avatar
 * @param {{ displayName?: string, color?: string, readingLabel?: string, readingUrl?: string }} profile
 */
export function setAvatarProfile(avatar, profile = {}) {
  const displayName = typeof profile.displayName === "string"
    ? profile.displayName.trim().replace(/\s+/g, " ").slice(0, DISPLAY_NAME_MAX)
    : "";
  const color = typeof profile.color === "string" ? profile.color : "";
  const readingLabel = typeof profile.readingLabel === "string"
    ? profile.readingLabel.trim().replace(/\s+/g, " ").slice(0, READING_LABEL_MAX)
    : "";
  const readingUrl = typeof profile.readingUrl === "string" ? profile.readingUrl : "";
  avatar.el.dataset.color = color;
  avatar.el.style.color = color || "";
  avatar.el.classList.toggle("avatar--has-display-name", Boolean(displayName));
  avatar.el.classList.toggle("avatar--has-reading", Boolean(readingLabel));
  if (avatar.dot) {
    avatar.dot.style.background = color || "";
  }
  if (avatar.nameEl) {
    avatar.nameEl.textContent = displayName || "you";
    avatar.nameEl.dataset.value = displayName;
    avatar.nameEl.toggleAttribute("hidden", !displayName && avatar.el.classList.contains("avatar--peer"));
  }
  if (avatar.readingEl && avatar.readingLabelEl) {
    avatar.readingLabelEl.textContent = readingLabel;
    avatar.readingEl.title = readingLabel;
    if (readingUrl) {
      avatar.readingEl.href = readingUrl;
    } else {
      avatar.readingEl.removeAttribute("href");
    }
    avatar.readingEl.classList.toggle("avatar__reading--available", Boolean(readingLabel));
    avatar.readingEl.toggleAttribute("hidden", !readingLabel);
  }
  if (avatar.below && avatar.el.classList.contains("avatar--peer")) {
    avatar.below.toggleAttribute("hidden", !displayName && !readingLabel);
  }
  for (const swatch of avatar.colorSwatches || []) {
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
  }
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
export function renderProps(container) {
  for (const prop of PROPS) {
    const el = document.createElement("div");
    el.className = `prop prop--${prop.id}`;
    el.style.left = `${(prop.x * 100).toFixed(2)}%`;
    el.style.width = `${prop.width}px`;
    el.style.height = `${prop.height}px`;
    el.innerHTML = prop.svg;
    if (prop.lightRadius) {
      const light = document.createElement("div");
      light.className = "prop__light";
      light.setAttribute("aria-hidden", "true");
      el.appendChild(light);
    }
    container.appendChild(el);
  }
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
  avatar.el.classList.toggle("avatar--resting", pose === "resting");
  if (pose) {
    setWalking(avatar, false);
  }
}

/**
 * @param {AvatarView} avatar
 * @param {number} x
 * @param {string | null} propId
 */
export function updatePropEffects(avatar, x, propId) {
  const activeProp = PROPS.find((prop) => prop.id === propId);
  if (activeProp?.faceAway) {
    setFacing(avatar, x >= activeProp.x);
  }

  avatar.el.classList.toggle(
    "avatar--shaded",
    PROPS.some((prop) => prop.shadeRadius && Math.abs(x - prop.x) < prop.shadeRadius),
  );
  avatar.el.classList.toggle(
    "avatar--lit",
    PROPS.some((prop) => prop.lightRadius && Math.abs(x - prop.x) < prop.lightRadius),
  );
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
