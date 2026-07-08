"use strict";

// Per-key sliding-window rate limiting extracted from server.js (registration,
// admin/service-admin auth-failure, and Plausible-event budgets). A store keeps,
// per key, the timestamps of hits inside a rolling window; stale keys are swept
// once the map grows past a threshold. Clock-injectable for unit testing.

const HOUR_MS = 60 * 60 * 1000;
const PRUNE_THRESHOLD = 1000;

function makeBucketStore({ windowMs = HOUR_MS, pruneThreshold = PRUNE_THRESHOLD, now = () => Date.now() } = {}) {
  const buckets = new Map(); // key -> number[] (hit timestamps within the window)

  // Return (and re-store) the key's timestamps that are still inside the window.
  // Sweeps fully-stale keys when the map is large to bound memory.
  function recent(key) {
    const cutoff = now() - windowMs;
    if (buckets.size > pruneThreshold) {
      for (const [bucketKey, timestamps] of buckets) {
        if (timestamps.every((at) => at <= cutoff)) buckets.delete(bucketKey);
      }
    }
    const kept = (buckets.get(key) || []).filter((at) => at > cutoff);
    buckets.set(key, kept);
    return kept;
  }

  return {
    // Is the key still under `limit`, without recording a hit? (limit<=0 = off)
    under(key, limit) {
      if (limit <= 0) return true;
      return recent(key).length < limit;
    },
    // Record a hit (no-op when disabled).
    record(key, limit) {
      if (limit <= 0) return;
      recent(key).push(now());
    },
    // Atomically: if under `limit`, record a hit and return true; else false.
    take(key, limit) {
      if (limit <= 0) return true;
      const kept = recent(key);
      if (kept.length >= limit) return false;
      kept.push(now());
      return true;
    },
    clear(key) {
      buckets.delete(key);
    },
    get size() {
      return buckets.size;
    },
  };
}

module.exports = { makeBucketStore };
