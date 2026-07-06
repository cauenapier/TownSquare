/**
 * Avatar DOM construction, profile rendering, and avatar-owned timers.
 */

import { AWAY_HIDE_MS, DISPLAY_NAME_MAX, MESSAGE_MAX } from "./constants.mjs";
import { figureMarkup } from "./figure.mjs";
import { normalizeDisplayName, normalizeReadingLabel } from "./utils.mjs";

/**
 * @typedef {Object} GhostMessage
 * @property {HTMLElement} el Bubble element living in the `above` stack.
 * @property {boolean} solid Whether this is the live (un-faded) bubble.
 * @property {ReturnType<typeof setTimeout> | null} timer This line's own fade-out timer.
 * @property {ReturnType<typeof setTimeout> | null} [removeTimer] Timer removing a faded bubble from the DOM.
 */

/**
 * @typedef {Object} AvatarView
 * @property {HTMLElement} el
 * @property {HTMLElement} above Container holding the ghost stack of bubbles.
 * @property {Array<GhostMessage>} messages Newest last; the live bubble is at the end.
 * @property {Array<GhostMessage>} expiringMessages Bubbles removed from the stack but still fading in the DOM.
 * @property {HTMLElement} tray Hover surface listing recent history.
 * @property {HTMLElement} trayList Container the history rows render into.
 * @property {Array<{ text: string, at: number }>} history Recent messages, newest last.
 * @property {import("./chat.mjs").ChatScope} chat Per-mount chat state shared by every avatar in the mount.
 * @property {number} [bubbleShift] Applied column nudge in px (see bubble-layout.mjs).
 * @property {number} [tailShift] Applied tail base counter-shift in px (see bubble-layout.mjs).
 * @property {number} [tailTip] Applied tail tip lean in px (see bubble-layout.mjs).
 * @property {number} [bubbleScale] Applied proximity scale (see bubble-layout.mjs).
 * @property {number} [bubbleFade] Applied proximity opacity (see bubble-layout.mjs).
 * @property {number} [trayShift] Applied history tray edge-clamping nudge in px.
 * @property {number} [labelShift] Applied name-tag de-confliction nudge in px (see bubble-layout.mjs).
 * @property {number} [labelFade] Applied name-tag proximity opacity (see bubble-layout.mjs).
 * @property {HTMLElement} [below] Container for the nameplate / composer.
 * @property {HTMLElement} [nameEl] Visible name label.
 * @property {HTMLElement} [crownEl] Verified site-owner badge.
 * @property {HTMLElement} [ownerRoleEl] "Site Owner" label shown below the name on crown hover.
 * @property {HTMLAnchorElement} [readingEl] Visible current page link.
 * @property {HTMLElement} [readingLabelEl] Page label text inside the link.
 * @property {HTMLButtonElement} [plate] The "you · say something" way-in.
 * @property {HTMLElement} [dot]
 * @property {HTMLButtonElement} [profileButton]
 * @property {HTMLFormElement} [profileForm]
 * @property {HTMLInputElement} [profileInput]
 * @property {HTMLButtonElement} [colorButton]
 * @property {Array<HTMLButtonElement>} [colorSwatches]
 * @property {HTMLElement} [colorMenu]
 * @property {HTMLFormElement} [composer]
 * @property {HTMLInputElement} [input]
 * @property {HTMLButtonElement} [send]
 * @property {HTMLParagraphElement} [hint] Slow-mode "wait" notice above the composer.
 * @property {boolean} [staticSelfLabel] Touch toolbar mode: show display name or "you" under the figure.
 * @property {() => void} [openComposer] Open the composer and focus the chat input.
 * @property {ReturnType<typeof setTimeout> | null} [jumpTimer]
 * @property {ReturnType<typeof setTimeout> | null} [raisedHandTimer]
 * @property {ReturnType<typeof setTimeout> | null} [highFiveTimer]
 * @property {ReturnType<typeof setTimeout> | null} [awayTimer] Pending hide of a long-idle (zZz) figure.
 */

