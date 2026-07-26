"use strict";

// Per-site unique-visitor and hourly activity aggregation.
//
// Visitors are deduplicated by their stable `browserId`. We bucket each visit
// into a UTC day index (Math.floor(at / DAY_MS)) and keep one 24-bit activity
// mask per browserId per day. Rolling windows over those day buckets give the
// counts:
//   - daily   = unique browserIds today
//   - weekly  = unique browserIds across the last 7 day buckets
//   - monthly = unique browserIds across the last 30 day buckets
//
// The activity masks also retain which UTC hours each visitor was present. They
// can be folded into a weekday/hour grid without storing individual events or
// timestamps. A visitor counts at most once in each hour, regardless of how
// many tabs, reconnects, heartbeats, or interactions they produce.
//
// Buckets older than the retention window are pruned, so storage stays bounded
// by (unique visitors/day x 59) per site. This data is analytics-only and lives
// in its own file, separate from the critical sites registry, so its frequent
// writes never touch sites.json.

const fs = require("fs");
const { atomicWriteJson } = require("./atomic-write");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 1;
const WEEKLY_DAYS = 7;
const MONTHLY_DAYS = 30;
// A 30-point series of trailing 30-day windows needs today and the prior 58 days.
const RETENTION_DAYS = MONTHLY_DAYS * 2 - 1;
// Coalesce bursts of joins into at most one write per this interval.
const DEFAULT_SAVE_INTERVAL_MS = 60000;
const STORAGE_VERSION = 3;
const HOURS_PER_DAY = 24;

function dayIndex(at) {
  return Math.floor(at / DAY_MS);
}

function hourBit(at) {
  return 2 ** (Math.floor(at / HOUR_MS) % HOURS_PER_DAY);
}

