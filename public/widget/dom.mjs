/**
 * DOM construction and avatar/scene rendering for the TownSquare widget.
 */

import { AWAY_HIDE_MS, DISPLAY_NAME_MAX, HIGH_FIVE_MS, JUMP_MS, MESSAGE_MAX, POSE_STAND_MS, RAISED_HAND_MS } from "./constants.mjs";
import { figureMarkup } from "./figure.mjs";
import { normalizeDisplayName, normalizeReadingLabel } from "./utils.mjs";

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
 * @property {Array<HTMLButtonElement>} [colorSwatches]
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

const JUMP_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 19V5"></path>
    <path d="M6 11l6-6 6 6"></path>
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
const MAP_URL = "https://townsquare.cauenapier.com/map";

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @returns {{ app: HTMLElement, stage: HTMLElement, statusRow: HTMLElement, status: HTMLElement, quietButton: HTMLButtonElement, expandButton: HTMLButtonElement, helpButton: HTMLButtonElement, helpScrim: HTMLElement, helpPanel: HTMLElement, jumpButton: HTMLButtonElement, highFiveButton: HTMLButtonElement, toolbar: HTMLElement }}
 */
export function renderShell(container) {
  const element = document.createElement("section");
  element.className = "townsquare";

  const controls = document.createElement("div");
  controls.className = "townsquare__controls";

  const expandButton = document.createElement("button");
  expandButton.className = "townsquare__control townsquare__control--expand";
  expandButton.type = "button";
  expandButton.innerHTML = EXPAND_ICON;
  expandButton.setAttribute("aria-label", "Expand widget");
  expandButton.setAttribute("aria-pressed", "false");
  expandButton.title = "Expand";

  const quietButton = document.createElement("button");
  quietButton.className = "townsquare__control";
  quietButton.type = "button";
  quietButton.innerHTML = QUIET_ICON;
  quietButton.setAttribute("aria-label", "Disable TownSquare");
  quietButton.setAttribute("aria-pressed", "false");
  quietButton.title = "Disable TownSquare";

  const helpButton = document.createElement("button");
  helpButton.className = "townsquare__control townsquare__help-button";
  helpButton.type = "button";
  helpButton.setAttribute("aria-label", "About TownSquare");
  helpButton.setAttribute("aria-expanded", "false");
  helpButton.setAttribute("aria-controls", "townsquare-help-panel");
  helpButton.title = "About TownSquare";
  helpButton.textContent = "?";

  const helpScrim = document.createElement("div");
  helpScrim.className = "townsquare__help-scrim";
  helpScrim.hidden = true;

  const helpPanel = document.createElement("div");
  helpPanel.className = "townsquare__help-panel";
  helpPanel.id = "townsquare-help-panel";
  helpPanel.setAttribute("role", "dialog");
  helpPanel.setAttribute("aria-modal", "true");
  helpPanel.setAttribute("aria-labelledby", "townsquare-help-title");

  const helpTitle = document.createElement("strong");
  helpTitle.id = "townsquare-help-title";
  helpTitle.textContent = "TownSquare";

  const description = document.createElement("p");
  description.textContent = "A tiny shared place for people visiting this site.";

  const instructions = document.createElement("p");
  instructions.textContent =
    "Move with the arrow keys, tap where you want to walk, or swipe left and right on touch screens. Press J to jump and H to show a high-five; on touch, use the action buttons. Press T or tap your nameplate to chat, and tap a character to see their recent messages.";

  const links = document.createElement("p");
  links.className = "townsquare__help-links";

  const mapLink = document.createElement("a");
  mapLink.href = MAP_URL;
  mapLink.target = "_blank";
  mapLink.rel = "noopener noreferrer";
  mapLink.textContent = "map";

  const homeLink = document.createElement("a");
  homeLink.href = TOWNSQUARE_URL;
  homeLink.target = "_blank";
  homeLink.rel = "noopener noreferrer";
  homeLink.textContent = "townsquare.cauenapier.com";

  links.append(
    "View the world of Town Squares and its active cities on the ", mapLink, ".",
    document.createElement("br"),
    "Learn more and add your own Town Square at ", homeLink, "."
  );

  helpPanel.append(helpTitle, description, instructions, links);
  helpScrim.appendChild(helpPanel);

  controls.append(expandButton, quietButton, helpButton);

  const actions = document.createElement("div");
  actions.className = "townsquare__actions";

  const jumpButton = document.createElement("button");
  jumpButton.className = "townsquare__action";
  jumpButton.type = "button";
  jumpButton.innerHTML = JUMP_ICON;
  jumpButton.setAttribute("aria-label", "Jump");
  jumpButton.title = "Jump";

  const highFiveButton = document.createElement("button");
  highFiveButton.className = "townsquare__action";
  highFiveButton.type = "button";
  highFiveButton.textContent = "🙌";
  highFiveButton.setAttribute("aria-label", "High five");
  highFiveButton.title = "High five";

  actions.append(jumpButton, highFiveButton);

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

  // Touch-only bottom bar. Empty until coarse-pointer mounts dock the composer,
  // pencil, and action buttons into it; hidden via CSS on fine pointers.
  const toolbar = document.createElement("div");
  toolbar.className = "townsquare__toolbar";

  element.append(controls, actions, statusRow, stageEl, toolbar);
  container.append(element, helpScrim);
  return {
    app: element,
    stage: stageEl,
    statusRow,
    status,
    quietButton,
    expandButton,
    helpButton,
    helpScrim,
    helpPanel,
    jumpButton,
    highFiveButton,
    toolbar,
  };
}

