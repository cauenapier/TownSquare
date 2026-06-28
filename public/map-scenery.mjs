import { createSvgElement } from "./lib/ui-common.mjs";
import { mountainPath, treeCrownPath, treeTrunkPath } from "./map-glyphs.mjs";
import { MAP_WATER_RIVER_STYLE_MAX_WIDTH } from "./shared/map-world.mjs";

function smoothPath(points) {
  if (points.length === 1) return `M${points[0].x} ${points[0].y} l0.01 0`;
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;

  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const control1 = { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 };
    const control2 = { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 };
    path += ` C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${next.x} ${next.y}`;
  }
  return path;
}

function waterUsesRiverStyle(stroke) {
  return stroke.width <= MAP_WATER_RIVER_STYLE_MAX_WIDTH;
}

function renderWater(world) {
  const group = createSvgElement("g", { class: "map-water", "aria-hidden": "true" });
  for (const stroke of world.water) {
    const path = smoothPath(stroke.points);
    if (waterUsesRiverStyle(stroke)) {
      group.append(
        createSvgElement("path", { class: "map-river__bank", d: path, "stroke-width": stroke.width + 6 }),
        createSvgElement("path", { class: "map-river", d: path, "stroke-width": stroke.width }),
      );
    } else {
      group.appendChild(createSvgElement("path", {
        class: "map-lake",
        d: path,
        "stroke-width": stroke.width,
      }));
    }
  }
  return group;
}

function renderProp(prop) {
  if (prop.type === "mountain") {
    return createSvgElement("path", { class: "map-mountain", d: mountainPath(prop.x, prop.y) });
  }
  const tree = createSvgElement("g", { class: "map-tree" });
  tree.append(
    createSvgElement("path", { class: "map-tree__crown", d: treeCrownPath(prop.x, prop.y) }),
    createSvgElement("path", { class: "map-tree__trunk", d: treeTrunkPath(prop.x, prop.y) }),
  );
  return tree;
}

export function renderSceneryLayer(world) {
  const group = createSvgElement("g", { class: "map-scenery", "aria-hidden": "true" });
  group.appendChild(renderWater(world));
  for (const prop of world.props) group.appendChild(renderProp(prop));
  return group;
}
