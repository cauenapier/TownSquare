import {
  DEFAULT_SITE_STYLE_LIGHT,
  paletteVarEntries,
  sanitizeStylePalette,
} from "./site-config-core.mjs";

/** Apply a flat palette to a widget root for previews or explicit inline styles. */
export function applySiteStyle(root, palette = DEFAULT_SITE_STYLE_LIGHT) {
  const next = sanitizeStylePalette(palette, DEFAULT_SITE_STYLE_LIGHT);
  for (const [cssVar, value] of paletteVarEntries(next)) {
    root.style.setProperty(cssVar, value);
  }
  root.dataset.townsquareSurface = "";
}
