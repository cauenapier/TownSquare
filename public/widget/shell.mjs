/**
 * Widget shell DOM construction and help-panel wiring.
 */

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

const CRUMBS_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 15c3.5-3.8 6.8-4.9 10-3.2l2.8 1.5"></path>
    <path d="M5 15l4 3.2c1.2.9 2.8 1 4 .2l2-1.3"></path>
    <circle cx="17.8" cy="8.2" r=".8" fill="currentColor" stroke="none"></circle>
    <circle cx="20.5" cy="11" r=".65" fill="currentColor" stroke="none"></circle>
    <circle cx="15.2" cy="5.7" r=".6" fill="currentColor" stroke="none"></circle>
  </svg>
`;

const TOWNSQUARE_URL = "https://townsquare.cauenapier.com/";
const MAP_URL = "https://townsquare.cauenapier.com/map";

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @returns {{ app: HTMLElement, stage: HTMLElement, statusRow: HTMLElement, status: HTMLElement, enableToggle: HTMLInputElement, enableToggleLabel: HTMLLabelElement, expandButton: HTMLButtonElement, helpButton: HTMLButtonElement, helpScrim: HTMLElement, helpPanel: HTMLElement, jumpButton: HTMLButtonElement, highFiveButton: HTMLButtonElement, feedBirdsButton: HTMLButtonElement, toolbar: HTMLElement }}
 */
export function renderShell(container) {
  const element = document.createElement("section");
  element.className = "townsquare";

  const controls = document.createElement("div");
  controls.className = "townsquare__controls";

  const expandButton = document.createElement("button");
  expandButton.className = "townsquare__button townsquare__button--sm townsquare__button--expand";
  expandButton.type = "button";
  expandButton.innerHTML = EXPAND_ICON;
  expandButton.setAttribute("aria-label", "Expand widget");
  expandButton.setAttribute("aria-pressed", "false");
  expandButton.title = "Expand";

  const enableToggleLabel = document.createElement("label");
  enableToggleLabel.className = "townsquare__enable-toggle";

  const enableToggle = document.createElement("input");
  enableToggle.className = "townsquare__enable-toggle-input";
  enableToggle.type = "checkbox";
  enableToggle.checked = true;
  enableToggle.setAttribute("aria-label", "TownSquare enabled");
  enableToggle.title = "Disable TownSquare";

  const enableToggleTrack = document.createElement("span");
  enableToggleTrack.className = "townsquare__enable-toggle-track";
  enableToggleTrack.setAttribute("aria-hidden", "true");

  enableToggleLabel.append(enableToggle, enableToggleTrack);

  const helpButton = document.createElement("button");
  helpButton.className = "townsquare__button townsquare__button--sm townsquare__help-button";
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
    "Move with the arrow keys, tap where you want to walk, or swipe left and right on touch screens. Press J to jump, H to show a high-five, and B to throw crumbs for the birds; on touch, use the action buttons. Press T or tap your nameplate to chat, and tap a character to see their recent messages.";

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

  controls.append(expandButton, enableToggleLabel, helpButton);

  const actions = document.createElement("div");
  actions.className = "townsquare__actions";

  const jumpButton = document.createElement("button");
  jumpButton.className = "townsquare__button townsquare__button--md";
  jumpButton.type = "button";
  jumpButton.innerHTML = JUMP_ICON;
  jumpButton.setAttribute("aria-label", "Jump");
  jumpButton.title = "Jump";

  const highFiveButton = document.createElement("button");
  highFiveButton.className = "townsquare__button townsquare__button--md";
  highFiveButton.type = "button";
  highFiveButton.textContent = "🙌";
  highFiveButton.setAttribute("aria-label", "High five");
  highFiveButton.title = "High five";

  const feedBirdsButton = document.createElement("button");
  feedBirdsButton.className = "townsquare__button townsquare__button--md";
  feedBirdsButton.type = "button";
  feedBirdsButton.innerHTML = CRUMBS_ICON;
  feedBirdsButton.setAttribute("aria-label", "Throw crumbs for the birds");
  feedBirdsButton.title = "Feed the birds";

  actions.append(jumpButton, highFiveButton, feedBirdsButton);

  const statusRow = document.createElement("div");
  statusRow.className = "townsquare__status";

  const status = document.createElement("span");
  status.textContent = "Connecting…";

  statusRow.append(status);

  const stageEl = document.createElement("div");
  stageEl.className = "townsquare__stage";

  // Ground band: independent zone between stage and action area
  const ground = document.createElement("div");
  ground.className = "townsquare__ground";

  // Touch-only bottom bar. Empty until coarse-pointer mounts dock the composer,
  // pencil, and action buttons into it; hidden via CSS on fine pointers.
  const toolbar = document.createElement("div");
  toolbar.className = "townsquare__toolbar";

  // Action zone: dedicated space below the scene for UI chrome with customizable styling.
  const actionZone = document.createElement("div");
  actionZone.className = "townsquare__action-zone";
  actionZone.append(actions, toolbar);

  // Three independent zones: stage (sky) / ground / action-zone
  element.append(controls, statusRow, stageEl, ground, actionZone);
  container.append(element, helpScrim);
  return {
    app: element,
    stage: stageEl,
    statusRow,
    status,
    enableToggle,
    enableToggleLabel,
    expandButton,
    helpButton,
    helpScrim,
    helpPanel,
    jumpButton,
    highFiveButton,
    feedBirdsButton,
    toolbar,
    actionZone,
  };
}

/**
 * Toggle the About panel from the help button; closes on outside click.
 *
 * @param {HTMLButtonElement} helpButton
 * @param {HTMLElement} helpScrim
 * @param {HTMLElement} helpPanel
 * @param {HTMLElement} enableToggleLabel
 * @returns {() => void}
 */
export function wireHelpPanel(helpButton, helpScrim, helpPanel, enableToggleLabel) {
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
      && (helpButton.contains(target) || helpPanel.contains(target) || enableToggleLabel.contains(target))
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