function weekdayIndex(day) {
  // Unix day zero was a Thursday. Return the conventional 0=Sunday..6=Saturday.
  return (day + 4) % 7;
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

  // siteKey -> (dayIndex -> Map<browserId, 24-bit UTC-hour activity mask>)
  const bySite = new Map();
  // siteKey -> first UTC day with hourly observations. Days before this must
  // not dilute averages when upgrading from daily-only version-1 data.
  const activityStartedDays = new Map();
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

  /** Record a visitor-hour, returning false when it was already recorded. */
  function recordActivity(siteKey, browserId, at = now()) {
    if (!siteKey || !isStableBrowserId(browserId)) return false;

    const today = dayIndex(at);
    const activityStartedDay = activityStartedDays.get(siteKey);
    if (activityStartedDay === undefined || today < activityStartedDay) {
      activityStartedDays.set(siteKey, today);
    }
    const days = siteDays(siteKey);
    let bucket = days.get(today);
    if (!bucket) {
      bucket = new Map();
      days.set(today, bucket);
    }
    const bit = hourBit(at);
    const hours = bucket.get(browserId) || 0;
    if (hours & bit) return false;

    bucket.set(browserId, hours | bit);
    prune(days, today);
    dirty = true;
    return true;
  }

  /** A join is both a unique visit and activity in its arrival hour. */
  const recordVisit = recordActivity;

  /** Unique browserIds across the last `windowDays` buckets ending today. */
  function uniqueOverWindow(days, today, windowDays) {
    const seen = new Set();
    for (let day = today - (windowDays - 1); day <= today; day += 1) {
      const bucket = days.get(day);
      if (bucket) for (const id of bucket.keys()) seen.add(id);
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

  /** Count sites with any visitors in each trailing window ending on the displayed day. */
  function getActiveSiteSeries(seriesDays, windowDays, at = now()) {
    const today = dayIndex(at);
    const series = [];
    for (let offset = seriesDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      let count = 0;
      for (const days of bySite.values()) {
        if (uniqueOverWindow(days, day, windowDays) > 0) count += 1;
      }
      series.push({ day, count });
    }
    return series;
  }

  /**
   * Aggregate visitor-hours into a UTC weekday/hour grid.
   *
   * `sampleDays` lets consumers compare weekdays fairly when the rolling
   * window contains five occurrences of some weekdays and four of others.
   * Historical version-1 visitor data remains in daily totals but has no hour
   * information, so it is intentionally absent from this grid.
   */
  function getActivityByWeekdayAndHour(siteKey, windowDays = MONTHLY_DAYS, at = now()) {
    const days = bySite.get(siteKey);
    const today = dayIndex(at);
    const activityStartedDay = activityStartedDays.get(siteKey);
    const boundedWindowDays = Math.min(
      RETENTION_DAYS,
      Math.max(1, Number.isInteger(windowDays) ? windowDays : RETENTION_DAYS),
    );
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      sampleDays: 0,
      hours: Array(HOURS_PER_DAY).fill(0),
    }));

    for (let offset = boundedWindowDays - 1; offset >= 0; offset -= 1) {
      const day = today - offset;
      if (activityStartedDay === undefined || day < activityStartedDay) continue;
      const weekday = weekdays[weekdayIndex(day)];
      weekday.sampleDays += 1;
      const bucket = days?.get(day);
      if (!bucket) continue;

      for (const mask of bucket.values()) {
        for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
          if (mask & (2 ** hour)) weekday.hours[hour] += 1;
        }
      }
    }

    return { timeZone: "UTC", windowDays: boundedWindowDays, weekdays };
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
    const startedDays = {};
    for (const [siteKey, days] of bySite) {
      prune(days, today);
      if (days.size === 0) {
        bySite.delete(siteKey);
        activityStartedDays.delete(siteKey);
        continue;
      }
      const dayObj = {};
      for (const [day, bucket] of days) {
        dayObj[day] = Array.from(bucket);
      }
      sites[siteKey] = dayObj;
      const activityStartedDay = activityStartedDays.get(siteKey);
      if (Number.isInteger(activityStartedDay)) startedDays[siteKey] = activityStartedDay;
    }
    return { version: STORAGE_VERSION, sites, activityStartedDays: startedDays };
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
    activityStartedDays.clear();
    for (const [siteKey, dayObj] of Object.entries(sites)) {
      if (!dayObj || typeof dayObj !== "object") continue;
      const days = new Map();
      for (const [dayKey, entries] of Object.entries(dayObj)) {
        const day = Number(dayKey);
        if (!Number.isInteger(day) || day < oldest || !Array.isArray(entries)) continue;
        const bucket = new Map();
        for (const entry of entries) {
          // Version 1 stored a flat browserId array. Preserve those IDs for the
          // daily/weekly/monthly totals; their unknown hours use an empty mask.
          const [browserId, mask] = Array.isArray(entry) ? entry : [entry, 0];
          if (!isStableBrowserId(browserId)) continue;
          const safeMask = Number.isInteger(mask) && mask >= 0 && mask < 2 ** HOURS_PER_DAY ? mask : 0;
          bucket.set(browserId, safeMask);
        }
        if (bucket.size > 0) days.set(day, bucket);
      }
      if (days.size === 0) continue;
      bySite.set(siteKey, days);

      const savedStart = Number(raw.activityStartedDays?.[siteKey]);
      if (Number.isInteger(savedStart)) {
        activityStartedDays.set(siteKey, savedStart);
        continue;
      }
      // Version 2 had hourly masks but no explicit observation start. Infer the
      // earliest known hourly day; version-1 zero masks remain daily-only.
      const inferredStart = Array.from(days)
        .filter(([, bucket]) => Array.from(bucket.values()).some((mask) => mask > 0))
        .reduce((earliest, [day]) => Math.min(earliest, day), Infinity);
      if (Number.isFinite(inferredStart)) activityStartedDays.set(siteKey, inferredStart);
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

  return {
    recordVisit,
    recordActivity,
    getStats,
    getDailySeries,
    getAggregateDailySeries,
    getActiveSiteSeries,
    getActivityByWeekdayAndHour,
    load,
    flush,
    start,
    stop,
  };
}

module.exports = { createVisitorStats, isStableBrowserId, RETENTION_DAYS };
