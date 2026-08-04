const test = require("node:test");
const assert = require("node:assert/strict");

const editorPromise = import("../public/admin/hosted/map-editor-core.mjs");

function emptyWorld() {
  return { width: 1800, height: 1200, props: [], water: [] };
}

test("water can be erased again after repainting over an old cutout", async () => {
  const { applyMapBrush, createMapGesture } = await editorPromise;
  const world = emptyWorld();

  let gesture = createMapGesture(world);
  applyMapBrush(world, gesture, { tool: "water", brushSize: 100, treeDensity: 1 }, { x: 500, y: 500 });
  gesture = createMapGesture(world);
  assert.equal(
    applyMapBrush(world, gesture, { tool: "erase", brushSize: 60, treeDensity: 1 }, { x: 500, y: 500 }).changed,
    true,
  );

  gesture = createMapGesture(world);
  applyMapBrush(world, gesture, { tool: "water", brushSize: 100, treeDensity: 1 }, { x: 500, y: 500 });
  gesture = createMapGesture(world);
  assert.equal(
    applyMapBrush(world, gesture, { tool: "erase", brushSize: 60, treeDensity: 1 }, { x: 500, y: 500 }).changed,
    true,
  );
  assert.equal(world.water.flatMap((area) => area.cutouts).length, 2);
  assert.deepEqual(
    world.water.flatMap((area) => area.paths.concat(area.cutouts)).map((item) => item.order),
    [1, 2, 3, 4],
  );
});

test("eraser sampling skips pointer events inside the same brush dab", async () => {
  const { applyMapBrush, createMapGesture } = await editorPromise;
  const world = emptyWorld();
  world.water.push({
    type: "water",
    paths: [{ width: 100, points: [{ x: 500, y: 500 }], order: 0 }],
    cutouts: [],
  });
  const gesture = createMapGesture(world);
  const brush = { tool: "erase", brushSize: 80, treeDensity: 1 };

  assert.equal(applyMapBrush(world, gesture, brush, { x: 500, y: 500 }).changed, true);
  assert.equal(applyMapBrush(world, gesture, brush, { x: 502, y: 501 }).changed, false);
  assert.equal(world.water[0].cutouts.length, 1);
});
