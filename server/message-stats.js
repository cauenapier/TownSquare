"use strict";

// Per-site message-volume aggregation: daily / weekly / monthly totals.
//
// Every accepted chat message increments a counter for its UTC day bucket
// (Math.floor(at / DAY_MS)). Rolling sums over those buckets give the totals:
//   - daily   = messages today
//   - weekly  = messages across the last 7 day buckets
//   - monthly = messages across the last 30 day buckets
//
// Buckets older than the retention window are pruned, so storage stays bounded
// by 30 numbers per site. Like visitor stats, this is analytics-only data in
// its own file, separate from the critical sites registry.

const fs = require("fs");
const { atomicWriteJson } = require("./atomic-write");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 1;
const WEEKLY_DAYS = 7;
const MONTHLY_DAYS = 30;
// Keep enough buckets to satisfy the widest window. Anything older is dropped.
const RETENTION_DAYS = MONTHLY_DAYS;
// Coalesce bursts of messages into at most one write per this interval.
const DEFAULT_SAVE_INTERVAL_MS = 60000;
const STORAGE_VERSION = 1;

function dayIndex(at) {
  return Math.floor(at / DAY_MS);
}

/**
 * Create a message-stats store.
 * @param {object} [options]
 * @param {string} [options.filePath] Where to persist the JSON snapshot.
 * @param {() => number} [options.now] Clock, injectable for tests.
 * @param {number} [options.saveIntervalMs] Periodic flush cadence.
 */
function createMessageStats(options = {}) {
  const filePath = options.filePath || null;
  const now = options.now || Date.now;
  const saveIntervalMs = options.saveIntervalMs ?? DEFAULT_SAVE_INTERVAL_MS;

  // siteKey -> (dayIndex -> count)
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

  /** Record one message sent at `at` on `siteKey`. */
  function recordMessage(siteKey, at = now()) {
    if (!siteKey) return false;

    const today = dayIndex(at);
    const days = siteDays(siteKey);
    days.set(today, (days.get(today) || 0) + 1);
    prune(days, today);
    dirty = true;
    return true;
  }

  /** Total messages across the last `windowDays` buckets ending today. */
  function sumOverWindow(days, today, windowDays) {
    let total = 0;
    for (let day = today - (windowDays - 1); day <= today; day += 1) {
      total += days.get(day) || 0;
    }
    return total;
  }

  /** Per-day message counts for the last `windowDays` UTC days ending at `at`. */
  function getDailySeries(siteKey, windowDays, at = now()) {
    const days = bySite.get(siteKey);
    const today = dayIndex(at);
    const series = [];
    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      series.push({ day, count: days ? days.get(day) || 0 : 0 });
    }
    return series;
  }

  /** Sum every site's daily message counts into one series. */
  function getAggregateDailySeries(windowDays, at = now()) {
    const today = dayIndex(at);
    const series = [];
    for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      let count = 0;
      for (const days of bySite.values()) {
        count += days.get(day) || 0;
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
      daily: sumOverWindow(days, today, DAILY_DAYS),
      weekly: sumOverWindow(days, today, WEEKLY_DAYS),
      monthly: sumOverWindow(days, today, MONTHLY_DAYS),
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
      for (const [day, count] of days) {
        dayObj[day] = count;
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
        console.warn(`Could not load message stats: ${error.message}`);
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
      for (const [dayKey, count] of Object.entries(dayObj)) {
        const day = Number(dayKey);
        if (!Number.isInteger(day) || day < oldest) continue;
        if (!Number.isFinite(count) || count <= 0) continue;
        days.set(day, Math.floor(count));
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

  return { recordMessage, getStats, getDailySeries, getAggregateDailySeries, load, flush, start, stop };
}

module.exports = { createMessageStats, RETENTION_DAYS };
