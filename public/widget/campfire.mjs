/**
 * Campfire presentation derived from ordinary authoritative presence.
 * No membership or chat data is sent: exact propId matches decide who is by a
 * fire, so hidden visitors are never leaked and SAY remains public-square chat.
 */

/** @param {import("./context.mjs").WidgetContext} ctx */
export function syncCampfires(ctx) {
  const hasFire = ctx.sceneProps.some((prop) => prop.kind === "campfire");
  if (hasFire && !ctx.campfireChatNote) {
    const note = document.createElement("p");
    note.className = "townsquare-campfire__chat-note";
    note.hidden = true;
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    ctx.root.querySelector(".townsquare__toolbar")?.appendChild(note);
    ctx.campfireChatNote = note;
  } else if (!hasFire && ctx.campfireChatNote) {
    ctx.campfireChatNote.remove();
    ctx.campfireChatNote = undefined;
  }
  updateCampfires(ctx);
}

export function campfireStrength(presences, propId) {
  if (!propId) return 0;
  return Math.min(4, Array.from(presences || []).filter((presence) => presence?.propId === propId).length);
}

/** @param {import("./context.mjs").WidgetContext} ctx */
export function updateCampfires(ctx) {
  const fires = ctx.sceneProps.filter((prop) => prop.kind === "campfire");
  const presences = [ctx.self, ...ctx.peers.values()];
  const fireIds = new Set(fires.map((prop) => prop.id));
  const selfFireId = fireIds.has(ctx.self.propId) ? ctx.self.propId : null;

  for (const fire of fires) {
    const count = campfireStrength(presences, fire.id);
    const element = Array.from(ctx.stage.querySelectorAll(".prop--campfire"))
      .find((candidate) => candidate.dataset.propId === fire.id);
    element?.style.setProperty("--campfire-strength", String(count));
    if (element) element.dataset.occupancy = String(count);
  }

  ctx.root.classList.toggle("townsquare--campfire-chat", Boolean(selfFireId));
  for (const presence of presences) {
    presence.avatar?.el.classList.toggle(
      "townsquare-avatar--campfire-companion",
      Boolean(selfFireId) && presence.propId === selfFireId,
    );
  }

  const input = ctx.self.avatar?.input;
  if (input) {
    input.placeholder = selfFireId ? "By the fire · Say something…" : "Say something…";
    input.setAttribute(
      "aria-label",
      selfFireId ? "Say something by the fire in public square chat" : "Say something",
    );
  }

  const note = ctx.campfireChatNote;
  if (!note) return;
  note.hidden = !selfFireId;
  if (selfFireId) {
    const others = presences.filter((presence) => presence !== ctx.self && presence.propId === selfFireId).length;
    note.textContent = `By the fire${others ? ` with ${others} other${others === 1 ? "" : "s"}` : ""}. Everyone in this square can read these messages.`;
  }
}
