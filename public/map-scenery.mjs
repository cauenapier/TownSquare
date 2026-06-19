import { mountainPath, treeCrownPath, treeTrunkPath } from "./map-glyphs.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const GLYPH_TYPES = new Set(["mountains", "trees"]);
const DEFAULT_WORLD = { width: 1800, height: 1200, clusters: [] };
/** Minimum center-to-center gap for scattered trees (crown is ~56px wide). */
const TREE_MIN_SPACING = 30;
const SCATTER_ATTEMPTS = 40;

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  return el;
}

function isPoint(value) {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function clampPoint(x, y, width, height, margin = 40) {
  return {
    x: Math.max(margin, Math.min(width - margin, x)),
    y: Math.max(margin, Math.min(height - margin, y)),
  };
}

function scatterPoint(clusterIndex, glyphIndex, center, radius, width, height, salt = 0) {
  const hash = hashString(`cluster:${clusterIndex}:${glyphIndex}:${salt}`);
  const angle = (hash % 6283) / 1000;
  const distance = radius * (((hash >>> 10) % 1000) / 1000);
  const x = center[0] + Math.cos(angle) * distance;
  const y = center[1] + Math.sin(angle) * distance;
  return clampPoint(x, y, width, height);
}

function minDistanceToPlaced(point, placed) {
  let minDist = Infinity;
  for (const existing of placed) {
    const dx = point.x - existing.x;
    const dy = point.y - existing.y;
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function scatterPointWithSpacing(clusterIndex, glyphIndex, center, radius, width, height, placed, minSpacing) {
  if (!minSpacing || placed.length === 0) {
    return scatterPoint(clusterIndex, glyphIndex, center, radius, width, height);
  }

  let best = scatterPoint(clusterIndex, glyphIndex, center, radius, width, height, 0);
  let bestMinDist = minDistanceToPlaced(best, placed);
  if (bestMinDist >= minSpacing) return best;

  for (let attempt = 1; attempt < SCATTER_ATTEMPTS; attempt += 1) {
    const point = scatterPoint(clusterIndex, glyphIndex, center, radius, width, height, attempt);
    const minDist = minDistanceToPlaced(point, placed);
    if (minDist >= minSpacing) return point;
    if (minDist > bestMinDist) {
      best = point;
      bestMinDist = minDist;
    }
  }

  return best;
}

function expandCluster(cluster, clusterIndex, width, height) {
  if (!GLYPH_TYPES.has(cluster.type)) {
    console.warn(`Unknown map cluster type: ${cluster.type}`);
    return [];
  }

  if (Array.isArray(cluster.points)) {
    return cluster.points
      .filter(isPoint)
      .map(([x, y]) => ({ type: cluster.type, ...clampPoint(x, y, width, height) }));
  }

  if (!isPoint(cluster.center) || !Number.isFinite(cluster.count) || !Number.isFinite(cluster.radius)) {
    console.warn("Skipping invalid map cluster", cluster);
    return [];
  }

  const count = Math.max(1, Math.floor(cluster.count));
  const radius = Math.max(1, cluster.radius);
  const minSpacing = cluster.type === "trees" ? TREE_MIN_SPACING : 0;
  const points = [];
  const placed = [];

  for (let index = 0; index < count; index += 1) {
    const point = scatterPointWithSpacing(
      clusterIndex,
      index,
      cluster.center,
      radius,
      width,
      height,
      placed,
      minSpacing,
    );
    points.push({ type: cluster.type, ...point });
    placed.push(point);
  }

  return points;
}

export function parseMapWorld(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WORLD };

  const width = Number.isFinite(raw.width) && raw.width > 0 ? raw.width : DEFAULT_WORLD.width;
  const height = Number.isFinite(raw.height) && raw.height > 0 ? raw.height : DEFAULT_WORLD.height;
  const clusters = Array.isArray(raw.clusters) ? raw.clusters : [];

  return { width, height, clusters };
}

export function renderSceneryLayer(world, createElement = createSvgElement) {
  const group = createElement("g", { class: "map-scenery", "aria-hidden": "true" });
  const glyphs = [];

  for (const [index, cluster] of world.clusters.entries()) {
    glyphs.push(...expandCluster(cluster, index, world.width, world.height));
  }

  for (const glyph of glyphs) {
    if (glyph.type === "mountains") {
      group.appendChild(createElement("path", {
        class: "map-mountain",
        d: mountainPath(glyph.x, glyph.y),
      }));
      continue;
    }

    const tree = createElement("g", { class: "map-tree" });
    tree.append(
      createElement("path", { class: "map-tree__crown", d: treeCrownPath(glyph.x, glyph.y) }),
      createElement("path", { class: "map-tree__trunk", d: treeTrunkPath(glyph.x, glyph.y) }),
    );
    group.appendChild(tree);
  }

  return group;
}
