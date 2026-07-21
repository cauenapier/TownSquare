const test = require("node:test");
const assert = require("node:assert/strict");

const modulePromise = import("../public/lib/neighbourhood.mjs");

test("neighbourhood derives mutual, incoming, and outgoing relationships", async () => {
  const { buildNeighbourhood } = await modulePromise;
  const current = {
    siteKey: "home",
    name: "Home",
    origin: "https://home.example",
    allowedOrigins: ["https://home.example", "https://www.home.example"],
    connections: [
      { label: "Mutual", url: "https://mutual.example/a-page" },
      { label: "Elsewhere", url: "https://elsewhere.example/path" },
    ],
  };
  const mutual = {
    siteKey: "mutual",
    name: "Mutual Town",
    origin: "https://mutual.example",
    connections: [{ url: "https://www.home.example/hello" }],
  };
  const incoming = {
    siteKey: "incoming",
    name: "Incoming Town",
    origin: "https://incoming.example",
    connections: [{ url: "https://home.example" }],
  };

  const neighbourhood = buildNeighbourhood(current, [current, mutual, incoming]);

  assert.deepEqual(neighbourhood.summary, { mutual: 1, incoming: 1, outgoing: 1 });
  assert.deepEqual(
    neighbourhood.connections.map(({ name, state }) => ({ name, state })),
    [
      { name: "Mutual Town", state: "mutual" },
      { name: "Incoming Town", state: "incoming" },
      { name: "Elsewhere", state: "outgoing" },
    ],
  );
});

test("neighbourhood ignores self-links and consolidates repeated known-site links", async () => {
  const { buildNeighbourhood } = await modulePromise;
  const current = {
    siteKey: "home",
    name: "Home",
    origin: "https://home.example",
    connections: [
      { label: "Self", url: "https://home.example/about" },
      { label: "Town", url: "https://town.example/one" },
      { label: "Town again", url: "https://town.example/two" },
    ],
  };
  const town = { siteKey: "town", name: "Town", origin: "https://town.example", connections: [] };

  const neighbourhood = buildNeighbourhood(current, [current, town]);

  assert.deepEqual(neighbourhood.summary, { mutual: 0, incoming: 0, outgoing: 1 });
  assert.equal(neighbourhood.connections.length, 1);
  assert.equal(neighbourhood.connections[0].name, "Town");
});

test("reciprocal connection preparation balances sides and rejects duplicates or full signposts", async () => {
  const { prepareReciprocalConnection } = await modulePromise;
  const target = { name: "Incoming", url: "https://incoming.example/path" };
  const draft = [
    { side: "left", label: "Left", url: "https://left.example" },
    { side: "left", label: "Left two", url: "https://left-two.example" },
    { side: "right", label: "Right", url: "https://right.example" },
  ];

  assert.deepEqual(prepareReciprocalConnection(draft, target), {
    connection: { side: "right", label: "Incoming", url: target.url },
  });
  assert.deepEqual(
    prepareReciprocalConnection([...draft, { side: "right", label: "Existing", url: "https://incoming.example/other" }], target),
    { reason: "duplicate" },
  );

  const full = ["left", "right"].flatMap((side) => Array.from({ length: 4 }, (_, index) => ({
    side,
    label: `${side} ${index}`,
    url: `https://${side}-${index}.example`,
  })));
  assert.deepEqual(prepareReciprocalConnection(full, target), { reason: "full" });
  assert.deepEqual(prepareReciprocalConnection([], { name: "Bad", url: "not a URL" }), { reason: "invalid" });
});