/** @returns {HTMLSpanElement} */
function createOwnerCrown() {
  const crownEl = document.createElement("span");
  crownEl.className = "townsquare-avatar__owner-crown";
  crownEl.setAttribute("role", "img");
  crownEl.setAttribute("aria-label", "Site Owner");
  crownEl.tabIndex = 0;
  crownEl.textContent = "👑";
  crownEl.hidden = true;
  return crownEl;
}

/** @returns {HTMLSpanElement} */
function createOwnerRoleEl() {
  const ownerRoleEl = document.createElement("span");
  ownerRoleEl.className = "townsquare-avatar__owner-role";
  ownerRoleEl.textContent = "Site Owner";
  ownerRoleEl.hidden = true;
  return ownerRoleEl;
}

const ENTER_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6v5a3 3 0 0 1-3 3H5"></path>
    <path d="M9 10l-4 4 4 4"></path>
  </svg>
`;

const PENCIL_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>
  </svg>
`;

/**
 * Create an avatar figure with optional self-only chat controls.
 *
 * On touch devices the floating nameplate under the figure is fragile (edge
 * clipping, virtual keyboard cover, overlap with peers), so callers can pass
 * `toolbarHost` to dock a fixed bottom bar instead: an always-visible chat
 * input and, wired by the mount, the action buttons. The under-figure label
 * still owns the rename affordance and shows the display name, or "you" when
 * unset.
 *
 * @param {{
 *   isSelf: boolean,
 *   profile?: { displayName?: string, color?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean },
 *   colors?: Array<string>,
 *   onProfileChange?: (profile: { displayName: string, color: string }) => void,
 *   onSubmitChat?: () => boolean | void,
 *   onTypingChange?: (typing: boolean) => void,
 *   toolbarHost?: HTMLElement
 * }} options
 * @returns {AvatarView}
 */
