/**
 * Bird perch definitions shared by the server and widget.
 *
 * Positions are derived from scene props so bench/tree changes stay
 * single-sourced.
 */

import { PROPS } from "./scene-props.mjs";
import { buildBirdPerches } from "./site-config.mjs";

/**
 * @typedef {Object} BirdPerch
 * @property {string} id
 * @property {string} propId
 * @property {number} offsetX
 * @property {number} liftPx
 * @property {number} x
 */

/** @type {Array<BirdPerch>} */
export const BIRD_PERCHES = buildBirdPerches(PROPS);

/** @type {Map<string, BirdPerch>} */
export const BIRD_PERCHES_BY_ID = new Map(BIRD_PERCHES.map((perch) => [perch.id, perch]));
