/**
 * Default scene prop definitions shared by the widget and realtime server.
 *
 * Site-specific scenes are derived from site-config-core.mjs (in this folder).
 * This module keeps the default TownSquare shape as a simple exported constant
 * for callers that do not provide a per-site override.
 */

import { buildSceneProps, DEFAULT_SCENE_CONFIG } from "./site-config-core.mjs";

/**
 * @typedef {import("./site-config-core.mjs").SceneProp} SceneProp
 */

/** @type {Array<SceneProp>} */
export const PROPS = buildSceneProps(DEFAULT_SCENE_CONFIG);
