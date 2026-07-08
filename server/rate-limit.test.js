"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeBucketStore } = require("./rate-limit");

test("take allows up to the limit then blocks", () => {
  const store = makeBucketStore();
  assert.equal(store.take("ip", 2), true);
  assert.equal(store.take("ip", 2), true);
  assert.equal(store.take("ip", 2), false, "third is over the limit");
  assert.equal(store.take("other", 2), true, "separate key has its own budget");
});

test("under checks without recording", () => {
  const store = makeBucketStore();
  store.record("ip", 5);
  store.record("ip", 5);
  assert.equal(store.under("ip", 5), true);
  assert.equal(store.under("ip", 2), false, "2 recorded, limit 2 -> not under");
  // under() must not consume budget
  assert.equal(store.under("ip", 5), true);
});

test("limit <= 0 disables the limiter", () => {
  const store = makeBucketStore();
  for (let i = 0; i < 100; i++) assert.equal(store.take("ip", 0), true);
  assert.equal(store.under("ip", 0), true);
});

test("hits outside the window expire on the injected clock", () => {
  let t = 0;
  const store = makeBucketStore({ windowMs: 1000, now: () => t });
  assert.equal(store.take("ip", 1), true);
  assert.equal(store.take("ip", 1), false, "still within window");
  t = 1001;
  assert.equal(store.take("ip", 1), true, "previous hit aged out");
});

test("clear drops a key's budget", () => {
  const store = makeBucketStore();
  store.take("ip", 1);
  assert.equal(store.under("ip", 1), false);
  store.clear("ip");
  assert.equal(store.under("ip", 1), true);
});

test("fully-stale keys are swept once past the prune threshold", () => {
  let t = 0;
  const store = makeBucketStore({ windowMs: 100, pruneThreshold: 3, now: () => t });
  store.take("a", 5);
  store.take("b", 5);
  store.take("c", 5);
  t = 1000; // everything is now stale
  // This call pushes size past the threshold and triggers the sweep of a/b/c.
  store.take("d", 5);
  assert.ok(store.size <= 4);
  assert.equal(store.under("a", 1), true, "stale key 'a' was swept (fresh budget)");
});
