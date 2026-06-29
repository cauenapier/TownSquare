"use strict";

// Per-site unique-visitor aggregation: daily / weekly / monthly active users.
//
// Visitors are deduplicated by their stable `browserId`. We bucket each visit
// into a UTC day index (Math.floor(at / DAY_MS)) and keep one Set of browserIds
// per day. Rolling windows over those day buckets give the counts:
//   - daily   = unique browserIds today
//   - weekly  = unique browserIds across the last 7 day buckets
//   - monthly = unique browserIds across the last 30 day buckets
//
// Buckets older than the retention window are pruned, so storage stays bounded
// by (unique visitors/day x 30) per site. This data is analytics-only and lives
// in its own file, separate from the critical sites registry, so its frequent
// writes never touch sites.json.

const fs = require("fs");
const { atomicWriteJson } = require("./atomic-write");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 1;
const WEEKLY_DAYS = 7;
const MONTHLY_DAYS = 30;
// Keep enough buckets to satisfy the widest window. Anything older is dropped.
const RETENTION_DAYS = MONTHLY_DAYS;
// Coalesce bursts of joins into at most one write per this interval.
const DEFAULT_SAVE_INTERVAL_MS = 60000;
const STORAGE_VERSION = 1;

function dayIndex(at) {
  return Math.floor(at / DAY_MS);
}

/** A browserId we can dedupe on: a non-empty string that is not ephemeral. */
function isStableBrowserId(browserId) {
  return (
    typeof browserId === "string"
    && browserId.length > 0
    && !browserId.startsWith("connection-")
  );
}

/**
 * Create a visitor-stats store.
 * @param {object} [options]
 * @param {string} [options.filePath] Where to persist the JSON snapshot.
 * @param {() => number} [options.now] Clock, injectable for tests.
 * @param {number} [options.saveIntervalMs] Periodic flush cadence.
 */
function createVisitorStats(options = {}) {
  const filePath = options.filePath || null;
  const now = options.now || Date.now;
  const saveIntervalMs = options.saveIntervalMs ?? DEFAULT_SAVE_INTERVAL_MS;

  // siteKey -> (dayIndex -> Set<browserId>)
  const bySite = new Map();
  let dirty = false;
  let timer = null;

  function siteDays(siteKey) {
    let days = bySite.get(siteKey);
    if (!days) {
      days = new Map();
      bySite.set(siteKey, days);
    }
    return days;
  }

  /** Drop day buckets older than the retention window for one site. */
  function prune(days, today) {
    const oldest = today - (RETENTION_DAYS - 1);
    for (const day of days.keys()) {
      if (day < oldest) days.delete(day);
    }
  }

  /** Record that `browserId` was seen at `at` on `siteKey`. */
  function recordVisit(siteKey, browserId, at = now()) {
    if (!siteKey || !isStableBrowserId(browserId)) return false;

    const today = dayIndex(at);
    const days = siteDays(siteKey);
    let bucket = days.get(today);
    if (!bucket) {
      bucket = new Set();
      days.set(today, bucket);
    }
    if (bucket.has(browserId)) return false;

    bucket.add(browserId);
    prune(days, today);
    dirty = true;
    return true;
  }

  /** Unique browserIds across the last `windowDays` buckets ending today. */
  function uniqueOverWindow(days, today, windowDays) {
    const seen = new Set();
    for (let day = today - (windowDays - 1); day <= today; day += 1) {
      const bucket = days.get(day);
      if (bucket) for (const id of bucket) seen.add(id);
    }
    return seen.size;
  }

  function countForDay(days, day) {
    const bucket = days.get(day);
    return bucket ? bucket.size : 0;
  }

  /** Per-day unique visitor counts for the last `windowDays` UTC days ending at `at`. */
  function getDailySeries(siteKey, windowDays, at = now()) {
    const days = bySite.get(siteKey);
    const today = dayIndex(at);
    const series = [];
    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      series.push({ day, count: days ? countForDay(days, day) : 0 });
    }
    return series;
  }

  /** Sum each site's daily unique visitors (same person on two sites counts twice). */
  function getAggregateDailySeries(windowDays, at = now()) {
    const today = dayIndex(at);
    const series = [];
    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      let count = 0;
      for (const days of bySite.values()) {
        count += countForDay(days, day);
      }
      series.push({ day, count });
    }
    return series;
  }

  /** @returns {{daily:number, weekly:number, monthly:number}} */
  function getStats(siteKey, at = now()) {
    const days = bySite.get(siteKey);
    if (!days) return { daily: 0, weekly: 0, monthly: 0 };
    const today = dayIndex(at);
    return {
      daily: uniqueOverWindow(days, today, DAILY_DAYS),
      weekly: uniqueOverWindow(days, today, WEEKLY_DAYS),
      monthly: uniqueOverWindow(days, today, MONTHLY_DAYS),
    };
  }

  /** Build the serializable snapshot, pruning stale buckets as we go. */
  function snapshot(at = now()) {
    const today = dayIndex(at);
    const sites = {};
    for (const [siteKey, days] of bySite) {
      prune(days, today);
      if (days.size === 0) {
        bySite.delete(siteKey);
        continue;
      }
      const dayObj = {};
      for (const [day, bucket] of days) {
        dayObj[day] = Array.from(bucket);
      }
      sites[siteKey] = dayObj;
    }
    return { version: STORAGE_VERSION, sites };
  }

  function load() {
    if (!filePath) return;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Could not load visitor stats: ${error.message}`);
      }
      return;
    }

    const sites = raw && typeof raw === "object" ? raw.sites : null;
    if (!sites || typeof sites !== "object") return;

    const today = dayIndex(now());
    const oldest = today - (RETENTION_DAYS - 1);
    bySite.clear();
    for (const [siteKey, dayObj] of Object.entries(sites)) {
      if (!dayObj || typeof dayObj !== "object") continue;
      const days = new Map();
      for (const [dayKey, ids] of Object.entries(dayObj)) {
        const day = Number(dayKey);
        if (!Number.isInteger(day) || day < oldest || !Array.isArray(ids)) continue;
        days.set(day, new Set(ids.filter(isStableBrowserId)));
      }
      if (days.size > 0) bySite.set(siteKey, days);
    }
  }

  /** Write the snapshot now if there are unsaved changes (or `force`). */
  function flush(force = false) {
    if (!filePath || (!dirty && !force)) return;
    atomicWriteJson(filePath, snapshot());
    dirty = false;
  }

  /** Begin periodic flushing of pending changes. */
  function start() {
    if (timer || !filePath) return;
    timer = setInterval(() => flush(), saveIntervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { recordVisit, getStats, getDailySeries, getAggregateDailySeries, load, flush, start, stop };
}

module.exports = { createVisitorStats, isStableBrowserId, RETENTION_DAYS };
