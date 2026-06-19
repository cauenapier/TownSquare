import { createSvgElement } from "./lib/ui-common.mjs";
import { mapEdgePath } from "./map-connections.mjs";
import { cityTier } from "./map-layout.mjs";

export function supporterStarSize(tier) {
  return Math.max(22, Math.round(tier.radius * 0.95));
}

export function createSupporterStar(tier) {
  const size = supporterStarSize(tier);
  const star = createSvgElement("text", {
    class: "map-node__supporter-star",
    x: 0,
    y: -(tier.radius + size * 0.48),
    "text-anchor": "middle",
    "aria-hidden": "true",
    style: `font-size: ${size}px`,
  });
  star.textContent = "★";
  return star;
}

export function createCityMarker(site) {
  const tier = cityTier(site.messageCount);
  const label = createSvgElement("text", { x: 0, y: tier.radius + 10, class: "map-node__label" });
  label.textContent = site.name;
  return {
    tier,
    dot: createSvgElement("circle", { class: "map-node__dot", r: tier.radius }),
    label,
    star: site.supporter ? createSupporterStar(tier) : null,
  };
}

export function renderMapEdge(edge, positions, selectedSiteKey = "") {
  const from = positions.get(edge.fromKey);
  const to = positions.get(edge.toKey);
  if (!from || !to) return null;
  const active = selectedSiteKey && (edge.fromKey === selectedSiteKey || edge.toKey === selectedSiteKey);
  return createSvgElement("path", {
    class: `map-link map-link--${edge.bidirectional ? "asphalt" : "dirt"}${active ? " is-active" : ""}`,
    d: mapEdgePath(from, to),
    "data-from-key": edge.fromKey,
    "data-to-key": edge.toKey,
  });
}
