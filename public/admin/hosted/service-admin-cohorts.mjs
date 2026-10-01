const DAY_MS = 24 * 60 * 60 * 1000;

function monthKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyCohort(key, startAt = null) {
  return { key, startAt, active: 0, inactive: 0, new: 0, total: 0 };
}

function addSite(cohort, site, now, activeWindowMs) {
  const monthlyVisitors = Number(site.visitorStats?.monthly) || 0;
  if (monthlyVisitors > 0) {
    cohort.active += 1;
  } else if (now - site.verifiedAt <= activeWindowMs) {
    cohort.new += 1;
  } else {
    cohort.inactive += 1;
  }
  cohort.total += 1;
}

export function buildVerifiedSiteCohorts(sites, {
  now = Date.now(),
  monthCount = 12,
  activeWindowDays = 30,
} = {}) {
  const safeMonthCount = Math.max(1, Math.floor(monthCount));
  const current = new Date(now);
  const firstMonthAt = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth() - safeMonthCount + 1,
    1,
  );
  const activeWindowMs = activeWindowDays * DAY_MS;
  const monthly = new Map();
  const earlier = emptyCohort("earlier");
  const firstMonth = new Date(firstMonthAt);

  for (let offset = 0; offset < safeMonthCount; offset += 1) {
    const startAt = Date.UTC(
      firstMonth.getUTCFullYear(),
      firstMonth.getUTCMonth() + offset,
      1,
    );
    monthly.set(monthKey(startAt), emptyCohort(monthKey(startAt), startAt));
  }

  for (const site of sites) {
    if (!(Number(site.verifiedAt) > 0)) continue;
    if (site.disabled) continue;

    const cohort = site.verifiedAt < firstMonthAt
      ? earlier
      : monthly.get(monthKey(site.verifiedAt));
    if (cohort) addSite(cohort, site, now, activeWindowMs);
  }

  const cohorts = [earlier, ...monthly.values()].filter((cohort) => cohort.total > 0);
  const totals = cohorts.reduce((sum, cohort) => ({
    active: sum.active + cohort.active,
    inactive: sum.inactive + cohort.inactive,
    new: sum.new + cohort.new,
    total: sum.total + cohort.total,
  }), { active: 0, inactive: 0, new: 0, total: 0 });
  const matureTotal = totals.active + totals.inactive;

  return {
    cohorts,
    totals,
    retentionRate: matureTotal > 0 ? totals.active / matureTotal : null,
  };
}
