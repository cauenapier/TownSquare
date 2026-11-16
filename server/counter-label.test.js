"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../public/townsquare-counter.mjs");

test("full labels for site, page, and both", async () => {
  const { counterLabel } = await load();
  const counts = { site: 5, page: 2 };
  assert.equal(counterLabel(counts), "5 people here");
  assert.equal(counterLabel(counts, { count: "page" }), "2 people on this page");
  assert.equal(counterLabel(counts, { count: "both" }), "5 people here · 2 on this page");
  assert.equal(counterLabel({ site: 1, page: 1 }, { count: "page" }), "1 person on this page");
});

test("short labels", async () => {
  const { counterLabel } = await load();
  const counts = { site: 5, page: 2 };
  assert.equal(counterLabel(counts, { labelStyle: "short" }), "5 here");
  assert.equal(counterLabel(counts, { count: "page", labelStyle: "short" }), "2 here");
  assert.equal(counterLabel(counts, { count: "both", labelStyle: "short" }), "5 here · 2 on page");
});

test("empty states", async () => {
  const { counterLabel } = await load();
  const none = { site: 0, page: 0 };
  assert.equal(counterLabel(none), "No one here yet");
  assert.equal(counterLabel(none, { count: "both" }), "No one here yet");
  assert.equal(counterLabel({ site: 3, page: 0 }, { count: "page" }), "No one on this page yet");
  assert.equal(counterLabel(none, { labelStyle: "short" }), "0 here");
});