export function createAvatar({ isSelf, profile = {}, colors = [], chatScope, onProfileChange, onSubmitChat, onTypingChange, toolbarHost }) {
  const el = document.createElement("div");
  el.className = `townsquare-avatar ${isSelf ? "townsquare-avatar--self" : "townsquare-avatar--peer"}`;
  el.innerHTML = figureMarkup('aria-hidden="true"');

  // The ghost stack: recent lines linger as fading bubbles above the live one.
  const above = document.createElement("div");
  above.className = "townsquare-avatar__above";
  above.setAttribute("aria-hidden", "true");
  el.appendChild(above);

  // History tray: revealed on hover so past lines can be recovered after they fade.
  const tray = document.createElement("section");
  tray.className = "townsquare-avatar__tray";
  tray.setAttribute("aria-label", "Recent messages");

  const trayList = document.createElement("div");
  trayList.className = "townsquare-avatar__tray-list";
  tray.appendChild(trayList);
  el.appendChild(tray);

  /** @type {AvatarView} */
  const avatar = {
    el,
    above,
    messages: [],
    expiringMessages: [],
    tray,
    trayList,
    history: [],
    // Per-mount chat state (expanded-view limits + speak-order counter). Falls
    // back to a private scope so a lone avatar still renders coherently.
    chat: chatScope || { expandedView: false, speakOrder: 1 },
  };

  if (!isSelf) {
    const below = document.createElement("div");
    below.className = "townsquare-avatar__below townsquare-avatar__below--peer";

    const label = document.createElement("div");
    label.className = "townsquare-avatar__peer-label";

    const nameRow = document.createElement("div");
    nameRow.className = "townsquare-avatar__peer-name-row";

    const crownEl = createOwnerCrown();

    const nameEl = document.createElement("span");
    nameEl.className = "townsquare-avatar__peer-name";

    const readingEl = document.createElement("a");
    readingEl.className = "townsquare-avatar__reading townsquare-avatar__reading--peer";
    readingEl.target = "_blank";
    readingEl.rel = "noopener noreferrer";
    readingEl.addEventListener("click", (event) => event.stopPropagation());

    const readingPrefix = document.createElement("span");
    readingPrefix.className = "townsquare-avatar__reading-prefix";
    readingPrefix.textContent = "visiting";

    const readingLabelEl = document.createElement("span");
    readingLabelEl.className = "townsquare-avatar__reading-label";

    readingEl.append(readingPrefix, readingLabelEl);
    nameRow.append(crownEl, nameEl);
    const ownerRoleEl = createOwnerRoleEl();
    label.append(nameRow, readingEl, ownerRoleEl);
    below.appendChild(label);
    el.appendChild(below);

    const peerAvatar = { ...avatar, below, crownEl, ownerRoleEl, nameEl, readingEl, readingLabelEl };
    setAvatarProfile(peerAvatar, profile);
    return peerAvatar;
  }

  const color = profile.color || "";

  // On touch the chat input lives in a fixed bottom toolbar instead of floating
  // under the (moving) figure, so the figure keeps a compact identity label.
  const toolbarMode = Boolean(toolbarHost);

  // Self carries a persistent nameplate at its base: identity, the chat way in,
  // and a compact profile editor for the accountless session identity.
  const below = document.createElement("div");
  below.className = "townsquare-avatar__below";

  const dot = document.createElement("span");
  dot.className = "townsquare-avatar__plate-dot";

  const crownEl = createOwnerCrown();

  const nameEl = document.createElement("span");
  nameEl.className = "townsquare-avatar__plate-name";

  const profileButton = document.createElement("button");
  profileButton.className = "townsquare-avatar__profile-button townsquare__button townsquare__button--sm";
  profileButton.type = "button";
  profileButton.innerHTML = PENCIL_ICON;
  profileButton.setAttribute("aria-label", "Edit character");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.title = "Edit character";

  // Desktop: a "you · say something" pill opens the inline composer. The
  // rename pencil lives inside the identity tag in both layouts; toolbar mode
  // drops the chat pill because the input is always visible in the bar.
  let plate = null;
  let plateRow = null;
  let plateChatButton = null;
  let selfId = null;
  if (toolbarMode) {
    selfId = document.createElement("div");
    selfId.className = "townsquare-avatar__self-id";
  } else {
    plate = document.createElement("div");
    plate.className = "townsquare-avatar__plate";

    plateChatButton = document.createElement("button");
    plateChatButton.className = "townsquare-avatar__plate-chat";
    plateChatButton.type = "button";
    plateChatButton.setAttribute("aria-label", "Say something");
    const hint = document.createElement("span");
    hint.className = "townsquare-avatar__plate-hint";
    hint.textContent = "· say something";
    plateChatButton.append(dot, crownEl, nameEl, hint);
    plate.appendChild(plateChatButton);

    plateRow = document.createElement("div");
    plateRow.className = "townsquare-avatar__plate-row";
    plateRow.appendChild(plate);
  }

  const ownerRoleEl = createOwnerRoleEl();
  ownerRoleEl.classList.add("townsquare-avatar__owner-role--self");

  const profileForm = document.createElement("form");
  profileForm.className = "townsquare-avatar__profile";
  profileForm.hidden = true;

  const profileInput = document.createElement("input");
  profileInput.className = "townsquare-avatar__profile-input";
  profileInput.type = "text";
  profileInput.maxLength = DISPLAY_NAME_MAX;
  profileInput.placeholder = "Display name";
  profileInput.autocomplete = "off";
  profileInput.setAttribute("aria-label", "Display name");

  const colorButton = document.createElement("button");
  colorButton.className = "townsquare-avatar__color-button";
  colorButton.type = "button";
  colorButton.setAttribute("aria-label", "Choose character color");
  colorButton.setAttribute("aria-haspopup", "dialog");
  colorButton.setAttribute("aria-expanded", "false");

  const colorMenu = document.createElement("div");
  colorMenu.className = "townsquare-avatar__color-menu";
  colorMenu.hidden = true;
  colorMenu.setAttribute("role", "dialog");
  colorMenu.setAttribute("aria-label", "Choose character color");

  const swatches = document.createElement("div");
  swatches.className = "townsquare-avatar__swatches";
  colorMenu.appendChild(swatches);

  /** @type {Array<HTMLButtonElement>} */
  const colorSwatches = colors.map((swatchColor) => {
    const swatch = document.createElement("button");
    swatch.className = "townsquare-avatar__swatch";
    swatch.type = "button";
    swatch.style.setProperty("--swatch", swatchColor);
    swatch.dataset.color = swatchColor;
    swatch.setAttribute("aria-label", `Use color ${swatchColor}`);
    swatches.appendChild(swatch);
    return swatch;
  });

  profileForm.append(colorButton, profileInput, colorMenu);

  const composer = document.createElement("form");
  composer.className = "townsquare-avatar__composer";
  composer.hidden = true;

  const input = document.createElement("input");
  input.className = "townsquare-avatar__input";
  input.type = "text";
  input.maxLength = MESSAGE_MAX;
  input.placeholder = "Say something…";
  input.setAttribute("aria-label", "Say something");

  const send = document.createElement("button");
  send.className = "townsquare-avatar__send";
  send.type = "submit";
  send.innerHTML = ENTER_ICON;
  send.setAttribute("aria-label", "Send message");

  // Slow-mode notice ("Wait 2s…") shown above the composer without clearing the
  // typed text. Hidden until the cooldown blocks a send.
  const cooldownHint = document.createElement("p");
  cooldownHint.className = "townsquare-avatar__composer-hint";
  cooldownHint.hidden = true;
  cooldownHint.setAttribute("role", "status");
  cooldownHint.setAttribute("aria-live", "polite");

  composer.append(input, send, cooldownHint);
  if (toolbarMode) {
    composer.classList.add("townsquare-avatar__composer--docked");
    composer.hidden = false;
    selfId.append(dot, crownEl, nameEl, profileButton, profileForm);
    below.append(selfId, ownerRoleEl);
    toolbarHost.appendChild(composer);
  } else {
    plate.append(profileButton, profileForm);
    below.append(plateRow, ownerRoleEl, composer);
  }
  el.appendChild(below);

  /** @type {AvatarView} */
  const selfAvatar = {
    ...avatar,
    below,
    crownEl,
    ownerRoleEl,
    nameEl,
    dot,
    plate,
    profileButton,
    profileForm,
    profileInput,
    colorButton,
    colorSwatches,
    colorMenu,
    composer,
    input,
    send,
    hint: cooldownHint,
    // Toolbar mode keeps a compact under-figure label (name or "you").
    staticSelfLabel: toolbarMode,
  };

  const closeColorMenu = () => {
    colorMenu.hidden = true;
    colorButton.setAttribute("aria-expanded", "false");
  };

  const closeProfile = () => {
    closeColorMenu();
    profileForm.hidden = true;
    el.classList.remove("townsquare-avatar--profile-open");
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
    // Toolbar mode keeps the chat input permanently visible, so opening the
    // rename editor must not try to close it.
    if (!toolbarMode && !composer.hidden) closeComposer();
    profileForm.hidden = false;
    el.classList.add("townsquare-avatar--profile-open");
    profileButton.setAttribute("aria-expanded", "true");
    profileInput.value = nameEl.dataset.value || "";
    profileInput.focus();
    profileInput.select();
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

  profileForm.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (profileForm.hidden || profileForm.contains(document.activeElement)) return;
      submitProfile();
      closeProfile();
    });
  });

  colorButton.addEventListener("click", () => {
    const open = colorMenu.hidden;
    colorMenu.hidden = !open;
    colorButton.setAttribute("aria-expanded", String(open));
  });

  colorMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeColorMenu();
      colorButton.focus();
    }
  });

  for (const swatch of colorSwatches) {
    swatch.addEventListener("click", () => {
      submitProfile(swatch.dataset.color || color);
      closeColorMenu();
    });
  }

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitProfile();
    closeProfile();
  });

  setAvatarProfile(selfAvatar, profile);

  // Toolbar mode: the input is always present, so "open" is just a focus and
  // there is no resting plate to swap back to.
  const openComposer = toolbarMode
    ? () => { closeProfile(); input.focus(); }
    : () => {
      closeProfile();
      el.classList.add("townsquare-avatar--composing");
      plate.hidden = true;
      profileButton.hidden = true;
      composer.hidden = false;
      input.value = "";
      setSendReady(selfAvatar, false);
      input.focus();
    };

  const closeComposer = () => {
    if (toolbarMode) return;
    el.classList.remove("townsquare-avatar--composing");
    composer.hidden = true;
    plate.hidden = false;
    profileButton.hidden = false;
    input.value = "";
    setSendReady(selfAvatar, false);
    onTypingChange?.(false);
  };

  plateChatButton?.addEventListener("click", openComposer);
  selfAvatar.openComposer = openComposer;

  input.addEventListener("input", () => {
    setSendReady(selfAvatar, input.value.trim().length > 0);
    onTypingChange?.(input.value.trim().length > 0);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (toolbarMode) input.blur();
      else closeComposer();
    }
  });

  if (toolbarMode) {
    // Suppress the history tray / lingering bubbles only while actively typing,
    // not for the whole life of the always-visible field.
    input.addEventListener("focus", () => el.classList.add("townsquare-avatar--composing"));
    input.addEventListener("blur", () => el.classList.remove("townsquare-avatar--composing"));
  } else {
    // Clicking away with nothing typed returns to the resting nameplate. A
    // pending value keeps the composer open so the send button stays reachable.
    input.addEventListener("blur", () => {
      if (input.value.trim() === "") closeComposer();
    });
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    // A blocked send (e.g. slow mode) returns false: keep the text and stay
    // open so the visitor can resend once the cooldown lapses.
    if (onSubmitChat?.() === false) {
      input.focus();
      return;
    }
    onTypingChange?.(false);
    if (toolbarMode) {
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
 * @param {{ displayName?: string, color?: string, badgeColor?: string, readingLabel?: string, readingUrl?: string, readingActive?: boolean }} profile
 */
export function setAvatarProfile(avatar, profile = {}) {
  const displayName = normalizeDisplayName(profile.displayName);
  const color = typeof profile.color === "string" ? profile.color : "";
  const readingLabel = normalizeReadingLabel(profile.readingLabel);
  const readingUrl = typeof profile.readingUrl === "string" ? profile.readingUrl : "";
  const readingActive = profile.readingActive !== false;
  const isOwner = Boolean(profile.isOwner);
  const isPeer = avatar.el.classList.contains("townsquare-avatar--peer");
  avatar.el.dataset.color = color;
  avatar.el.style.color = color || "";
  avatar.el.classList.toggle("townsquare-avatar--owner", isOwner);
  avatar.el.classList.toggle("townsquare-avatar--has-display-name", Boolean(displayName));
  avatar.el.classList.toggle("townsquare-avatar--has-reading", Boolean(readingLabel));
  const isAway = Boolean(readingLabel) && !readingActive;
  avatar.el.classList.toggle("townsquare-avatar--reading-away", isAway);
  // A figure that stays away (zZz) too long fades out completely; coming back
  // to the tab flips readingActive true again and reveals it. The timer is only
  // armed on entering the away state, so repeated profile renders don't reset it.
  if (isAway) {
    if (!avatar.awayTimer && !avatar.el.classList.contains("townsquare-avatar--asleep")) {
      avatar.awayTimer = setTimeout(() => {
        avatar.awayTimer = null;
        avatar.el.classList.add("townsquare-avatar--asleep");
      }, AWAY_HIDE_MS);
    }
  } else {
    if (avatar.awayTimer) {
      clearTimeout(avatar.awayTimer);
      avatar.awayTimer = null;
    }
    avatar.el.classList.remove("townsquare-avatar--asleep");
  }
  if (avatar.dot) {
    avatar.dot.style.background = color || "";
  }
  if (avatar.colorButton) {
    avatar.colorButton.style.setProperty("--swatch", color || "");
    avatar.colorButton.title = color || "Choose character color";
  }
  if (avatar.crownEl) {
    avatar.crownEl.hidden = !isOwner;
  }
  if (avatar.ownerRoleEl) {
    avatar.ownerRoleEl.hidden = !isOwner;
  }
  if (isOwner && typeof profile.badgeColor === "string" && profile.badgeColor) {
    avatar.el.style.setProperty("--owner-badge-bg", profile.badgeColor);
  } else {
    avatar.el.style.removeProperty("--owner-badge-bg");
  }
  if (avatar.nameEl) {
    avatar.nameEl.textContent = avatar.staticSelfLabel
      ? (displayName || "you")
      : displayName || (isPeer ? (isOwner ? "owner" : "") : "you");
    avatar.nameEl.dataset.value = displayName;
    // Owners always show a nameplate so the verified crown stays visible.
    avatar.nameEl.toggleAttribute("hidden", !displayName && !isOwner && isPeer);
  }
  if (avatar.readingEl && avatar.readingLabelEl) {
    avatar.readingLabelEl.textContent = readingLabel;
    avatar.readingEl.title = readingLabel;
    if (readingUrl) {
      avatar.readingEl.href = readingUrl;
    } else {
      avatar.readingEl.removeAttribute("href");
    }
    avatar.readingEl.classList.toggle("townsquare-avatar__reading--available", Boolean(readingLabel));
    avatar.readingEl.toggleAttribute("hidden", !readingLabel);
  }
  if (avatar.below && isPeer) {
    avatar.below.toggleAttribute("hidden", !displayName && !readingLabel && !isOwner);
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
export function setSendReady(avatar, ready) {
  avatar.send?.classList.toggle("townsquare-avatar__send--ready", ready);
}

/**
 * Clear timers owned by one avatar. DOM removal stays with callers so this can
 * be used both for peers leaving and for whole-widget teardown.
 *
 * @param {AvatarView} avatar
 */
export function destroyAvatar(avatar) {
  clearTimeout(avatar.jumpTimer);
  clearTimeout(avatar.raisedHandTimer);
  clearTimeout(avatar.highFiveTimer);
  clearTimeout(avatar.awayTimer);
  avatar.jumpTimer = null;
  avatar.raisedHandTimer = null;
  avatar.highFiveTimer = null;
  avatar.awayTimer = null;
  for (const message of avatar.messages) {
    clearTimeout(message.timer);
    clearTimeout(message.removeTimer);
    message.timer = null;
    message.removeTimer = null;
  }
  for (const message of avatar.expiringMessages) {
    clearTimeout(message.timer);
    clearTimeout(message.removeTimer);
    message.timer = null;
    message.removeTimer = null;
  }
  avatar.messages = [];
  avatar.expiringMessages = [];
}

/**
 * Build a single speech bubble for the ghost stack.
 *
 * @param {string} text
 * @returns {HTMLElement}
 */
export function createBubble(text) {
  const bubble = document.createElement("div");
  bubble.className = "townsquare-avatar__bubble";

  const body = document.createElement("span");
  body.className = "townsquare-avatar__bubble-text";
  body.textContent = text;

  const tail = document.createElement("span");
  tail.className = "townsquare-avatar__tail";

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
  row.className = "townsquare-avatar__tray-row";

  const text = document.createElement("span");
  text.className = "townsquare-avatar__tray-msg";
  text.textContent = message.text;

  const time = document.createElement("time");
  time.className = "townsquare-avatar__tray-time";
  const date = new Date(message.at);
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  row.append(text, time);
  return row;
}
