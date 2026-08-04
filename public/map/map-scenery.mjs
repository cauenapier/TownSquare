import { createSvgElement } from "../lib/ui-common.mjs";
import { mountainPath, treeCrownPath, treeTrunkPath } from "./map-glyphs.mjs";
import { MAP_WATER_RIVER_STYLE_MAX_WIDTH } from "../lib/map-world.mjs";
import { measureMapOperation } from "./map-performance.mjs";
import { waterPathData } from "./map-water.mjs";

function waterUsesRiverStyle(stroke) {
  return stroke.width <= MAP_WATER_RIVER_STYLE_MAX_WIDTH;
}

function cutoutPath(cutouts) {
  return cutouts.map(({ x, y, radius }) => (
    `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`
  )).join("");
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
        // x/y/width/height must be explicit: the SVG default mask region (-10%/120%)
        // resolves against the current viewBox, so it shrinks as the map zooms in and
        // clips masked strokes to a blank rectangle once the region no longer covers
        // the whole world.
        const mask = createSvgElement("mask", {
          id: maskId,
          maskUnits: "userSpaceOnUse",
          x: 0,
          y: 0,
          width: world.width,
          height: world.height,
        });
        mask.appendChild(createSvgElement("rect", { x: 0, y: 0, width: world.width, height: world.height, fill: "white" }));
        mask.appendChild(createSvgElement("path", { d: cutoutPath(cutouts), fill: "black" }));
        const definitions = createSvgElement("defs");
        definitions.appendChild(mask);
        group.appendChild(definitions);
        strokeGroup.setAttribute("mask", `url(#${maskId})`);
      }
      const path = waterPathData(stroke);
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
