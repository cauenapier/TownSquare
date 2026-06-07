const BUBBLE_TTL_MS = 6000;
const BROWSER_ID_KEY = "townsquare-browser-id";
const BENCH_SETTLE_MS = 700;
const MAX_RECENT_MESSAGES = 5;
const MOVEMENT_SPEED = 0.22;
const SEND_INTERVAL_MS = 45;
const MIN_X = 0.02;
const MAX_X = 0.98;

const BENCH = {
  id: "bench",
  x: 0.2,
  zoneRadius: 0.035,
  width: 52,
  height: 18,
  svg: `
    <svg viewBox="0 0 50 18" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <line x1="8" y1="8" x2="6" y2="17"></line>
      <line x1="42" y1="8" x2="44" y2="17"></line>
      <line x1="3" y1="8" x2="47" y2="8"></line>
      <line x1="6" y1="1" x2="6" y2="8"></line>
      <line x1="44" y1="1" x2="44" y2="8"></line>
      <line x1="6" y1="2" x2="44" y2="2"></line>
      <line x1="6" y1="5" x2="44" y2="5"></line>
    </svg>
  `,
};

/**
 * Mount a TownSquare widget into any host page.
 *
 * This is the reusable browser boundary. The host page provides a DOM node,
 * while TownSquare owns the scene rendering and realtime connection.
 */
