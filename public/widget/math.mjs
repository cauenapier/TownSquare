/**
 * Tiny numeric helpers shared across the widget runtime and dev tooling.
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number} `value` clamped to the inclusive `[min, max]` range.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
