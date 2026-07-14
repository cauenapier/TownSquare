import { createSvgElement } from "../lib/ui-common.mjs";
import { mountainPath, treeCrownPath, treeTrunkPath } from "./map-glyphs.mjs";
import { MAP_WATER_RIVER_STYLE_MAX_WIDTH } from "../lib/map-world.mjs";
import { measureMapOperation } from "./map-performance.mjs";

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
  for (const [areaIndex, area] of world.water.entries()) {
    const areaGroup = createSvgElement("g");
    for (const [pathIndex, stroke] of area.paths.entries()) {
      const strokeGroup = createSvgElement("g");
      const cutouts = area.cutouts.filter((cutout) => cutout.order > stroke.order);
      if (cutouts.length) {
        const maskId = `map-water-mask-${areaIndex}-${pathIndex}`;
        const mask = createSvgElement("mask", { id: maskId, maskUnits: "userSpaceOnUse" });
        mask.appendChild(createSvgElement("rect", { x: 0, y: 0, width: world.width, height: world.height, fill: "white" }));
        for (const cutout of cutouts) {
          mask.appendChild(createSvgElement("circle", { cx: cutout.x, cy: cutout.y, r: cutout.radius, fill: "black" }));
        }
        const definitions = createSvgElement("defs");
        definitions.appendChild(mask);
        group.appendChild(definitions);
        strokeGroup.setAttribute("mask", `url(#${maskId})`);
      }
      const path = smoothPath(stroke.points);
      if (waterUsesRiverStyle(stroke)) {
        strokeGroup.append(
          createSvgElement("path", { class: "map-river__bank", d: path, "stroke-width": stroke.width + 6 }),
          createSvgElement("path", { class: "map-river", d: path, "stroke-width": stroke.width }),
        );
      } else {
        strokeGroup.appendChild(createSvgElement("path", {
          class: "map-lake",
          d: path,
          "stroke-width": stroke.width,
        }));
      }
      areaGroup.appendChild(strokeGroup);
    }
    group.appendChild(areaGroup);
  }
  return group;
}

export function sceneryPropPaths(props) {
  const paths = { mountains: [], treeCrowns: [], treeTrunks: [] };
  for (const prop of props) {
    if (prop.type === "mountain") paths.mountains.push(mountainPath(prop.x, prop.y));
    else {
      paths.treeCrowns.push(treeCrownPath(prop.x, prop.y));
      paths.treeTrunks.push(treeTrunkPath(prop.x, prop.y));
    }
  }
  return {
    mountains: paths.mountains.join(" "),
    treeCrowns: paths.treeCrowns.join(" "),
    treeTrunks: paths.treeTrunks.join(" "),
  };
}

export function renderSceneryLayer(world) {
  return measureMapOperation("scenery-render", () => {
    const group = createSvgElement("g", { class: "map-scenery", "aria-hidden": "true" });
    const paths = sceneryPropPaths(world.props);
    group.appendChild(renderWater(world));
    if (paths.mountains) group.appendChild(createSvgElement("path", { class: "map-mountain", d: paths.mountains }));
    if (paths.treeCrowns) group.appendChild(createSvgElement("path", { class: "map-tree__crown", d: paths.treeCrowns }));
    if (paths.treeTrunks) group.appendChild(createSvgElement("path", { class: "map-tree__trunk", d: paths.treeTrunks }));
    return group;
  });
}