/**
 * Toggle the About panel from the help button; closes on outside click.
 *
 * @param {HTMLButtonElement} helpButton
 * @param {HTMLElement} helpScrim
 * @param {HTMLElement} helpPanel
 * @param {HTMLButtonElement} quietButton
 * @returns {() => void}
 */
export function wireHelpPanel(helpButton, helpScrim, helpPanel, quietButton) {
  const setHelpOpen = (open) => {
    helpScrim.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
  };

  const onHelpClick = () => setHelpOpen(helpScrim.hidden);
  const onHelpPointerDown = (event) => {
    if (helpScrim.hidden) return;
    const target = event.target;
    if (
      target instanceof Node
      && (helpButton.contains(target) || helpPanel.contains(target) || quietButton.contains(target))
    ) return;
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
 * On touch devices the floating nameplate under the figure is fragile (edge
 * clipping, virtual keyboard cover, overlap with peers), so callers can pass
 * `toolbarHost` to dock a fixed bottom bar instead: an always-visible chat
 * input plus the rename pencil (and, wired by the mount, the action buttons).
 * The under-figure label then shows the display name, or "you" when unset.
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
  profileButton.className = "townsquare-avatar__profile-button";
  profileButton.type = "button";
  profileButton.innerHTML = PENCIL_ICON;
  profileButton.setAttribute("aria-label", "Edit character");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.title = "Edit character";

  // Desktop: a "you · say something" pill that opens the inline composer, with
  // the pencil beside it. Toolbar mode drops the pill (the input is always
  // visible in the bar) and keeps only the static identity label.
  let plate = null;
  let plateRow = null;
  let selfId = null;
  if (toolbarMode) {
    selfId = document.createElement("div");
    selfId.className = "townsquare-avatar__self-id";
    selfId.append(dot, crownEl, nameEl);
  } else {
    plate = document.createElement("button");
    plate.className = "townsquare-avatar__plate";
    plate.type = "button";
    plate.setAttribute("aria-label", "Say something");

    const hint = document.createElement("span");
    hint.className = "townsquare-avatar__plate-hint";
    hint.textContent = "· say something";
    plate.append(dot, crownEl, nameEl, hint);

    plateRow = document.createElement("div");
    plateRow.className = "townsquare-avatar__plate-row";
    plateRow.append(plate, profileButton);
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

  const swatches = document.createElement("div");
  swatches.className = "townsquare-avatar__swatches";

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

  const profileDone = document.createElement("button");
  profileDone.className = "townsquare-avatar__profile-done";
  profileDone.type = "submit";
  profileDone.innerHTML = ENTER_ICON;
  profileDone.setAttribute("aria-label", "Save character");

  profileForm.append(profileInput, swatches, profileDone);

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
    below.append(selfId, ownerRoleEl);
    // profileForm is absolutely positioned above the bar via CSS, so its order
    // among the toolbar's flex children doesn't matter.
    toolbarHost.append(composer, profileButton, profileForm);
  } else {
    below.append(plateRow, ownerRoleEl, profileForm, composer);
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
    colorSwatches,
    composer,
    input,
    send,
    hint: cooldownHint,
    // Toolbar mode keeps a compact under-figure label (name or "you").
    staticSelfLabel: toolbarMode,
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
    // Toolbar mode keeps the chat input permanently visible, so opening the
    // rename editor must not try to close it.
    if (!toolbarMode && !composer.hidden) closeComposer();
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

  plate?.addEventListener("click", openComposer);
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
function setSendReady(avatar, ready) {
  avatar.send?.classList.toggle("townsquare-avatar__send--ready", ready);
}

/**
 * @param {HTMLElement} container
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} props
 */
export function renderProps(container, props = []) {
  for (const prop of props) {
    const el = document.createElement("div");
    el.className = `prop prop--${prop.kind}`;
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
  avatar.el.classList.toggle("townsquare-avatar--flipped", movingLeft);
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} walking
 */
export function setWalking(avatar, walking) {
  if (walking) clearHighFiveState(avatar);
  avatar.el.classList.toggle("townsquare-avatar--walking", walking);
}

/**
 * @param {AvatarView} avatar
 */
export function playJump(avatar) {
  avatar.el.classList.remove("townsquare-avatar--jumping");
  clearTimeout(avatar.jumpTimer);
  void avatar.el.offsetWidth;
  avatar.el.classList.add("townsquare-avatar--jumping");
  avatar.jumpTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--jumping");
    avatar.jumpTimer = null;
  }, JUMP_MS);
}

/**
 * @param {AvatarView} avatar
 */
export function clearRaisedHand(avatar) {
  clearTimeout(avatar.raisedHandTimer);
  avatar.raisedHandTimer = null;
  avatar.el.classList.remove("townsquare-avatar--raised-hand");
}

/**
 * @param {AvatarView} avatar
 */
export function clearHighFiveState(avatar) {
  clearRaisedHand(avatar);
  clearTimeout(avatar.highFiveTimer);
  avatar.highFiveTimer = null;
  avatar.el.classList.remove("townsquare-avatar--high-five");
}

/**
 * @param {AvatarView} avatar
 */
export function playRaisedHand(avatar) {
  clearTimeout(avatar.raisedHandTimer);
  avatar.el.classList.add("townsquare-avatar--raised-hand");
  avatar.raisedHandTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--raised-hand");
    avatar.raisedHandTimer = null;
  }, RAISED_HAND_MS);
}

