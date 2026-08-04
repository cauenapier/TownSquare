import {
  cloneMapWorld,
  MAP_PROP_TYPES,
  MAX_MAP_HISTORY_ITEMS,
  MAX_MAP_PROPS,
  MAX_WATER_POINTS,
  MAX_WATER_STROKES,
} from "../../lib/map-world.mjs";
import { waterAreaTouchesPoint } from "../../map/map-water.mjs";

const TREE_SPACING = 24;

function roundedPoint(point) {
  return {
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  };
}

export function countWaterPoints(world) {
  return world.water.reduce((count, area) => (
    count + area.cutouts.length + area.paths.reduce((pathCount, path) => pathCount + path.points.length, 0)
  ), 0);
}

export function countWaterPaths(world) {
  return world.water.reduce((count, area) => count + area.paths.length, 0);
}

export function nextWaterOrder(world) {
  let order = 0;
  for (const area of world.water) {
    for (const path of area.paths) order = Math.max(order, path.order || 0);
    for (const cutout of area.cutouts) order = Math.max(order, cutout.order || 0);
  }
  return order + 1;
}

export function createMapGesture(world, beforeDirty = false) {
  return {
    before: cloneMapWorld(world),
    beforeDirty,
    changed: false,
    lastPoint: null,
    lastErasePoint: null,
    waterPath: null,
    treeGrid: null,
    waterPointCount: countWaterPoints(world),
  };
}

function treeGridKey(x, y) {
  return `${Math.floor(x / TREE_SPACING)},${Math.floor(y / TREE_SPACING)}`;
}

function getTreeGrid(world, gesture) {
  if (gesture.treeGrid) return gesture.treeGrid;
  const grid = new Map();
  for (const prop of world.props) {
    if (prop.type !== "tree") continue;
    const key = treeGridKey(prop.x, prop.y);
    const cell = grid.get(key) || [];
    cell.push(prop);
    grid.set(key, cell);
  }
  gesture.treeGrid = grid;
  return grid;
}

function treeLocationIsCrowded(grid, candidate) {
  const cellX = Math.floor(candidate.x / TREE_SPACING);
  const cellY = Math.floor(candidate.y / TREE_SPACING);
  for (let x = cellX - 1; x <= cellX + 1; x += 1) {
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      const trees = grid.get(`${x},${y}`) || [];
      if (trees.some((tree) => Math.hypot(tree.x - candidate.x, tree.y - candidate.y) < TREE_SPACING)) {
        return true;
      }
    }
  }
  return false;
}

function eraseMapAt(world, gesture, point, brushSize) {
  const radius = brushSize / 2;
  const spacing = Math.max(6, radius * 0.35);
  if (gesture.lastErasePoint
    && Math.hypot(gesture.lastErasePoint.x - point.x, gesture.lastErasePoint.y - point.y) < spacing) {
    return { changed: false };
  }
  gesture.lastErasePoint = point;

  const propCount = world.props.length;
  world.props = world.props.filter((prop) => Math.hypot(prop.x - point.x, prop.y - point.y) > radius);
  let erasedWater = false;
  for (const area of world.water) {
    if (!waterAreaTouchesPoint(area, point, radius)) continue;
    if (gesture.waterPointCount >= MAX_WATER_POINTS) {
      return {
        changed: propCount !== world.props.length || erasedWater,
        message: `The map is limited to ${MAX_WATER_POINTS} water points.`,
      };
    }
    area.cutouts.push({ ...roundedPoint(point), radius, order: nextWaterOrder(world) });
    gesture.waterPointCount += 1;
    erasedWater = true;
  }
  return { changed: propCount !== world.props.length || erasedWater };
}

function paintTreeDab(world, gesture, point, brushSize, treeDensity, random) {
  const radius = brushSize / 2;
  if (gesture.lastPoint
    && Math.hypot(gesture.lastPoint.x - point.x, gesture.lastPoint.y - point.y) < radius * 0.65) {
    return { changed: false };
  }
  gesture.lastPoint = point;
  const grid = getTreeGrid(world, gesture);
  let changed = false;
  for (let index = 0; index < treeDensity && world.props.length < MAX_MAP_PROPS; index += 1) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      const candidate = {
        type: "tree",
        x: Math.round(Math.max(0, Math.min(world.width, point.x + Math.cos(angle) * distance)) * 100) / 100,
        y: Math.round(Math.max(0, Math.min(world.height, point.y + Math.sin(angle) * distance)) * 100) / 100,
      };
      if (treeLocationIsCrowded(grid, candidate)) continue;
      world.props.push(candidate);
      const key = treeGridKey(candidate.x, candidate.y);
      const cell = grid.get(key) || [];
      cell.push(candidate);
      grid.set(key, cell);
      changed = true;
      break;
    }
  }
  return {
    changed,
    message: world.props.length >= MAX_MAP_PROPS ? `The map is limited to ${MAX_MAP_PROPS} props.` : "",
  };
}

function paintMountain(world, gesture, point) {
  const spacing = MAP_PROP_TYPES.mountain.brushSpacing;
  if (gesture.lastPoint && Math.hypot(gesture.lastPoint.x - point.x, gesture.lastPoint.y - point.y) < spacing) {
    return { changed: false };
  }
  if (world.props.length >= MAX_MAP_PROPS) {
    return { changed: false, message: `The map is limited to ${MAX_MAP_PROPS} props.` };
  }
  world.props.push({ type: "mountain", ...roundedPoint(point) });
  gesture.lastPoint = point;
  return { changed: true };
}

function paintWater(world, gesture, point, brushSize) {
  if (gesture.waterPointCount >= MAX_WATER_POINTS) {
    return { changed: false, message: `The map is limited to ${MAX_WATER_POINTS} water points.` };
  }
  if (!gesture.waterPath) {
    if (countWaterPaths(world) >= MAX_WATER_STROKES) {
      return { changed: false, message: `The map is limited to ${MAX_WATER_STROKES} water paths.` };
    }
    gesture.waterPath = { width: brushSize, points: [], order: nextWaterOrder(world) };
    world.water.push({ type: "water", paths: [gesture.waterPath], cutouts: [] });
  }
  const lastPoint = gesture.waterPath.points.at(-1);
  const spacing = brushSize <= 40 ? 14 : Math.max(10, brushSize * 0.16);
  if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < spacing) {
    return { changed: false };
  }
  gesture.waterPath.points.push(roundedPoint(point));
  gesture.waterPointCount += 1;
  return { changed: true };
}

export function applyMapBrush(world, gesture, {
  tool,
  brushSize,
  treeDensity,
  random = Math.random,
}, point) {
  if (tool === "erase") return eraseMapAt(world, gesture, point, brushSize);
  if (tool === "tree") return paintTreeDab(world, gesture, point, brushSize, treeDensity, random);
  if (tool === "mountain") return paintMountain(world, gesture, point);
  if (tool === "water") return paintWater(world, gesture, point, brushSize);
  return { changed: false };
}

export function mapWorldItemCount(world) {
  return world.props.length + world.water.reduce((count, area) => (
    count + area.cutouts.length + area.paths.reduce((pathCount, path) => pathCount + path.points.length, 0)
  ), 0);
}

export function trimMapHistory(history) {
  let itemCount = history.reduce((count, entry) => count + mapWorldItemCount(entry.world), 0);
  while (history.length > 1 && itemCount > MAX_MAP_HISTORY_ITEMS) {
    itemCount -= mapWorldItemCount(history.shift().world);
  }
}
