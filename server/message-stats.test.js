"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMessageStats, RETENTION_DAYS } = require("./message-stats");

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed UTC midnight to make day bucketing deterministic.
const DAY0 = Date.UTC(2026, 0, 1);
const day = (n, hour = 12) => DAY0 + n * DAY_MS + hour * 60 * 60 * 1000;

test("counts messages per day, week, and month window", () => {
  const stats = createMessageStats();

  // Three messages today, unlike visitors every one counts.
  stats.recordMessage("site", day(29));
  stats.recordMessage("site", day(29, 13));
  stats.recordMessage("site", day(29, 14));

  // Earlier in the week and earlier in the month.
  stats.recordMessage("site", day(25)); // within 7 days of day 29
  stats.recordMessage("site", day(5)); // within 30 days but outside the week

  const now = day(29, 23);
  assert.deepEqual(stats.getStats("site", now), { daily: 3, weekly: 4, monthly: 5 });
});

test("ignores empty site keys", () => {
  const stats = createMessageStats();
  assert.equal(stats.recordMessage("", day(1)), false);
  assert.equal(stats.recordMessage(null, day(1)), false);
  assert.equal(stats.recordMessage("site", day(1)), true);

  assert.deepEqual(stats.getStats("site", day(1)), { daily: 1, weekly: 1, monthly: 1 });
});

test("keeps sites independent", () => {
  const stats = createMessageStats();
  stats.recordMessage("one", day(0));
  stats.recordMessage("two", day(0));
  stats.recordMessage("two", day(0));

  assert.equal(stats.getStats("one", day(0)).daily, 1);
  assert.equal(stats.getStats("two", day(0)).daily, 2);
  assert.deepEqual(stats.getStats("missing", day(0)), { daily: 0, weekly: 0, monthly: 0 });
});

test("prunes buckets older than the retention window", () => {
  const stats = createMessageStats();
  stats.recordMessage("site", day(0));
  // A message RETENTION_DAYS later should evict the day-0 bucket.
  stats.recordMessage("site", day(RETENTION_DAYS));

  assert.equal(stats.getStats("site", day(RETENTION_DAYS)).monthly, 1);
});

test("persists and reloads across instances", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-message-"));
  const filePath = path.join(dir, "message-stats.json");
  const now = () => day(10, 9);

  try {
    const first = createMessageStats({ filePath, now });
    first.recordMessage("site", day(10));
    first.recordMessage("site", day(10));
    first.flush();
    assert.equal(fs.existsSync(filePath), true);

    const second = createMessageStats({ filePath, now });
    second.load();
    assert.deepEqual(second.getStats("site", now()), { daily: 2, weekly: 2, monthly: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("drops stale buckets and bad counts when loading", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-message-"));
  const filePath = path.join(dir, "message-stats.json");

  try {
    const writer = createMessageStats({ filePath, now: () => day(0, 9) });
    writer.recordMessage("site", day(0));
    writer.flush();

    // Reload far in the future: the only bucket is now beyond retention.
    const reader = createMessageStats({ filePath, now: () => day(RETENTION_DAYS + 5, 9) });
    reader.load();
    assert.deepEqual(reader.getStats("site", day(RETENTION_DAYS + 5, 9)), {
      daily: 0,
      weekly: 0,
      monthly: 0,
    });

    // Corrupt counts are skipped rather than trusted.
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      sites: { site: { [Math.floor(day(3) / DAY_MS)]: "lots", [Math.floor(day(4) / DAY_MS)]: 2 } },
    }));
    const strict = createMessageStats({ filePath, now: () => day(4, 9) });
    strict.load();
    assert.deepEqual(strict.getStats("site", day(4, 9)), { daily: 2, weekly: 2, monthly: 2 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flush only writes when there are pending changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-message-"));
  const filePath = path.join(dir, "message-stats.json");

  try {
    const stats = createMessageStats({ filePath });
    stats.flush();
    assert.equal(fs.existsSync(filePath), false, "no write without changes");

    stats.flush(true);
    assert.equal(fs.existsSync(filePath), true, "force writes an empty snapshot");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("daily series returns per-day counts for one site", () => {
  const stats = createMessageStats();
  stats.recordMessage("site", day(3));
  stats.recordMessage("site", day(3));
  stats.recordMessage("site", day(5));

  const series = stats.getDailySeries("site", 3, day(5));
  assert.equal(series.length, 3);
  assert.deepEqual(series.map((entry) => entry.count), [2, 0, 1]);
  assert.equal(series[2].day, Math.floor(day(5) / DAY_MS));
});

test("aggregate daily series sums per-site daily counts", () => {
  const stats = createMessageStats();
  stats.recordMessage("one", day(5));
  stats.recordMessage("two", day(5));
  stats.recordMessage("two", day(5));

  const series = stats.getAggregateDailySeries(3, day(5));
  assert.equal(series.length, 3);
  assert.deepEqual(series.map((entry) => entry.count), [0, 0, 3]);
});
