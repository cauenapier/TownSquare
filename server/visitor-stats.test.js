"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createVisitorStats, isStableBrowserId, RETENTION_DAYS } = require("./visitor-stats");

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed UTC midnight to make day bucketing deterministic.
const DAY0 = Date.UTC(2026, 0, 1);
const day = (n, hour = 12) => DAY0 + n * DAY_MS + hour * 60 * 60 * 1000;

test("counts unique visitors per day, week, and month window", () => {
  const stats = createVisitorStats();

  // Two distinct browsers today, one of them seen twice.
  stats.recordVisit("site", "a", day(29));
  stats.recordVisit("site", "a", day(29, 13));
  stats.recordVisit("site", "b", day(29));

  // Earlier in the week and earlier in the month.
  stats.recordVisit("site", "c", day(25)); // within 7 days of day 29
  stats.recordVisit("site", "d", day(5)); // within 30 days but outside the week

  const now = day(29, 23);
  assert.deepEqual(stats.getStats("site", now), { daily: 2, weekly: 3, monthly: 4 });
});

test("ignores ephemeral and invalid browser ids", () => {
  const stats = createVisitorStats();
  assert.equal(stats.recordVisit("site", "connection-7", day(1)), false);
  assert.equal(stats.recordVisit("site", "", day(1)), false);
  assert.equal(stats.recordVisit("site", null, day(1)), false);
  assert.equal(stats.recordVisit("", "real", day(1)), false);
  assert.equal(stats.recordVisit("site", "real", day(1)), true);

  assert.equal(isStableBrowserId("connection-1"), false);
  assert.equal(isStableBrowserId("abc"), true);

  assert.deepEqual(stats.getStats("site", day(1)), { daily: 1, weekly: 1, monthly: 1 });
});

test("keeps sites independent", () => {
  const stats = createVisitorStats();
  stats.recordVisit("one", "a", day(0));
  stats.recordVisit("two", "b", day(0));
  stats.recordVisit("two", "c", day(0));

  assert.equal(stats.getStats("one", day(0)).daily, 1);
  assert.equal(stats.getStats("two", day(0)).daily, 2);
  assert.deepEqual(stats.getStats("missing", day(0)), { daily: 0, weekly: 0, monthly: 0 });
});

test("prunes buckets older than the retention window", () => {
  const stats = createVisitorStats();
  stats.recordVisit("site", "old", day(0));
  // A visit RETENTION_DAYS later should evict the day-0 bucket.
  stats.recordVisit("site", "new", day(RETENTION_DAYS));

  assert.equal(stats.getStats("site", day(RETENTION_DAYS)).monthly, 1);
});

