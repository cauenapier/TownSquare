"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSitesWriter } = require("./sites-store");

function tmpStore(sites, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-store-"));
  const file = path.join(dir, "sites.json");
  const writer = createSitesWriter({ dataDir: dir, sitesFile: file, getSites: () => sites, ...opts });
  return { dir, file, writer };
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("saveNow writes the snapshot atomically (no leftover temp file)", () => {
  const sites = [{ siteKey: "a" }, { siteKey: "b" }];
  const { dir, file, writer } = tmpStore(sites);
  writer.saveNow();
  assert.deepEqual(read(file).sites, sites);
  assert.equal(fs.existsSync(`${file}.tmp`), false, "temp file renamed away");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scheduleSave debounces and flush forces the pending write", () => {
  let snapshot = [{ siteKey: "x", v: 1 }];
  const { dir, file, writer } = tmpStore(null, { getSites: () => snapshot, debounceMs: 50 });
  writer.scheduleSave();
  assert.equal(writer.pending, true);
  assert.equal(fs.existsSync(file), false, "not written synchronously");
  snapshot = [{ siteKey: "x", v: 2 }]; // flush serializes the latest snapshot
  writer.flush();
  assert.equal(writer.pending, false);
  assert.equal(read(file).sites[0].v, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("flush with nothing pending is a no-op", () => {
  const { dir, file, writer } = tmpStore([{ siteKey: "a" }]);
  writer.flush();
  assert.equal(fs.existsSync(file), false, "flush should not write when idle");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("saveNow supersedes a pending debounced write", () => {
  const { dir, file, writer } = tmpStore([{ siteKey: "a" }], { debounceMs: 1000 });
  writer.scheduleSave();
  assert.equal(writer.pending, true);
  writer.saveNow();
  assert.equal(writer.pending, false, "pending timer cleared by an explicit save");
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});
