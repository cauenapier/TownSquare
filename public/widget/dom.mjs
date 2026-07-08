/**
 * Compatibility barrel for widget DOM helpers.
 *
 * New code should import from shell/avatar/gestures directly; this stays so
 * existing embedders and internal modules keep resolving during the split.
 */

export * from "./shell.mjs";
export * from "./avatar.mjs";
export * from "./gestures.mjs";