test("persists and reloads across instances", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-visitor-"));
  const filePath = path.join(dir, "visitor-stats.json");
  const now = () => day(10, 9);

  try {
    const first = createVisitorStats({ filePath, now });
    first.recordVisit("site", "a", day(10));
    first.recordVisit("site", "b", day(10));
    first.flush();
    assert.equal(fs.existsSync(filePath), true);

    const second = createVisitorStats({ filePath, now });
    second.load();
    assert.deepEqual(second.getStats("site", now()), { daily: 2, weekly: 2, monthly: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("drops stale buckets when loading", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-visitor-"));
  const filePath = path.join(dir, "visitor-stats.json");

  try {
    const writer = createVisitorStats({ filePath, now: () => day(0, 9) });
    writer.recordVisit("site", "old", day(0));
    writer.flush();

    // Reload far in the future: the only bucket is now beyond retention.
    const reader = createVisitorStats({ filePath, now: () => day(RETENTION_DAYS + 5, 9) });
    reader.load();
    assert.deepEqual(reader.getStats("site", day(RETENTION_DAYS + 5, 9)), {
      daily: 0,
      weekly: 0,
      monthly: 0,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flush only writes when there are pending changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-visitor-"));
  const filePath = path.join(dir, "visitor-stats.json");

  try {
    const stats = createVisitorStats({ filePath });
    stats.flush();
    assert.equal(fs.existsSync(filePath), false, "no write without changes");

    stats.flush(true);
    assert.equal(fs.existsSync(filePath), true, "force writes an empty snapshot");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("daily series returns per-day counts for one site", () => {
  const stats = createVisitorStats();
  stats.recordVisit("site", "a", day(3));
  stats.recordVisit("site", "b", day(3));
  stats.recordVisit("site", "c", day(5));

  const series = stats.getDailySeries("site", 3, day(5));
  assert.equal(series.length, 3);
  assert.deepEqual(series.map((entry) => entry.count), [2, 0, 1]);
  assert.equal(series[2].day, Math.floor(day(5) / DAY_MS));
});

test("aggregate daily series sums per-site daily uniques", () => {
  const stats = createVisitorStats();
  stats.recordVisit("one", "a", day(5));
  stats.recordVisit("two", "b", day(5));
  stats.recordVisit("two", "c", day(5));

  const series = stats.getAggregateDailySeries(3, day(5));
  assert.equal(series.length, 3);
  assert.deepEqual(series.map((entry) => entry.count), [0, 0, 3]);
});

test("active-site series counts each site in the trailing window for every day", () => {
  const stats = createVisitorStats();
  stats.recordVisit("early", "a", day(2));
  stats.recordVisit("recent", "b", day(4));
  stats.recordVisit("recent", "c", day(5));

  const series = stats.getActiveSiteSeries(4, 3, day(5));
  assert.deepEqual(series.map((entry) => entry.count), [1, 1, 2, 1]);
});

test("tracks each visitor once per UTC hour and aggregates by weekday", () => {
  const stats = createVisitorStats();

  // DAY0 is Thursday, so day 3 is Sunday and day 4 is Monday.
  assert.equal(stats.recordActivity("site", "a", day(3, 9)), true);
  assert.equal(stats.recordActivity("site", "a", day(3, 9)), false);
  assert.equal(stats.recordActivity("site", "a", day(3, 10)), true);
  stats.recordActivity("site", "b", day(3, 9));
  stats.recordActivity("site", "c", day(4, 9));

  const activity = stats.getActivityByWeekdayAndHour("site", 2, day(4, 23));
  assert.equal(activity.timeZone, "UTC");
  assert.equal(activity.windowDays, 2);
  assert.deepEqual(activity.weekdays.map((entry) => entry.sampleDays), [1, 1, 0, 0, 0, 0, 0]);
  assert.equal(activity.weekdays[0].hours[9], 2, "Sunday 09:00");
  assert.equal(activity.weekdays[0].hours[10], 1, "Sunday 10:00");
  assert.equal(activity.weekdays[1].hours[9], 1, "Monday 09:00");
});

test("bounds activity windows and excludes days before hourly tracking began", () => {
  const stats = createVisitorStats();
  const activity = stats.getActivityByWeekdayAndHour("missing", RETENTION_DAYS + 10, day(29));

  assert.equal(activity.windowDays, RETENTION_DAYS);
  assert.equal(activity.weekdays.reduce((sum, entry) => sum + entry.sampleDays, 0), 0);
  assert.equal(activity.weekdays.flatMap((entry) => entry.hours).every((count) => count === 0), true);

  stats.recordActivity("site", "visitor", day(27, 9));
  const tracked = stats.getActivityByWeekdayAndHour("site", RETENTION_DAYS, day(29));
  assert.equal(tracked.weekdays.reduce((sum, entry) => sum + entry.sampleDays, 0), 3);
});

test("persists hourly activity and migrates older visitor snapshots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-visitor-"));
  const filePath = path.join(dir, "visitor-stats.json");
  const now = () => day(10, 23);

  try {
    const first = createVisitorStats({ filePath, now });
    first.recordActivity("site", "active", day(10, 8));
    first.recordActivity("site", "active", day(10, 17));
    first.flush();

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(persisted.version, 3);

    const second = createVisitorStats({ filePath, now });
    second.load();
    const weekday = second.getActivityByWeekdayAndHour("site", 1, now()).weekdays[0];
    assert.equal(weekday.hours[8], 1);
    assert.equal(weekday.hours[17], 1);

    const dayNumber = Math.floor(day(10) / DAY_MS);
    fs.writeFileSync(filePath, JSON.stringify({
      version: 2,
      sites: { hourly: { [dayNumber]: [["visitor", 2 ** 8]] } },
    }));
    const versionTwo = createVisitorStats({ filePath, now });
    versionTwo.load();
    const migrated = versionTwo.getActivityByWeekdayAndHour("hourly", 1, now()).weekdays[0];
    assert.equal(migrated.sampleDays, 1);
    assert.equal(migrated.hours[8], 1);

    fs.writeFileSync(filePath, JSON.stringify({ version: 1, sites: { legacy: { [dayNumber]: ["visitor"] } } }));
    const legacy = createVisitorStats({ filePath, now });
    legacy.load();
    assert.equal(legacy.getStats("legacy", now()).daily, 1);
    assert.equal(
      legacy.getActivityByWeekdayAndHour("legacy", 1, now()).weekdays
        .flatMap((entry) => entry.hours)
        .every((count) => count === 0),
      true,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
