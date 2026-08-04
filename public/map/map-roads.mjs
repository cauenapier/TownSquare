import { cityTier } from "./map-layout.mjs";
import { mapEdgePath } from "./map-connections.mjs";
import { measureMapOperation } from "./map-performance.mjs";
import { flattenWaterPath } from "./map-water.mjs";

const CELL_SIZE = 36;
const LAND_COST = 1;
const BUNDLED_COST_FACTOR = 0.45;
const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function pointAlong(points, ratio) {
  let total = 0;
  const lengths = [];
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    lengths.push(length);
    total += length;
  }
  let remaining = total * ratio;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const t = lengths[index] ? remaining / lengths[index] : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t,
      };
    }
    remaining -= lengths[index];
  }
  return points.at(-1);
}

function createGrid(world, sites, positions) {
  const columns = Math.ceil(world.width / CELL_SIZE) + 1;
  const rows = Math.ceil(world.height / CELL_SIZE) + 1;
  const costs = new Float32Array(columns * rows).fill(LAND_COST);
  const usage = new Uint16Array(columns * rows);
  const pointAt = (index) => ({
    x: Math.min(world.width, (index % columns) * CELL_SIZE),
    y: Math.min(world.height, Math.floor(index / columns) * CELL_SIZE),
  });

  function paintCircle(center, radius, cost, replace = false) {
    const minColumn = Math.max(0, Math.floor((center.x - radius) / CELL_SIZE));
    const maxColumn = Math.min(columns - 1, Math.ceil((center.x + radius) / CELL_SIZE));
    const minRow = Math.max(0, Math.floor((center.y - radius) / CELL_SIZE));
    const maxRow = Math.min(rows - 1, Math.ceil((center.y + radius) / CELL_SIZE));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const index = row * columns + column;
        if (Math.hypot(pointAt(index).x - center.x, pointAt(index).y - center.y) > radius) continue;
        costs[index] = replace ? cost : Math.max(costs[index], cost);
      }
    }
  }

  function paintSegment(start, end, radius, cost) {
    const minColumn = Math.max(0, Math.floor((Math.min(start.x, end.x) - radius) / CELL_SIZE));
    const maxColumn = Math.min(columns - 1, Math.ceil((Math.max(start.x, end.x) + radius) / CELL_SIZE));
    const minRow = Math.max(0, Math.floor((Math.min(start.y, end.y) - radius) / CELL_SIZE));
    const maxRow = Math.min(rows - 1, Math.ceil((Math.max(start.y, end.y) + radius) / CELL_SIZE));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const index = row * columns + column;
        if (distanceToSegment(pointAt(index), start, end) <= radius) costs[index] = Math.max(costs[index], cost);
      }
    }
  }

  for (const area of world.water) {
    const operations = [
      ...area.paths.map((path) => ({ type: "paint", order: path.order, path })),
      ...area.cutouts.map((cutout) => ({ type: "erase", order: cutout.order, cutout })),
    ].sort((first, second) => first.order - second.order);
    for (const operation of operations) {
      if (operation.type === "erase") {
        paintCircle(operation.cutout, operation.cutout.radius, LAND_COST, true);
        continue;
      }
      const { path } = operation;
      const points = flattenWaterPath(path);
      const radius = path.width / 2 + CELL_SIZE * 0.35;
      if (points.length === 1) paintCircle(points[0], radius, 30);
      for (let index = 1; index < points.length; index += 1) {
        paintSegment(points[index - 1], points[index], radius, 30);
      }
      if (path.width <= 40 && points.length > 1) {
        for (const ratio of [0.25, 0.5, 0.75]) paintCircle(pointAlong(points, ratio), CELL_SIZE * 0.72, LAND_COST, true);
      }
    }
  }
  for (const site of sites) {
    const position = positions.get(site.siteKey);
    if (position) paintCircle(position, cityTier(site.messageCount).radius + CELL_SIZE, 6);
  }
  for (const prop of world.props) {
    paintCircle(prop, prop.type === "mountain" ? 62 : 38, prop.type === "mountain" ? 20 : 8);
  }

  return { columns, rows, costs, usage, pointAt };
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length && this.items[right].score < this.items[left].score ? right : left;
        if (this.items[child].score >= last.score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

function cellIndex(grid, point) {
  const column = Math.max(0, Math.min(grid.columns - 1, Math.round(point.x / CELL_SIZE)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.round(point.y / CELL_SIZE)));
  return row * grid.columns + column;
}

function findRoute(grid, from, to) {
  const start = cellIndex(grid, from);
  const goal = cellIndex(grid, to);
  const scores = new Float64Array(grid.costs.length).fill(Infinity);
  const previous = new Int32Array(grid.costs.length).fill(-1);
  const open = new MinHeap();
  scores[start] = 0;
  open.push({ index: start, score: 0 });

  while (open.items.length) {
    const current = open.pop();
    if (current.index === goal) break;
    const column = current.index % grid.columns;
    const row = Math.floor(current.index / grid.columns);
    for (const [columnDelta, rowDelta] of DIRECTIONS) {
      const nextColumn = column + columnDelta;
      const nextRow = row + rowDelta;
      if (nextColumn < 0 || nextColumn >= grid.columns || nextRow < 0 || nextRow >= grid.rows) continue;
      const next = nextRow * grid.columns + nextColumn;
      const terrainCost = next === start || next === goal ? LAND_COST : grid.costs[next];
      const bundledCost = grid.usage[next] && terrainCost <= 6 ? terrainCost * BUNDLED_COST_FACTOR : terrainCost;
      const candidate = scores[current.index] + bundledCost * (columnDelta && rowDelta ? Math.SQRT2 : 1);
      if (candidate >= scores[next]) continue;
      scores[next] = candidate;
      previous[next] = current.index;
      const point = grid.pointAt(next);
      const heuristic = Math.hypot(point.x - to.x, point.y - to.y) / CELL_SIZE * BUNDLED_COST_FACTOR;
      open.push({ index: next, score: candidate + heuristic });
    }
  }
  if (start !== goal && previous[goal] < 0) return null;
  const cells = [];
  for (let current = goal; current >= 0; current = previous[current]) {
    cells.push(current);
    if (current === start) break;
  }
  cells.reverse();
  for (const index of cells) grid.usage[index] += 1;
  return [from, ...cells.slice(1, -1).map(grid.pointAt), to];
}

function trimStart(points, distance) {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      return [{ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, ...points.slice(index)];
    }
    remaining -= length;
  }
  return points;
}