export function mountTownSquare(root, options = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("TownSquare mount root must be an HTMLElement");
  }

  const serverOrigin = normalizeOrigin(
    options.serverOrigin
    || root.dataset.townsquareServerOrigin
    || window.location.origin,
  );
  const socketUrl = buildSocketUrl(serverOrigin, options.socketPath || "/live");
  const browserId = getBrowserId();
  const peers = new Map();

  root.replaceChildren();

  const app = renderShell(root, options);
  const stage = app.querySelector('[data-role="stage"]');
  const statusEl = app.querySelector('[data-role="status"]');

  renderBench(stage);

  const self = {
    id: null,
    x: 0.5,
    movingLeft: false,
    movingRight: false,
    lastSentX: 0.5,
    lastSendAt: 0,
    pose: null,
    propId: null,
    benchZoneEnteredAt: 0,
    benchRequested: false,
    avatar: createAvatar({ isSelf: true }),
    walkTimer: null,
  };

  stage.appendChild(self.avatar.el);
  renderAvatar(self.avatar, self.x);
  updatePose(self.avatar, self.pose);
  updateStatus();

  const socket = new WebSocket(socketUrl);
  wireSocket(socket);
  wireKeyboard();

  let disposed = false;
  let lastFrameAt = performance.now();
  let frameHandle = requestAnimationFrame(tick);

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      socket.close();
      root.replaceChildren();
    },
  };

  function renderShell(container, mountOptions) {
    const element = document.createElement("section");
    element.className = "townsquare";
    element.innerHTML = `
      <div class="townsquare__status">
        <span data-role="status">Connecting…</span>
        <span>${mountOptions.instructions || "Use ← and → to walk. Pause by the bench to sit."}</span>
      </div>
      <div class="townsquare__stage" data-role="stage">
        <div class="townsquare__ground"></div>
      </div>
      <div class="townsquare__hint">${mountOptions.hint || "Embedded into a normal page instead of running as a disconnected mockup."}</div>
    `;
    container.appendChild(element);
    return element;
  }

  function createAvatar({ isSelf }) {
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
      submitChat(input, composer);
    });

    return {
      ...avatar,
      composer,
      input,
    };
  }

  function renderBench(container) {
    const bench = document.createElement("div");
    bench.className = "prop prop--bench";
    bench.style.left = `${(BENCH.x * 100).toFixed(2)}%`;
    bench.style.width = `${BENCH.width}px`;
    bench.style.height = `${BENCH.height}px`;
    bench.innerHTML = BENCH.svg;
    container.appendChild(bench);
  }

  function submitChat(input, composer) {
    const text = input.value.trim();
    if (!text || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: "say", text }));
    addMessage(self.avatar, { text, at: Date.now() });
    showBubble(self.avatar, text);
    input.value = "";
    composer.hidden = true;
    const toggle = composer.parentElement?.querySelector(".avatar__chat-toggle");
    toggle?.setAttribute("aria-expanded", "false");
  }

  function renderAvatar(avatar, x) {
    avatar.el.style.left = `${(x * 100).toFixed(2)}%`;
    avatar.el.classList.toggle("avatar--edge-right", x > 0.78);
  }

  function setFacing(avatar, movingLeft) {
    avatar.el.classList.toggle("flip", !movingLeft);
  }

  function showBubble(avatar, text) {
    avatar.bubble.textContent = text;
    avatar.bubble.hidden = false;
    clearTimeout(avatar.bubbleTimer);
    avatar.bubbleTimer = setTimeout(() => {
      avatar.bubble.hidden = true;
    }, BUBBLE_TTL_MS);
  }

  function addMessage(avatar, message) {
    avatar.messages.push({
      text: message.text,
      at: typeof message.at === "number" ? message.at : Date.now(),
    });
    avatar.messages = avatar.messages.slice(-MAX_RECENT_MESSAGES);
    syncTray(avatar);
  }

  function syncTray(avatar) {
    avatar.el.classList.toggle("avatar--has-history", avatar.messages.length > 0);
    avatar.tray.hidden = avatar.messages.length === 0;
    avatar.trayList.replaceChildren(...avatar.messages.map(renderTrayMessage));
  }

  function renderTrayMessage(message) {
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

  function setWalking(avatar, walking) {
    avatar.el.classList.toggle("walking", walking);
  }

  function updatePose(avatar, pose) {
    avatar.el.classList.toggle("avatar--sitting", pose === "sitting");
    if (pose === "sitting") {
      setWalking(avatar, false);
    }
  }

  function applySelfState(state) {
    const previousX = self.x;
    self.x = state.x;
    self.pose = state.pose || null;
    self.propId = state.propId || null;
    self.benchRequested = false;
    self.benchZoneEnteredAt = 0;
    renderAvatar(self.avatar, self.x);
    if (self.x !== previousX) {
      setFacing(self.avatar, self.x < previousX);
    }
    updatePose(self.avatar, self.pose);
  }

  function applyPeerState(peerState) {
    const peer = addOrUpdatePeer(peerState);
    const previousX = peer.x;
    peer.x = peerState.x;
    peer.pose = peerState.pose || null;
    peer.propId = peerState.propId || null;
    renderAvatar(peer.avatar, peer.x);
    if (peer.x !== previousX) {
      setFacing(peer.avatar, peer.x < previousX);
    }
    updatePose(peer.avatar, peer.pose);
    return peer;
  }

  function updateStatus() {
    const count = peers.size + (self.id ? 1 : 0);
    statusEl.textContent = self.id
      ? `${count} ${count === 1 ? "visitor" : "visitors"} here right now`
      : "Connecting…";
  }

  function addOrUpdatePeer(peer) {
    const existing = peers.get(peer.id);
    if (existing) {
      return existing;
    }

    const avatar = createAvatar({ isSelf: false });
    const nextPeer = {
      id: peer.id,
      x: peer.x,
      pose: peer.pose || null,
      propId: peer.propId || null,
      avatar,
      walkTimer: null,
    };
    peers.set(peer.id, nextPeer);
    stage.appendChild(avatar.el);
    renderAvatar(avatar, nextPeer.x);
    updatePose(avatar, nextPeer.pose);
    for (const recent of peer.messages || []) {
      addMessage(avatar, recent);
    }
    updateStatus();
    return nextPeer;
  }

  function removePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.avatar.el.remove();
    peers.delete(id);
    updateStatus();
  }

  function wireSocket(ws) {
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "init", browserId, x: self.x }));
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "hello") {
        self.id = message.id;
        applySelfState(message);
        for (const recent of message.messages || []) {
          addMessage(self.avatar, recent);
        }
        for (const peer of message.peers) {
          addOrUpdatePeer(peer);
          applyPeerState(peer);
        }
        updateStatus();
        return;
      }

      if (message.type === "join") {
        addOrUpdatePeer(message.peer);
        applyPeerState(message.peer);
        return;
      }

      if (message.type === "leave") {
        removePeer(message.id);
        return;
      }

      if (message.type === "move") {
        if (message.id === self.id) {
          const wasSitting = self.pose === "sitting";
          applySelfState(message);
          if (!self.pose && !wasSitting) {
            setWalking(self.avatar, true);
            clearTimeout(self.walkTimer);
            self.walkTimer = setTimeout(() => setWalking(self.avatar, false), 120);
          }
          return;
        }

        const peer = applyPeerState(message);
        if (!peer.pose) {
          setWalking(peer.avatar, true);
          clearTimeout(peer.walkTimer);
          peer.walkTimer = setTimeout(() => setWalking(peer.avatar, false), 120);
        }
        return;
      }

      if (message.type === "say") {
        if (message.id === self.id) {
          addMessage(self.avatar, { text: message.text, at: message.at });
          showBubble(self.avatar, message.text);
          return;
        }

        const peer = peers.get(message.id);
        if (!peer) return;
        addMessage(peer.avatar, { text: message.text, at: message.at });
        showBubble(peer.avatar, message.text);
      }
    });

    ws.addEventListener("close", () => {
      statusEl.textContent = "Disconnected. Refresh to rejoin the square.";
    });
  }

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft") self.movingLeft = true;
    if (event.key === "ArrowRight") self.movingRight = true;
  }

  function onKeyUp(event) {
    if (event.key === "ArrowLeft") self.movingLeft = false;
    if (event.key === "ArrowRight") self.movingRight = false;
  }

  function wireKeyboard() {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  function clampSelfX(x) {
    return Math.max(MIN_X, Math.min(MAX_X, x));
  }

  function resetBenchSettle() {
    self.benchZoneEnteredAt = 0;
    self.benchRequested = false;
  }

  function maybeRequestBenchSettle(now) {
    if (self.pose === "sitting") return;
    if (socket.readyState !== WebSocket.OPEN) return;

    const isNearBench = Math.abs(self.x - BENCH.x) < BENCH.zoneRadius;
    if (!isNearBench) {
      resetBenchSettle();
      return;
    }

    if (!self.benchZoneEnteredAt) {
      self.benchZoneEnteredAt = now;
    }

    if (self.benchRequested || now - self.benchZoneEnteredAt < BENCH_SETTLE_MS) {
      return;
    }

    self.benchRequested = true;
    socket.send(JSON.stringify({ type: "settle", propId: BENCH.id }));
  }

  function tick(now) {
    if (disposed) return;

    const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
    lastFrameAt = now;

    const direction = Number(self.movingRight) - Number(self.movingLeft);
    if (direction !== 0) {
      resetBenchSettle();
      self.pose = null;
      self.propId = null;
      updatePose(self.avatar, self.pose);
      self.x = clampSelfX(self.x + direction * MOVEMENT_SPEED * dt);
      renderAvatar(self.avatar, self.x);
      setFacing(self.avatar, direction < 0);
      setWalking(self.avatar, true);
      maybeSendMove();
    } else {
      setWalking(self.avatar, false);
      maybeRequestBenchSettle(now);
    }

    frameHandle = requestAnimationFrame(tick);
  }

  function maybeSendMove() {
    const now = Date.now();
    const movedEnough = Math.abs(self.x - self.lastSentX) > 0.002;
    const waitedLongEnough = now - self.lastSendAt > SEND_INTERVAL_MS;

    if (socket.readyState !== WebSocket.OPEN || !movedEnough || !waitedLongEnough) {
      return;
    }

    self.lastSentX = self.x;
    self.lastSendAt = now;
    socket.send(JSON.stringify({ type: "move", x: self.x }));
  }
}

function getBrowserId() {
  try {
    const existing = localStorage.getItem(BROWSER_ID_KEY);
    if (existing) {
      return existing;
    }

    const nextId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(BROWSER_ID_KEY, nextId);
    return nextId;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function normalizeOrigin(origin) {
  const normalized = new URL(origin, window.location.href);
  normalized.hash = "";
  normalized.search = "";
  normalized.pathname = normalized.pathname.replace(/\/$/, "");
  return normalized.toString().replace(/\/$/, "");
}

function buildSocketUrl(serverOrigin, socketPath) {
  const url = new URL(socketPath, `${serverOrigin}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
