"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("visitor activity view averages weekdays before calculating percentages", async () => {
  const { buildVisitorActivityView } = await import("../public/admin/hosted/visitor-activity-view.mjs");
  const view = buildVisitorActivityView({
    timeZone: "UTC",
    windowDays: 30,
    weekdays: [
      { weekday: 0, sampleDays: 5, hours: [10] },
      { weekday: 1, sampleDays: 4, hours: [4] },
    ],
  });

  assert.equal(view.rows[0].hours[0].average, 2);
  assert.equal(view.rows[0].hours[0].percentage, 100);
  assert.equal(view.rows[1].hours[0].average, 1);
  assert.equal(view.rows[1].hours[0].percentage, 50);
  assert.equal(view.rows[2].hours.length, 24);
});

test("visitor activity view safely handles an empty dataset", async () => {
  const { buildVisitorActivityView } = await import("../public/admin/hosted/visitor-activity-view.mjs");
  const view = buildVisitorActivityView(null);

  assert.equal(view.peakAverage, 0);
  assert.equal(view.rows.length, 7);
  assert.equal(view.rows.flatMap((row) => row.hours).every((slot) => slot.percentage === 0), true);
});
