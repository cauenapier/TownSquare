export const MAP_WORLD_WIDTH = 1800;
export const MAP_WORLD_HEIGHT = 1200;
export const MAX_MAP_PROPS = 1000;
export const MAX_WATER_STROKES = 200;
export const MAX_WATER_POINTS = 5000;

export const MAP_PROP_TYPES = Object.freeze({
  mountain: Object.freeze({ brushSpacing: 68 }),
  tree: Object.freeze({ brushSpacing: 30 }),
});
export const MAP_WATER_TYPES = Object.freeze({ lake: true, river: true });

function normalizePoint(point) {
  if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  if (point.x < 0 || point.x > MAP_WORLD_WIDTH || point.y < 0 || point.y > MAP_WORLD_HEIGHT) {
    return null;
  }
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
}

export function validateMapWorld(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Map world must be an object." };
  }
  if (value.width !== MAP_WORLD_WIDTH || value.height !== MAP_WORLD_HEIGHT) {
    return { ok: false, error: `Map dimensions must be ${MAP_WORLD_WIDTH} × ${MAP_WORLD_HEIGHT}.` };
  }
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
      const point = normalizePoint(prop);
      if (!point) return { ok: false, error: "Map prop coordinates are outside the world." };
      migratedWater.push({ type: "lake", width: 110, points: [point] });
      continue;
    }
    if (!prop || typeof prop !== "object" || !Object.hasOwn(MAP_PROP_TYPES, prop.type)) {
      return { ok: false, error: "Map contains an unknown prop type." };
    }
    const point = normalizePoint(prop);
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
      const point = normalizePoint(sourcePoint);
      if (!point) return { ok: false, error: "Water coordinates are outside the world." };
      points.push(point);
    }
    pointCount += points.length;
    if (pointCount > MAX_WATER_POINTS) {
      return { ok: false, error: `Map cannot contain more than ${MAX_WATER_POINTS} water points.` };
    }
    water.push({ type: stroke.type, width: Math.round(stroke.width * 100) / 100, points });
  }

  return { ok: true, world: { width: MAP_WORLD_WIDTH, height: MAP_WORLD_HEIGHT, props, water } };
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
