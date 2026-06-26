"use strict";

// Durable persistence for the sites registry, extracted from server.js. Owns the
// atomic full-registry write and the debounce that coalesces high-frequency
// metadata writes (profile edits, owner toggles, lastSeen) so a busy site does
// not block the event loop on each mutation. The in-memory registry stays in
// server.js; `getSites` reads the current snapshot at write time.

const fs = require("fs");

function createSitesWriter({ dataDir, sitesFile, getSites, debounceMs = 1000, logger = console }) {
  let timer = null;

  // Atomic write: serialize to a temp file in the same directory, then rename
  // over sitesFile. rename(2) is atomic on the same filesystem, so a crash or
  // disk-full mid-write leaves the previous valid sites.json intact (it holds
  // every site's adminTokenHash, and there is no admin-link recovery).
  function saveNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const sites = getSites();
    const tmpFile = `${sitesFile}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify({ sites }, null, 2)}\n`);
    fs.renameSync(tmpFile, sitesFile);
  }

  // Schedule a debounced full-registry write. Used for hot-path mutations where
  // losing up to debounceMs of freshness on a crash is acceptable.
  function scheduleSave() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        saveNow();
      } catch (error) {
        logger.error("Error saving sites", error);
      }
    }, debounceMs);
    timer.unref?.();
  }

  // Flush any pending debounced write immediately (e.g. on graceful shutdown).
  function flush() {
    if (timer) saveNow();
  }

  return { saveNow, scheduleSave, flush, get pending() { return timer !== null; } };
}

module.exports = { createSitesWriter };
