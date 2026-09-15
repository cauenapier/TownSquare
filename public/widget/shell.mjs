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

const COMPASS_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.25"></circle>
    <path d="m15.1 8.9-1.8 4.4-4.4 1.8 1.8-4.4 4.4-1.8Z"></path>
    <circle cx="12" cy="12" r=".65" fill="currentColor" stroke="none"></circle>
  </svg>
`;

const TOWNSQUARE_URL = "https://townsquare.cauenapier.com/";
const MAP_URL = "https://townsquare.cauenapier.com/map";
const BUILD_URL = "https://townsquare.cauenapier.com/register";

let nextShellId = 1;

/**
 * Mount the widget shell into the host root.
 *
 * @param {HTMLElement} container
 * @returns {{ app: HTMLElement, stage: HTMLElement, statusRow: HTMLElement, status: HTMLElement, enableToggle: HTMLInputElement, enableToggleLabel: HTMLLabelElement, expandButton: HTMLButtonElement, discoveryButton: HTMLButtonElement, discoveryPopover: HTMLElement, randomTownLink: HTMLAnchorElement, randomTownStatus: HTMLElement, buildLink: HTMLAnchorElement, mapLink: HTMLAnchorElement, aboutLink: HTMLAnchorElement, jumpButton: HTMLButtonElement, highFiveButton: HTMLButtonElement, feedBirdsButton: HTMLButtonElement, toolbar: HTMLElement }}
 */
export function renderShell(container) {
  const shellId = nextShellId;
  nextShellId += 1;
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

  const discoveryButton = document.createElement("button");
  discoveryButton.className = "townsquare__button townsquare__button--sm townsquare__discovery-button";
  discoveryButton.type = "button";
  discoveryButton.innerHTML = COMPASS_ICON;
  discoveryButton.setAttribute("aria-label", "Explore TownSquare");
  discoveryButton.setAttribute("aria-haspopup", "dialog");
  discoveryButton.setAttribute("aria-expanded", "false");
  discoveryButton.setAttribute("aria-controls", `townsquare-discovery-${shellId}`);
  discoveryButton.title = "Explore TownSquare";

  const discoveryPopover = document.createElement("div");
  discoveryPopover.className = "townsquare__discovery-popover";
  discoveryPopover.id = `townsquare-discovery-${shellId}`;
  discoveryPopover.hidden = true;
  discoveryPopover.setAttribute("role", "dialog");
  discoveryPopover.setAttribute("aria-labelledby", `townsquare-discovery-title-${shellId}`);

  const discoveryTitle = document.createElement("strong");
  discoveryTitle.className = "townsquare__discovery-title";
  discoveryTitle.id = `townsquare-discovery-title-${shellId}`;
  discoveryTitle.textContent = "TownSquare";

  const discoveryActions = document.createElement("div");
  discoveryActions.className = "townsquare__discovery-actions";

  const randomTownLink = document.createElement("a");
  randomTownLink.className = "townsquare__discovery-action";
  randomTownLink.target = "_blank";
  randomTownLink.rel = "noopener noreferrer";
  randomTownLink.tabIndex = 0;
  randomTownLink.setAttribute("role", "link");
  randomTownLink.setAttribute("aria-disabled", "true");

  const randomTownLabel = document.createElement("span");
  randomTownLabel.className = "townsquare__discovery-action-label";
  randomTownLabel.textContent = "🎲 Visit another town";

  const randomTownStatus = document.createElement("span");
  randomTownStatus.className = "townsquare__discovery-action-subtitle";
  randomTownStatus.setAttribute("aria-live", "polite");
  randomTownStatus.textContent = "See where the compass points";
  randomTownLink.append(randomTownLabel, randomTownStatus);

  const buildLink = document.createElement("a");
  buildLink.className = "townsquare__discovery-action";
  buildLink.href = BUILD_URL;
  buildLink.target = "_blank";
  buildLink.rel = "noopener noreferrer";

  const buildLabel = document.createElement("span");
  buildLabel.className = "townsquare__discovery-action-label";
  buildLabel.textContent = "✨ Build your own TownSquare";

  const buildSubtitle = document.createElement("span");
  buildSubtitle.className = "townsquare__discovery-action-subtitle";
  buildSubtitle.textContent = "Free & open source";
  buildLink.append(buildLabel, buildSubtitle);
  discoveryActions.append(randomTownLink, buildLink);

  const discoveryLinks = document.createElement("nav");
  discoveryLinks.className = "townsquare__discovery-links";
  discoveryLinks.setAttribute("aria-label", "More about TownSquare");

  const mapLink = document.createElement("a");
  mapLink.href = MAP_URL;
  mapLink.target = "_blank";
  mapLink.rel = "noopener noreferrer";
  mapLink.textContent = "🗺 View the map";

  const aboutLink = document.createElement("a");
  aboutLink.href = TOWNSQUARE_URL;
  aboutLink.target = "_blank";
  aboutLink.rel = "noopener noreferrer";
  aboutLink.textContent = "? What is TownSquare?";
  discoveryLinks.append(mapLink, aboutLink);

  const help = document.createElement("p");
  help.className = "townsquare__discovery-help";
  help.textContent = "Walk with ← →, tap, or swipe · J jump · H high-five · B feed birds · T or tap your name to chat · Tap a visitor for recent messages";

  discoveryPopover.append(discoveryTitle, discoveryActions, discoveryLinks, help);

  controls.append(expandButton, enableToggleLabel, discoveryButton);

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
  container.append(element, discoveryPopover);
  return {
    app: element,
    stage: stageEl,
    statusRow,
    status,
    enableToggle,
    enableToggleLabel,
    expandButton,
    discoveryButton,
    discoveryPopover,
    randomTownLink,
    randomTownStatus,
    buildLink,
    mapLink,
    aboutLink,
    jumpButton,
    highFiveButton,
    feedBirdsButton,
    toolbar,
    actionZone,
  };
}

/**
 * Wire the anchored discovery popover, its random destination, and anonymous
 * aggregate click events.
 *
 * @param {{ discoveryButton: HTMLButtonElement, discoveryPopover: HTMLElement, randomTownLink: HTMLAnchorElement, randomTownStatus: HTMLElement, buildLink: HTMLAnchorElement, mapLink: HTMLAnchorElement, aboutLink: HTMLAnchorElement, serverOrigin: string, siteKey?: string }} options
 * @returns {() => void}
 */
export function wireDiscoveryPopover({
  discoveryButton,
  discoveryPopover,
  randomTownLink,
  randomTownStatus,
  buildLink,
  mapLink,
  aboutLink,
  serverOrigin,
  siteKey = "",
}) {
  let randomRequestId = 0;

  const reportEvent = (event) => {
    if (!siteKey || typeof navigator?.sendBeacon !== "function") return;
    try {
      const payload = new Blob([JSON.stringify({ siteKey, event })], { type: "text/plain" });
      navigator.sendBeacon(`${serverOrigin}/api/discovery/event`, payload);
    } catch {
      // Aggregate analytics are best-effort and never block an interaction.
    }
  };

  const positionPopover = () => {
    if (discoveryPopover.hidden) return;
    const margin = 8;
    const gap = 7;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const buttonRect = discoveryButton.getBoundingClientRect();
    discoveryPopover.style.removeProperty("max-height");
    const popoverRect = discoveryPopover.getBoundingClientRect();
    const left = Math.min(
      viewportLeft + viewportWidth - popoverRect.width - margin,
      Math.max(viewportLeft + margin, buttonRect.right - popoverRect.width),
    );
    const below = buttonRect.bottom + gap;
    const availableBelow = viewportTop + viewportHeight - margin - below;
    const availableAbove = buttonRect.top - gap - viewportTop - margin;
    const placeBelow = popoverRect.height <= availableBelow || availableBelow >= availableAbove;
    const availableHeight = Math.max(1, placeBelow ? availableBelow : availableAbove);
    discoveryPopover.style.maxHeight = `${Math.floor(availableHeight)}px`;
    const fittedHeight = discoveryPopover.getBoundingClientRect().height;
    const top = placeBelow ? below : buttonRect.top - fittedHeight - gap;
    discoveryPopover.style.left = `${Math.round(left)}px`;
    discoveryPopover.style.top = `${Math.round(top)}px`;
    discoveryPopover.removeAttribute("data-positioning");
  };

  const loadRandomTown = async () => {
    const requestId = ++randomRequestId;
    randomTownLink.removeAttribute("href");
    randomTownLink.setAttribute("aria-disabled", "true");
    randomTownLink.setAttribute("aria-busy", "true");
    randomTownStatus.textContent = "Finding a town…";
    try {
      const url = new URL("/api/discovery/random", serverOrigin);
      if (siteKey) url.searchParams.set("siteKey", siteKey);
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      const body = await response.json();
      if (requestId !== randomRequestId) return;
      const destination = new URL(body?.town?.url || "");
      if (!response.ok || !["http:", "https:"].includes(destination.protocol)) throw new Error("unavailable");
      randomTownLink.href = destination.href;
      randomTownLink.setAttribute("aria-disabled", "false");
      randomTownStatus.textContent = body.town.name ? `Visit ${body.town.name}` : "See where the compass points";
    } catch {
      if (requestId !== randomRequestId) return;
      randomTownStatus.textContent = "No other towns available right now";
    } finally {
      if (requestId === randomRequestId) randomTownLink.removeAttribute("aria-busy");
    }
  };

  const setOpen = (open, { returnFocus = false } = {}) => {
    if (open === !discoveryPopover.hidden) return;
    discoveryPopover.hidden = !open;
    discoveryButton.setAttribute("aria-expanded", String(open));
    discoveryButton.classList.toggle("townsquare__button--active", open);
    if (open) {
      discoveryPopover.setAttribute("data-positioning", "");
      positionPopover();
      reportEvent("discovery_menu_opened");
      void loadRandomTown();
      randomTownLink.focus({ preventScroll: true });
    } else if (returnFocus) {
      discoveryButton.focus({ preventScroll: true });
    }
  };

  const onDiscoveryClick = () => setOpen(discoveryPopover.hidden);
  const onDocumentPointerDown = (event) => {
    if (discoveryPopover.hidden) return;
    const target = event.target;
    if (
      target instanceof Node
      && (discoveryButton.contains(target) || discoveryPopover.contains(target))
    ) return;
    setOpen(false);
  };
  const onDocumentKeyDown = (event) => {
    if (event.key !== "Escape" || discoveryPopover.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { returnFocus: true });
  };
  const onRandomClick = (event) => {
    if (randomTownLink.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    reportEvent("random_town_clicked");
    setOpen(false);
  };
  const wireTrackedLink = (link, eventName) => {
    const listener = () => {
      reportEvent(eventName);
      setOpen(false);
    };
    link.addEventListener("click", listener);
    return () => link.removeEventListener("click", listener);
  };

  discoveryButton.addEventListener("click", onDiscoveryClick);
  randomTownLink.addEventListener("click", onRandomClick);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("resize", positionPopover);
  window.addEventListener("scroll", positionPopover, true);
  window.visualViewport?.addEventListener("resize", positionPopover);
  window.visualViewport?.addEventListener("scroll", positionPopover);
  const unwireBuild = wireTrackedLink(buildLink, "build_townsquare_clicked");
  const unwireMap = wireTrackedLink(mapLink, "map_clicked");
  const unwireAbout = wireTrackedLink(aboutLink, "about_clicked");

  return () => {
    randomRequestId += 1;
    discoveryButton.removeEventListener("click", onDiscoveryClick);
    randomTownLink.removeEventListener("click", onRandomClick);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    window.removeEventListener("resize", positionPopover);
    window.removeEventListener("scroll", positionPopover, true);
    window.visualViewport?.removeEventListener("resize", positionPopover);
    window.visualViewport?.removeEventListener("scroll", positionPopover);
    unwireBuild();
    unwireMap();
    unwireAbout();
    setOpen(false);
  };
}
