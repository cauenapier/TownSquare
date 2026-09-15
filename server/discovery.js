"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Favor lively and recently seen towns while keeping every eligible town in
 * the draw. `random` is injectable so the selection policy stays testable.
 */
function selectRandomTown(sites, {
  excludeSiteKey = "",
  now = Date.now(),
  random = Math.random,
} = {}) {
  const candidates = (Array.isArray(sites) ? sites : [])
    .filter((site) => site && site.siteKey !== excludeSiteKey)
    .map((site) => ({ site, url: safeHttpUrl(site.origin) }))
    .filter((candidate) => candidate.url);

  if (candidates.length === 0) return null;

  const weighted = candidates.map((candidate) => {
    const lastSeenAt = Number(candidate.site.lastSeenAt) || Number(candidate.site.verifiedAt) || 0;
    const ageDays = lastSeenAt > 0 ? Math.max(0, (now - lastSeenAt) / DAY_MS) : 60;
    const recencyWeight = Math.max(1, 61 - Math.min(60, ageDays));
    const liveVisitors = Math.max(0, Number(candidate.site.activeVisitors) || 0);
    return { ...candidate, weight: recencyWeight + liveVisitors * 60 };
  });

  const totalWeight = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  let cursor = Math.min(0.999999999999, Math.max(0, Number(random()) || 0)) * totalWeight;
  const selected = weighted.find((candidate) => {
    cursor -= candidate.weight;
    return cursor < 0;
  }) || weighted.at(-1);

  return {
    siteKey: selected.site.siteKey,
    name: String(selected.site.name || "Another TownSquare").trim() || "Another TownSquare",
    url: selected.url,
  };
}

module.exports = { selectRandomTown };
