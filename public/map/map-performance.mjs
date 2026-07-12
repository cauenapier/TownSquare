export function measureMapOperation(name, operation) {
  const clock = globalThis.performance;
  if (typeof clock?.now !== "function") return operation();
  const startedAt = clock.now();
  try {
    return operation();
  } finally {
    try {
      const measureName = `townsquare:map:${name}`;
      clock.clearMeasures?.(measureName);
      clock.measure?.(measureName, { start: startedAt, end: clock.now() });
    } catch {
      // Measurements must never affect map behavior on older browsers.
    }
  }
}
