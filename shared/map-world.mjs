export const MAP_WORLD_MIN_WIDTH = 1800;
export const MAP_WORLD_MIN_HEIGHT = 1200;
export const MAP_WORLD_MAX_WIDTH = 5400;
export const MAP_WORLD_MAX_HEIGHT = 3600;
export const MAP_WORLD_GROWTH_REF_SITES = 25;

/** @deprecated Use MAP_WORLD_MIN_WIDTH */
export const MAP_WORLD_WIDTH = MAP_WORLD_MIN_WIDTH;
/** @deprecated Use MAP_WORLD_MIN_HEIGHT */
export const MAP_WORLD_HEIGHT = MAP_WORLD_MIN_HEIGHT;

export const MAX_MAP_PROPS = 1000;
export const MAX_WATER_STROKES = 200;
export const MAX_WATER_POINTS = 5000;

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
  if (sourceWater.length + migratedWater.length > MAX_WATER_STROKES) {
    return { ok: false, error: `Map cannot contain more than ${MAX_WATER_STROKES} water strokes.` };
  }

  const water = [...migratedWater];
  let pointCount = migratedWater.length;
  for (const stroke of sourceWater) {
    if (!stroke || typeof stroke !== "object" || !Object.hasOwn(MAP_WATER_TYPES, stroke.type)) {
      return { ok: false, error: "Map contains an unknown water type." };
    }
    if (!Number.isFinite(stroke.width) || stroke.width < 8 || stroke.width > 300) {
      return { ok: false, error: "Water width must be between 8 and 300." };
    }
    if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
      return { ok: false, error: "Water strokes must contain points." };
    }
    const points = [];
    for (const sourcePoint of stroke.points) {
      const point = normalizePoint(sourcePoint, width, height);
      if (!point) return { ok: false, error: "Water coordinates are outside the world." };
      points.push(point);
    }
    pointCount += points.length;
    if (pointCount > MAX_WATER_POINTS) {
      return { ok: false, error: `Map cannot contain more than ${MAX_WATER_POINTS} water points.` };
    }
    water.push({
      type: normalizeWaterType(stroke.type),
      width: Math.round(stroke.width * 100) / 100,
      points,
    });
  }

  return { ok: true, world: { width, height, props, water } };
}

export function cloneMapWorld(world) {
  return {
    width: world.width,
    height: world.height,
    props: world.props.map((prop) => ({ ...prop })),
    water: world.water.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
  };
}
