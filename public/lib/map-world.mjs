export const MAP_WORLD_MIN_WIDTH = 1800;
export const MAP_WORLD_MIN_HEIGHT = 1200;
export const MAP_WORLD_MAX_WIDTH = 5400;
export const MAP_WORLD_MAX_HEIGHT = 3600;
export const MAP_WORLD_GROWTH_REF_SITES = 25;

export const MAX_MAP_PROPS = 2000;
export const MAX_WATER_STROKES = 200;
export const MAX_WATER_POINTS = 5000;
export const MAX_MAP_HISTORY_ITEMS = 20_000;

export const MAP_PROP_TYPES = Object.freeze({
  mountain: Object.freeze({ brushSpacing: 68 }),
  tree: Object.freeze({}),
});
export const MAP_WATER_TYPES = Object.freeze({ water: true, lake: true, river: true });
export const MAP_WATER_RIVER_STYLE_MAX_WIDTH = 40;

function normalizeWaterType(type) {
  return type === "lake" || type === "river" ? "water" : type;
}

function normalizeDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  if (
    roundedWidth < MAP_WORLD_MIN_WIDTH
    || roundedWidth > MAP_WORLD_MAX_WIDTH
    || roundedHeight < MAP_WORLD_MIN_HEIGHT
    || roundedHeight > MAP_WORLD_MAX_HEIGHT
  ) {
    return null;
  }
  return { width: roundedWidth, height: roundedHeight };
}

function normalizePoint(point, width, height) {
  if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
    return null;
  }
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
}

export function computeMapWorldDimensions(siteCount) {
  const count = Math.max(0, Number(siteCount) || 0);
  const scale = Math.min(
    MAP_WORLD_MAX_WIDTH / MAP_WORLD_MIN_WIDTH,
    Math.max(1, Math.sqrt(count / MAP_WORLD_GROWTH_REF_SITES)),
  );
  return {
    width: Math.round(MAP_WORLD_MIN_WIDTH * scale / 100) * 100,
    height: Math.round(MAP_WORLD_MIN_HEIGHT * scale / 100) * 100,
  };
}

export function resolveMapWorld(storedWorld, siteCount) {
  const computed = computeMapWorldDimensions(siteCount);
  const storedWidth = Number(storedWorld?.width) || MAP_WORLD_MIN_WIDTH;
  const storedHeight = Number(storedWorld?.height) || MAP_WORLD_MIN_HEIGHT;
  return {
    ...storedWorld,
    width: Math.max(storedWidth, computed.width),
    height: Math.max(storedHeight, computed.height),
    props: Array.isArray(storedWorld?.props) ? storedWorld.props : [],
    water: Array.isArray(storedWorld?.water) ? storedWorld.water : [],
  };
}

export function validateMapWorld(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Map world must be an object." };
  }
  const dimensions = normalizeDimensions(value.width, value.height);
  if (!dimensions) {
    return {
      ok: false,
      error: `Map dimensions must be between ${MAP_WORLD_MIN_WIDTH} × ${MAP_WORLD_MIN_HEIGHT} and ${MAP_WORLD_MAX_WIDTH} × ${MAP_WORLD_MAX_HEIGHT}.`,
    };
  }
  const { width, height } = dimensions;
  if (!Array.isArray(value.props)) {
    return { ok: false, error: "Map props must be an array." };
  }
  if (value.props.length > MAX_MAP_PROPS) {
    return { ok: false, error: `Map cannot contain more than ${MAX_MAP_PROPS} props.` };
  }

  const props = [];
  const migratedWater = [];
  for (const prop of value.props) {
    if (prop?.type === "lake") {
      const point = normalizePoint(prop, width, height);
      if (!point) return { ok: false, error: "Map prop coordinates are outside the world." };
      migratedWater.push({ type: "water", width: 110, points: [point] });
      continue;
    }
    if (!prop || typeof prop !== "object" || !Object.hasOwn(MAP_PROP_TYPES, prop.type)) {
      return { ok: false, error: "Map contains an unknown prop type." };
    }
    const point = normalizePoint(prop, width, height);
    if (!point) {
      return { ok: false, error: "Map prop coordinates are outside the world." };
    }
    props.push({ type: prop.type, ...point });
  }

  const sourceWater = value.water === undefined ? [] : value.water;
  if (!Array.isArray(sourceWater)) return { ok: false, error: "Map water must be an array." };
  const water = migratedWater.map(({ width: pathWidth, points }) => ({
    type: "water",
    paths: [{ width: pathWidth, points, order: 0 }],
    cutouts: [],
  }));
  let pointCount = migratedWater.length;
  let pathCount = migratedWater.length;
  for (const area of sourceWater) {
    if (!area || typeof area !== "object" || !Object.hasOwn(MAP_WATER_TYPES, area.type)) {
      return { ok: false, error: "Map contains an unknown water type." };
    }
    const sourcePaths = Array.isArray(area.paths) ? area.paths : [area];
    if (sourcePaths.length === 0) return { ok: false, error: "Water areas must contain paths." };
    const paths = [];
    for (const sourcePath of sourcePaths) {
      if (!Number.isFinite(sourcePath.width) || sourcePath.width < 8 || sourcePath.width > 300) {
        return { ok: false, error: "Water width must be between 8 and 300." };
      }
      if (!Array.isArray(sourcePath.points) || sourcePath.points.length === 0) {
        return { ok: false, error: "Water paths must contain points." };
      }
      const points = [];
      for (const sourcePoint of sourcePath.points) {
        const point = normalizePoint(sourcePoint, width, height);
        if (!point) return { ok: false, error: "Water coordinates are outside the world." };
        points.push(point);
      }
      if (sourcePath.order !== undefined && (!Number.isSafeInteger(sourcePath.order) || sourcePath.order < 0)) {
        return { ok: false, error: "Water path order is invalid." };
      }
      pointCount += points.length;
      paths.push({ width: Math.round(sourcePath.width * 100) / 100, points, order: sourcePath.order ?? 0 });
    }
    pathCount += paths.length;
    if (pathCount > MAX_WATER_STROKES) {
      return { ok: false, error: `Map cannot contain more than ${MAX_WATER_STROKES} water paths.` };
    }
    const cutouts = [];
    for (const sourceCutout of Array.isArray(area.cutouts) ? area.cutouts : []) {
      const point = normalizePoint(sourceCutout, width, height);
      if (!point || !Number.isFinite(sourceCutout.radius) || sourceCutout.radius <= 0 || sourceCutout.radius > 150) {
        return { ok: false, error: "Water cutouts are invalid." };
      }
      if (sourceCutout.order !== undefined && (!Number.isSafeInteger(sourceCutout.order) || sourceCutout.order < 0)) {
        return { ok: false, error: "Water cutout order is invalid." };
      }
      cutouts.push({ ...point, radius: Math.round(sourceCutout.radius * 100) / 100, order: sourceCutout.order ?? 1 });
      pointCount += 1;
    }
    if (pointCount > MAX_WATER_POINTS) {
      return { ok: false, error: `Map cannot contain more than ${MAX_WATER_POINTS} water points.` };
    }
    water.push({ type: normalizeWaterType(area.type), paths, cutouts });
  }

  return { ok: true, world: { width, height, props, water } };
}

export function cloneMapWorld(world) {
  return {
    width: world.width,
    height: world.height,
    props: world.props.map((prop) => ({ ...prop })),
    water: world.water.map((area) => ({
      ...area,
      paths: area.paths.map((path) => ({ ...path, points: path.points.map((point) => ({ ...point })) })),
      cutouts: area.cutouts.map((cutout) => ({ ...cutout })),
    })),
  };
}
