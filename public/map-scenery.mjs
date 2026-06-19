import { mountainPath, treeCrownPath, treeTrunkPath } from "./map-glyphs.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

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

function renderWater(world, createElement) {
  const group = createElement("g", { class: "map-water", "aria-hidden": "true" });
  for (const stroke of world.water) {
    const path = smoothPath(stroke.points);
    if (stroke.type === "river") {
      group.append(
        createElement("path", { class: "map-river__bank", d: path, "stroke-width": stroke.width + 6 }),
        createElement("path", { class: "map-river", d: path, "stroke-width": stroke.width }),
      );
    } else {
      group.appendChild(createElement("path", {
        class: "map-lake",
        d: path,
        "stroke-width": stroke.width,
      }));
    }
  }
  return group;
}

function renderProp(prop, createElement) {
  if (prop.type === "mountain") {
    return createElement("path", { class: "map-mountain", d: mountainPath(prop.x, prop.y) });
  }
  const tree = createElement("g", { class: "map-tree" });
  tree.append(
    createElement("path", { class: "map-tree__crown", d: treeCrownPath(prop.x, prop.y) }),
    createElement("path", { class: "map-tree__trunk", d: treeTrunkPath(prop.x, prop.y) }),
  );
  return tree;
}

export function renderSceneryLayer(world, createElement = createSvgElement) {
  const group = createElement("g", { class: "map-scenery", "aria-hidden": "true" });
  group.appendChild(renderWater(world, createElement));
  for (const prop of world.props) group.appendChild(renderProp(prop, createElement));
  return group;
}
