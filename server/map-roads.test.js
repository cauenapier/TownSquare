const test = require("node:test");
const assert = require("node:assert/strict");

const modulePromise = Promise.all([
  import("../public/map/map-connections.mjs"),
  import("../public/map/map-roads.mjs"),
]);

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
