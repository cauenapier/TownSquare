"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAdminSessionStore, parseCookies, COOKIE_NAME } = require("./admin-sessions");

test("parseCookies splits a header into a decoded map", () => {
  assert.deepEqual(parseCookies("ts_admin=abc; other=1"), { ts_admin: "abc", other: "1" });
  assert.deepEqual(parseCookies("a=%20b%20"), { a: " b " });
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies("novalue; x=y"), { x: "y" });
});

test("create/get round-trips a valid session", () => {
  const store = createAdminSessionStore();
  const { id } = store.create("site-1");
  assert.equal(store.get(id).siteKey, "site-1");
  assert.equal(store.size, 1);
});

test("get returns null for unknown or malformed ids", () => {
  const store = createAdminSessionStore();
  assert.equal(store.get("nope"), null);
  assert.equal(store.get(""), null);
  assert.equal(store.get(123), null);
});

test("remember-me uses the longer TTL", () => {
  const store = createAdminSessionStore({ ttlMs: 1000, rememberTtlMs: 99000 });
  assert.equal(store.create("s", { remember: false }).maxAgeMs, 1000);
  assert.equal(store.create("s", { remember: true }).maxAgeMs, 99000);
});

test("sessions expire on the injected clock and are dropped on access", () => {
  let t = 0;
  const store = createAdminSessionStore({ ttlMs: 100, now: () => t });
  const { id } = store.create("s");
  t = 99;
  assert.ok(store.get(id), "valid just before expiry");
  t = 100;
  assert.equal(store.get(id), null, "expired at TTL boundary");
  assert.equal(store.size, 0, "expired session pruned on access");
});

test("destroy and destroyForSite remove sessions", () => {
  const store = createAdminSessionStore();
  const a = store.create("site-a").id;
  store.create("site-a");
  const c = store.create("site-c").id;
  assert.equal(store.destroy(a), true);
  assert.equal(store.get(a), null);
  store.destroyForSite("site-a");
  assert.equal(store.size, 1, "only site-c remains");
  assert.ok(store.get(c));
});

test("capacity is bounded — oldest sessions are evicted", () => {
  let n = 0;
  const store = createAdminSessionStore({ maxSessions: 3, generateId: () => `id-${n++}` });
  const first = store.create("s").id;
  store.create("s");
  store.create("s");
  store.create("s"); // 4th insert: prune() evicts the oldest to stay under cap
  assert.ok(store.size <= 3);
  assert.equal(store.get(first), null, "oldest evicted past capacity");
});

test("cookie name is exported and stable", () => {
  assert.equal(COOKIE_NAME, "ts_admin");
  assert.equal(createAdminSessionStore().cookieName, "ts_admin");
});
