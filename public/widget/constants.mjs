/**
 * Shared timing, movement, and scene constants for the embeddable widget.
 *
 * Scene prop definitions live here so new props can be added in one place.
 */

export const BUBBLE_TTL_MS = 6000;
export const BROWSER_ID_KEY = "townsquare-browser-id";
export const BENCH_SETTLE_MS = 700;
export const MAX_RECENT_MESSAGES = 5;
export const MOVEMENT_SPEED = 0.22;
export const SEND_INTERVAL_MS = 45;
export const MIN_X = 0.02;
export const MAX_X = 0.98;

/** @type {{ id: string, x: number, zoneRadius: number, width: number, height: number, svg: string }} */
export const BENCH = {
  id: "bench",
  x: 0.2,
  zoneRadius: 0.035,
  width: 52,
  height: 18,
  svg: `
    <svg viewBox="0 0 50 18" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <line x1="8" y1="8" x2="6" y2="17"></line>
      <line x1="42" y1="8" x2="44" y2="17"></line>
      <line x1="3" y1="8" x2="47" y2="8"></line>
      <line x1="6" y1="1" x2="6" y2="8"></line>
      <line x1="44" y1="1" x2="44" y2="8"></line>
      <line x1="6" y1="2" x2="44" y2="2"></line>
      <line x1="6" y1="5" x2="44" y2="5"></line>
    </svg>
  `,
};