function trimRoute(points, startInset, endInset) {
  const fromStart = trimStart(points, startInset);
  return trimStart([...fromStart].reverse(), endInset).reverse();
}

function simplifyRoute(points) {
  if (points.length < 3) return points;
  const simplified = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
    if (Math.abs(cross) > 0.01) simplified.push(current);
  }
  simplified.push(points.at(-1));
  return simplified;
}

function smoothRoute(points) {
  if (points.length < 3) return `M ${points[0].x} ${points[0].y} L ${points.at(-1).x} ${points.at(-1).y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const midpoint = { x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2 };
    path += ` Q ${points[index].x} ${points[index].y} ${midpoint.x} ${midpoint.y}`;
  }
  return `${path} L ${points.at(-1).x} ${points.at(-1).y}`;
}

export function routeMapRoads(edges, sites, positions, world) {
  return measureMapOperation("road-routing", () => {
    const grid = createGrid(world, sites, positions);
    const siteByKey = new Map(sites.map((site) => [site.siteKey, site]));
    const routes = new Map();
    for (const edge of edges) {
      const from = positions.get(edge.fromKey);
      const to = positions.get(edge.toKey);
      if (!from || !to) continue;
      const fromRadius = cityTier(siteByKey.get(edge.fromKey)?.messageCount).radius;
      const toRadius = cityTier(siteByKey.get(edge.toKey)?.messageCount).radius;
      const points = findRoute(grid, from, to);
      const key = `${edge.fromKey}|${edge.toKey}`;
      routes.set(key, points
        ? smoothRoute(simplifyRoute(trimRoute(points, fromRadius + 3, toRadius + 3)))
        : mapEdgePath(from, to, Math.max(fromRadius, toRadius) + 3, key));
    }
    return routes;
  });
}
