"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createReactionStore } = require("./reactions");

test("tallies reactions per site and page", () => {
  const store = createReactionStore();
  store.adjust("site", "/a", "heart", 1);
  store.adjust("site", "/a", "heart", 1);
  store.adjust("site", "/a", "clap", 1);
  store.adjust("site", "/b", "heart", 1);
  store.adjust("other", "/a", "fire", 1);

  assert.deepEqual(store.getCounts("site", "/a"), { heart: 2, clap: 1 });
  assert.deepEqual(store.getCounts("site", "/b"), { heart: 1 });
  assert.deepEqual(store.getCounts("other", "/a"), { fire: 1 });
  assert.deepEqual(store.getCounts("missing", "/a"), {});
});

test("removals never go below zero and drop empty pages", () => {
  const store = createReactionStore({ maxPagesPerSite: 1 });
  assert.deepEqual(store.adjust("site", "/a", "heart", -1), {});
  assert.deepEqual(store.adjust("site", "/a", "heart", 1), { heart: 1 });
  assert.deepEqual(store.adjust("site", "/a", "heart", -1), {});
  assert.deepEqual(store.adjust("site", "/a", "heart", -1), {});
  // The emptied page no longer counts toward the cap.
  assert.deepEqual(store.adjust("site", "/b", "heart", 1), { heart: 1 });
});

test("caps distinct pages per site", () => {
  const store = createReactionStore({ maxPagesPerSite: 2 });
  store.adjust("site", "/a", "heart", 1);
  store.adjust("site", "/b", "heart", 1);
  assert.equal(store.adjust("site", "/c", "heart", 1), null);
  // Existing pages and other sites are unaffected.
  assert.deepEqual(store.adjust("site", "/a", "clap", 1), { heart: 1, clap: 1 });
  assert.deepEqual(store.adjust("other", "/c", "heart", 1), { heart: 1 });
});

test("persists, reloads, and forgets deleted sites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-reactions-"));
  const filePath = path.join(dir, "reactions.json");
  try {
    const store = createReactionStore({ filePath });
    store.adjust("site", "/a", "heart", 1);
    store.adjust("gone", "/a", "heart", 1);
    store.flush();

    const reloaded = createReactionStore({ filePath });
    reloaded.load();
    assert.deepEqual(reloaded.getCounts("site", "/a"), { heart: 1 });

    reloaded.removeSite("gone");
    reloaded.flush();
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.deepEqual(saved, { version: 1, sites: { site: { "/a": { heart: 1 } } } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