/**
 * @param {AvatarView} avatar
 */
export function playHighFive(avatar) {
  clearHighFiveState(avatar);
  void avatar.el.offsetWidth;
  avatar.el.classList.add("townsquare-avatar--high-five");
  avatar.highFiveTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--high-five");
    avatar.highFiveTimer = null;
  }, HIGH_FIVE_MS);
}

/**
 * @param {{ pose: string | null }} presence
 * @returns {boolean}
 */
export function needsStandUp(presence) {
  return presence.pose === "sitting" || presence.pose === "resting";
}

/**
 * @param {{ pose: string | null, propId: string | null, avatar: AvatarView, x: number }} presence
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} sceneProps
 */
export function clearPresencePose(presence, sceneProps) {
  presence.pose = null;
  presence.propId = null;
  updatePose(presence.avatar, presence.pose);
  updatePropEffects(presence.avatar, presence.x, presence.propId, sceneProps);
  setWalking(presence.avatar, false);
}

/**
 * @param {{ avatar: AvatarView, x: number }} initiator
 * @param {{ avatar: AvatarView, x: number }} target
 * @param {boolean} standUpFirst
 */
export function playHighFivePair(initiator, target, standUpFirst) {
  const play = () => {
    setFacing(initiator.avatar, target.x < initiator.x);
    setFacing(target.avatar, initiator.x < target.x);
    playHighFive(initiator.avatar);
    playHighFive(target.avatar);
  };
  if (standUpFirst) {
    setTimeout(play, POSE_STAND_MS);
  } else {
    play();
  }
}

/**
 * @param {AvatarView} avatar
 * @param {string | null} pose
 */
export function updatePose(avatar, pose) {
  avatar.el.classList.toggle("townsquare-avatar--sitting", pose === "sitting");
  avatar.el.classList.toggle("townsquare-avatar--resting", pose === "resting");
  if (pose) {
    setWalking(avatar, false);
  }
}

/**
 * @param {AvatarView} avatar
 * @param {number} x
 * @param {string | null} propId
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} props
 */
export function updatePropEffects(avatar, x, propId, props = []) {
  const activeProp = props.find((prop) => prop.id === propId);
  if (activeProp?.faceAway) {
    setFacing(avatar, x >= activeProp.x);
  }

  avatar.el.classList.toggle(
    "townsquare-avatar--shaded",
    props.some((prop) => prop.shadeRadius && Math.abs(x - prop.x) < prop.shadeRadius),
  );
  avatar.el.classList.toggle(
    "townsquare-avatar--lit",
    props.some((prop) => prop.lightRadius && Math.abs(x - prop.x) < prop.lightRadius),
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
