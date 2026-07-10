const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS_PER_DAY = 24;

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
