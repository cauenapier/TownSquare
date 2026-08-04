function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function pathSegments(path) {
  if (path.points.length === 1) return [[path.points[0], path.points[0]]];
  return path.points.slice(1).map((point, index) => [path.points[index], point]);
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
  return pathSegments(path).some(([start, end]) => distanceToSegment(point, start, end) <= hitRadius);
}

export function waterPathsOverlap(first, second) {
  const hitDistance = (first.width + second.width) / 2;
  const bounds = (path) => path.points.reduce((box, point) => ({
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
  const firstSegments = pathSegments(first);
  const secondSegments = pathSegments(second);
  return firstSegments.some(([a, b]) => (
    secondSegments.some(([c, d]) => segmentDistance(a, b, c, d) <= hitDistance)
  ));
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
