"use strict";

// Per-page reaction tallies for the embeddable reactions bar.
//
// Shape: siteKey -> page -> reaction -> count. Only aggregate counts are kept
// (no per-visitor records); "has this visitor reacted" lives in the visitor's
// browser. Like the other stats stores this is its own file, flushed on an
// interval, so a burst of clicks costs at most one write per interval.
//
// Pages are caller-chosen strings, so each site is capped at `maxPagesPerSite`
// distinct pages to keep a hostile client from growing the file without bound.

const fs = require("fs");
const { atomicWriteJson } = require("./atomic-write");

const DEFAULT_SAVE_INTERVAL_MS = 60000;
const DEFAULT_MAX_PAGES_PER_SITE = 5000;
const STORAGE_VERSION = 1;

/**
 * @param {object} [options]
 * @param {string} [options.filePath] Where to persist the JSON snapshot.
 * @param {number} [options.saveIntervalMs] Periodic flush cadence.
 * @param {number} [options.maxPagesPerSite] Distinct pages one site may hold.
 */
function createReactionStore(options = {}) {
  const filePath = options.filePath || null;
  const saveIntervalMs = options.saveIntervalMs ?? DEFAULT_SAVE_INTERVAL_MS;
  const maxPagesPerSite = options.maxPagesPerSite ?? DEFAULT_MAX_PAGES_PER_SITE;

  /** @type {Map<string, Map<string, Record<string, number>>>} */
  const bySite = new Map();
  let dirty = false;
  let timer = null;

  /** Counts for one page; `{}` when nothing has been recorded. */
  function getCounts(siteKey, page) {
    return { ...(bySite.get(siteKey)?.get(page) || {}) };
  }

  /**
   * Add `delta` (+1 / -1) to one reaction. Counts never go below zero and empty
   * pages are dropped. Returns the page's new counts, or null when the site is
   * already at its page cap and this would create a new page.
   */
  function adjust(siteKey, page, reaction, delta) {
    let pages = bySite.get(siteKey);
    let counts = pages?.get(page);
    if (!counts) {
      if (delta <= 0) return {};
      if (pages && pages.size >= maxPagesPerSite) return null;
      if (!pages) bySite.set(siteKey, (pages = new Map()));
      pages.set(page, (counts = {}));
    }

    const next = Math.max(0, (counts[reaction] || 0) + delta);
    if (next > 0) counts[reaction] = next;
    else delete counts[reaction];

    if (Object.keys(counts).length === 0) pages.delete(page);
    if (pages.size === 0) bySite.delete(siteKey);
    dirty = true;
    return { ...counts };
  }

  /** Forget everything recorded for a deleted site. */
  function removeSite(siteKey) {
    if (bySite.delete(siteKey)) dirty = true;
  }

  function snapshot() {
    const sites = {};
    for (const [siteKey, pages] of bySite) sites[siteKey] = Object.fromEntries(pages);
    return { version: STORAGE_VERSION, sites };
  }

  function load() {
    if (!filePath) return;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not load reactions: ${error.message}`);
      return;
    }

    bySite.clear();
    const sites = raw && typeof raw.sites === "object" ? raw.sites : {};
    for (const [siteKey, pageObj] of Object.entries(sites || {})) {
      if (!pageObj || typeof pageObj !== "object") continue;
      const pages = new Map();
      for (const [page, countObj] of Object.entries(pageObj)) {
        if (!countObj || typeof countObj !== "object") continue;
        const counts = {};
        for (const [reaction, count] of Object.entries(countObj)) {
          if (Number.isFinite(count) && count > 0) counts[reaction] = Math.floor(count);
        }
        if (Object.keys(counts).length > 0) pages.set(page, counts);
      }
      if (pages.size > 0) bySite.set(siteKey, pages);
    }
  }

  /** Write the snapshot now if there are unsaved changes. */
  function flush() {
    if (!filePath || !dirty) return;
    atomicWriteJson(filePath, snapshot());
    dirty = false;
  }

  function start() {
    if (timer || !filePath) return;
    timer = setInterval(flush, saveIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { getCounts, adjust, removeSite, load, flush, start, stop };
}

module.exports = { createReactionStore };
