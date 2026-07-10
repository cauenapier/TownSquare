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

test("stacked activity sums each site's normalized average", async () => {
  const { buildStackedVisitorActivityView } = await import("../public/admin/hosted/visitor-activity-view.mjs");
  const view = buildStackedVisitorActivityView([
    {
      siteKey: "one",
      name: "One",
      activity: { weekdays: [{ weekday: 0, sampleDays: 5, hours: [10] }] },
    },
    {
      siteKey: "two",
      name: "Two",
      activity: { weekdays: [{ weekday: 0, sampleDays: 4, hours: [4] }] },
    },
  ]);

  assert.equal(view.rows[0].hours[0].average, 3);
  assert.deepEqual(view.rows[0].hours[0].segments.map((segment) => segment.average), [2, 1]);
  assert.equal(view.rows[0].hours[0].percentage, 100);
});

test("stacked activity groups sites beyond the visible color limit", async () => {
  const { buildStackedVisitorActivityView } = await import("../public/admin/hosted/visitor-activity-view.mjs");
  const sites = Array.from({ length: 8 }, (_, index) => ({
    siteKey: `site-${index}`,
    name: `Site ${index}`,
    activity: { weekdays: [{ weekday: 0, sampleDays: 1, hours: [8 - index] }] },
  }));
  const view = buildStackedVisitorActivityView(sites);

  assert.equal(view.legend.length, 7);
  assert.equal(view.legend[6].label, "Other (2)");
  assert.equal(view.rows[0].hours[0].segments[6].average, 3);
});

test("activity site filtering supports one, many, all, and none", async () => {
  const { filterVisitorActivitySites } = await import("../public/admin/hosted/visitor-activity-view.mjs");
  const sites = ["one", "two", "three"].map((siteKey) => ({ siteKey }));

  assert.deepEqual(filterVisitorActivitySites(sites, ["two"]).map((site) => site.siteKey), ["two"]);
  assert.deepEqual(filterVisitorActivitySites(sites, ["one", "three"]).map((site) => site.siteKey), ["one", "three"]);
  assert.equal(filterVisitorActivitySites(sites, sites.map((site) => site.siteKey)).length, 3);
  assert.equal(filterVisitorActivitySites(sites, []).length, 0);
});
