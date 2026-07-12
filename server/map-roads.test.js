const test = require("node:test");
const assert = require("node:assert/strict");

const modulePromise = Promise.all([
  import("../public/map/map-connections.mjs"),
  import("../public/map/map-roads.mjs"),
  import("../public/map/map-scenery.mjs"),
  import("../public/lib/map-world.mjs"),
  import("../public/map/map-water.mjs"),
  import("../shared/map-world.mjs"),
]);

test("overlapping water paths merge into one area", async () => {
  const [, , , , { mergeOverlappingWaterAreas }] = await modulePromise;
  const area = (x) => ({ type: "water", paths: [{ width: 40, points: [{ x, y: 100 }] }], cutouts: [] });
  const merged = mergeOverlappingWaterAreas([area(100), area(125), area(400)]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].paths.length, 2);
  assert.equal(merged[1].paths.length, 1);
});

test("water validation migrates strokes and preserves local cutouts", async () => {
  const [, , , { validateMapWorld }, , { validateMapWorld: validateSharedMapWorld }] = await modulePromise;
  const world = {
    width: 1800,
    height: 1200,
    props: [],
    water: [
      { type: "water", width: 40, points: [{ x: 100, y: 100 }] },
      {
        type: "water",
        paths: [{ width: 80, points: [{ x: 300, y: 300 }, { x: 400, y: 300 }] }],
        cutouts: [{ x: 350, y: 300, radius: 20 }],
      },
    ],
  };
  const result = validateMapWorld(world);
  const sharedResult = validateSharedMapWorld(world);

  assert.equal(result.ok, true);
  assert.deepEqual(sharedResult, result);
  assert.deepEqual(result.world.water[0], {
    type: "water",
    paths: [{ width: 40, points: [{ x: 100, y: 100 }], order: 0 }],
    cutouts: [],
  });
  assert.deepEqual(result.world.water[1].cutouts, [{ x: 350, y: 300, radius: 20, order: 1 }]);
});

test("map world accepts 2,000 props as its safety limit", async () => {
  const [, , , { MAX_MAP_PROPS, validateMapWorld }] = await modulePromise;
  const props = Array.from({ length: MAX_MAP_PROPS }, (_, index) => ({
    type: "tree",
    x: index % 1800,
    y: index % 1200,
  }));

  assert.equal(MAX_MAP_PROPS, 2000);
  assert.equal(validateMapWorld({ width: 1800, height: 1200, props, water: [] }).ok, true);
  assert.equal(validateMapWorld({ width: 1800, height: 1200, props: [...props, props[0]], water: [] }).ok, false);
});

test("scenery batches props into three paths", async () => {
  const [, , { sceneryPropPaths }] = await modulePromise;
  const paths = sceneryPropPaths([
    { type: "tree", x: 10, y: 20 },
    { type: "tree", x: 30, y: 40 },
    { type: "mountain", x: 50, y: 60 },
  ]);

  assert.equal(paths.treeCrowns.match(/M/g).length, 2);
  assert.equal(paths.treeTrunks.match(/M/g).length, 2);
  assert.equal(paths.mountains.match(/M/g).length, 2);
});

function connectedSites(count) {
  return Array.from({ length: count }, (_, index) => ({
    siteKey: `site-${index}`,
    origin: `https://site-${index}.example`,
    messageCount: 20,
    connections: Array.from({ length: count }, (_, target) => target === index ? null : ({ url: `https://site-${target}.example` })).filter(Boolean),
  }));
}

test("map edges derive stable road hierarchy from town degree and direction", async () => {
  const [{ buildMapEdges }] = await modulePromise;
  assert.ok(buildMapEdges(connectedSites(6)).every((edge) => edge.kind === "major" && edge.traffic === 5));
  assert.ok(buildMapEdges(connectedSites(4)).every((edge) => edge.kind === "local" && edge.traffic === 3));

  const oneWay = [
    { siteKey: "a", origin: "https://a.example", connections: [{ url: "https://b.example" }] },
    { siteKey: "b", origin: "https://b.example", connections: [] },
  ];
  assert.equal(buildMapEdges(oneWay)[0].kind, "trail");
});

test("fallback road curves are stable for the connected town IDs", async () => {
  const [{ mapEdgePath }] = await modulePromise;
  const from = { x: 100, y: 100 };
  const to = { x: 700, y: 300 };
  assert.equal(mapEdgePath(from, to, 28, "a|b"), mapEdgePath(from, to, 28, "a|b"));
  assert.notEqual(mapEdgePath(from, to, 28, "a|b"), mapEdgePath(from, to, 28, "a|c"));
});

test("terrain routing trims town endpoints and bends around a forest", async () => {
  const [, { routeMapRoads }] = await modulePromise;
  const sites = [
    { siteKey: "west", messageCount: 20 },
    { siteKey: "east", messageCount: 20 },
  ];
  const edge = { fromKey: "west", toKey: "east", bidirectional: true, kind: "minor" };
  const positions = new Map([
    ["west", { x: 200, y: 600 }],
    ["east", { x: 1600, y: 600 }],
  ]);
  const emptyWorld = { width: 1800, height: 1200, props: [], water: [] };
  const forestWorld = { ...emptyWorld, props: [{ type: "tree", x: 900, y: 648 }] };
  const direct = routeMapRoads([edge], sites, positions, emptyWorld).get("west|east");
  const diverted = routeMapRoads([edge], sites, positions, forestWorld).get("west|east");

  assert.notEqual(diverted, direct);
  const [, startX, startY] = diverted.match(/^M ([\d.]+) ([\d.]+)/).map(Number);
  const [, endX, endY] = diverted.match(/L ([\d.]+) ([\d.]+)$/).map(Number);
  assert.ok(Math.hypot(startX - 200, startY - 600) >= 24);
  assert.ok(Math.hypot(endX - 1600, endY - 600) >= 24);
  assert.match(diverted, / Q /);
});
