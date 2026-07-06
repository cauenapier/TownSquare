/**
 * Shared settle-zone geometry for scene props.
 *
 * Prop `width` is in px (fixed art size). Settle bands are expressed in the
 * same normalized x space as character positions.
 */

import { REFERENCE_STAGE_WIDTH } from "./site-config.mjs";

/**
 * @typedef {import("./site-config.mjs").SceneProp} SceneProp
 */

/**
 * @param {SceneProp} prop
 * @returns {number}
 */
export function propSettleHalfWidth(prop) {
  if (!prop.pose || prop.width <= 0) return 0;
  return (prop.width / 2) / REFERENCE_STAGE_WIDTH;
}

/**
 * @param {SceneProp} prop
 * @param {number} x
 * @returns {boolean}
 */
export function isWithinPropSettleZone(prop, x) {
  const half = propSettleHalfWidth(prop);
  return half > 0 && Math.abs(x - prop.x) < half;
}

/**
 * @param {Array<SceneProp>} props
 * @param {number} x
 * @returns {SceneProp | undefined}
 */
export function findSettleProp(props, x) {
  return props.find((prop) => isWithinPropSettleZone(prop, x));
}
