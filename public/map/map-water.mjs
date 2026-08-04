function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

const flattenedPathCache = new WeakMap();

function curveControls(points, index) {
  const previous = points[Math.max(0, index - 1)];
  const current = points[index];
  const next = points[index + 1];
  const after = points[Math.min(points.length - 1, index + 2)];
  return {
    current,
    next,
    control1: {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    },
    control2: {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    },
  };
}

function cubicPoint({ current, control1, control2, next }, ratio) {
  const inverse = 1 - ratio;
  const a = inverse ** 3;
  const b = 3 * inverse ** 2 * ratio;
  const c = 3 * inverse * ratio ** 2;
  const d = ratio ** 3;
  return {
    x: a * current.x + b * control1.x + c * control2.x + d * next.x,
    y: a * current.y + b * control1.y + c * control2.y + d * next.y,
  };
}

export function waterPathData(path) {
  const { points } = path;
  if (points.length === 1) return `M${points[0].x} ${points[0].y} l0.01 0`;
  if (points.length === 2) return `M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`;
  let data = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const { control1, control2, next } = curveControls(points, index);
    data += ` C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${next.x} ${next.y}`;
  }
  return data;
}

export function flattenWaterPath(path) {
  const last = path.points.at(-1);
  const cached = flattenedPathCache.get(path);
  if (cached
    && cached.length === path.points.length
    && cached.lastX === last?.x
    && cached.lastY === last?.y) return cached.points;
  if (path.points.length < 3) return path.points;

  const points = [path.points[0]];
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const curve = curveControls(path.points, index);
    const chord = Math.hypot(curve.next.x - curve.current.x, curve.next.y - curve.current.y);
    const subdivisions = Math.max(2, Math.ceil(chord / 12));
    for (let step = 1; step <= subdivisions; step += 1) {
      points.push(cubicPoint(curve, step / subdivisions));
    }
  }
  flattenedPathCache.set(path, {
    length: path.points.length,
    lastX: last.x,
    lastY: last.y,
    points,
  });
  return points;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const onSegment = (p, q, r) => (
    q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x)
    && q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y)
  );
  if (abC === 0 && onSegment(a, c, b)) return true;
  if (abD === 0 && onSegment(a, d, b)) return true;
  if (cdA === 0 && onSegment(c, a, d)) return true;
  if (cdB === 0 && onSegment(c, b, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

export function waterPathTouchesPoint(path, point, radius = 0) {
  const hitRadius = radius + path.width / 2;
  const points = flattenWaterPath(path);
  if (points.length === 1) return distanceToSegment(point, points[0], points[0]) <= hitRadius;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= hitRadius) return true;
  }
  return false;
}

export function waterPathsOverlap(first, second) {
  const hitDistance = (first.width + second.width) / 2;
  const bounds = (path) => flattenWaterPath(path).reduce((box, point) => ({
    minX: Math.min(box.minX, point.x),
    maxX: Math.max(box.maxX, point.x),
    minY: Math.min(box.minY, point.y),
    maxY: Math.max(box.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const firstBounds = bounds(first);
  const secondBounds = bounds(second);
  if (
    firstBounds.maxX + hitDistance < secondBounds.minX
    || secondBounds.maxX + hitDistance < firstBounds.minX
    || firstBounds.maxY + hitDistance < secondBounds.minY
    || secondBounds.maxY + hitDistance < firstBounds.minY
  ) return false;
  const firstPoints = flattenWaterPath(first);
  const secondPoints = flattenWaterPath(second);
  const firstSegmentCount = Math.max(1, firstPoints.length - 1);
  const secondSegmentCount = Math.max(1, secondPoints.length - 1);
  for (let firstIndex = 0; firstIndex < firstSegmentCount; firstIndex += 1) {
    const a = firstPoints[firstIndex];
    const b = firstPoints[Math.min(firstPoints.length - 1, firstIndex + 1)];
    for (let secondIndex = 0; secondIndex < secondSegmentCount; secondIndex += 1) {
      const c = secondPoints[secondIndex];
      const d = secondPoints[Math.min(secondPoints.length - 1, secondIndex + 1)];
      if (segmentDistance(a, b, c, d) <= hitDistance) return true;
    }
  }
  return false;
}

export function waterAreaTouchesPoint(area, point, radius = 0) {
  return area.paths.some((path) => {
    if (!waterPathTouchesPoint(path, point, radius)) return false;
    return !area.cutouts.some((cutout) => (
      cutout.order > path.order
      && Math.hypot(point.x - cutout.x, point.y - cutout.y) + radius <= cutout.radius
    ));
  });
}

function waterAreasOverlap(first, second) {
  return first.paths.some((path) => second.paths.some((other) => waterPathsOverlap(path, other)));
}

export function mergeOverlappingWaterAreas(areas) {
  const merged = areas.map((area) => ({
    type: "water",
    paths: [...area.paths],
    cutouts: [...(area.cutouts || [])],
  }));
  for (let index = 0; index < merged.length; index += 1) {
    for (let candidate = index + 1; candidate < merged.length;) {
      if (!waterAreasOverlap(merged[index], merged[candidate])) {
        candidate += 1;
        continue;
      }
      merged[index].paths.push(...merged[candidate].paths);
      merged[index].cutouts.push(...merged[candidate].cutouts);
      merged.splice(candidate, 1);
      index = -1;
      break;
    }
  }
  return merged;
}
