const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS_PER_DAY = 24;
const MAX_STACKED_SITES = 6;

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/** Convert raw visitor-hour totals into comparable weekday averages. */
export function buildVisitorActivityView(activity) {
  const sourceRows = Array.isArray(activity?.weekdays) ? activity.weekdays : [];
  const rows = WEEKDAY_NAMES.map((name, weekday) => {
    const source = sourceRows.find((entry) => entry?.weekday === weekday);
    const sampleDays = Math.max(0, Math.floor(safeCount(source?.sampleDays)));
    const hours = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
      const total = safeCount(source?.hours?.[hour]);
      return { hour, total, average: sampleDays > 0 ? total / sampleDays : 0 };
    });
    return { weekday, name, sampleDays, hours };
  });
  const peakAverage = Math.max(0, ...rows.flatMap((row) => row.hours.map((slot) => slot.average)));

  for (const row of rows) {
    for (const slot of row.hours) {
      slot.percentage = peakAverage > 0 ? (slot.average / peakAverage) * 100 : 0;
    }
  }

  return {
    timeZone: activity?.timeZone || "UTC",
    windowDays: Math.max(0, Math.floor(safeCount(activity?.windowDays))),
    peakAverage,
    rows,
  };
}

/** Build an aggregate chart with the busiest sites stacked and the rest grouped. */
export function buildStackedVisitorActivityView(sites, maxSites = MAX_STACKED_SITES) {
  const siteViews = (Array.isArray(sites) ? sites : [])
    .map((site) => {
      const view = buildVisitorActivityView(site?.activity);
      const score = view.rows.reduce(
        (total, row) => total + row.hours.reduce((sum, slot) => sum + slot.average, 0),
        0,
      );
      return {
        key: site?.siteKey || "",
        label: site?.name || site?.origin || site?.siteKey || "Unknown site",
        score,
        view,
      };
    })
    .filter((site) => site.key && site.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  const visibleSites = siteViews.slice(0, Math.max(1, maxSites));
  const otherSites = siteViews.slice(visibleSites.length);
  const contributors = visibleSites.map((site, index) => ({ ...site, tone: index + 1 }));
  if (otherSites.length > 0) {
    contributors.push({
      key: "other",
      label: `Other (${otherSites.length})`,
      score: otherSites.reduce((sum, site) => sum + site.score, 0),
      sites: otherSites,
      tone: "other",
    });
  }

  const rows = WEEKDAY_NAMES.map((name, weekday) => ({
    weekday,
    name,
    hours: Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
      const segments = contributors.map((contributor) => {
        const average = contributor.sites
          ? contributor.sites.reduce((sum, site) => sum + site.view.rows[weekday].hours[hour].average, 0)
          : contributor.view.rows[weekday].hours[hour].average;
        return {
          key: contributor.key,
          label: contributor.label,
          tone: contributor.tone,
          average,
        };
      });
      return {
        hour,
        segments,
        average: segments.reduce((sum, segment) => sum + segment.average, 0),
      };
    }),
  }));
  const peakAverage = Math.max(0, ...rows.flatMap((row) => row.hours.map((slot) => slot.average)));

  for (const row of rows) {
    for (const slot of row.hours) {
      slot.percentage = peakAverage > 0 ? (slot.average / peakAverage) * 100 : 0;
      for (const segment of slot.segments) {
        segment.percentage = peakAverage > 0 ? (segment.average / peakAverage) * 100 : 0;
      }
    }
  }

  return {
    timeZone: siteViews[0]?.view.timeZone || "UTC",
    windowDays: Math.max(0, ...siteViews.map((site) => site.view.windowDays)),
    peakAverage,
    rows,
    legend: contributors.map(({ key, label, tone }) => ({ key, label, tone })),
    siteCount: siteViews.length,
  };
}
