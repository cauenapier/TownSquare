const test = require("node:test");
const assert = require("node:assert/strict");

const modulePromise = import("../public/lib/neighbourhood.mjs");

test("neighbourhood derives mutual, incoming, outgoing, and site availability", async () => {
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
    verifiedAt: 10,
    lastSeenAt: 20,
    connections: [{ url: "https://www.home.example/hello" }],
  };
  const incoming = {
    siteKey: "incoming",
    name: "Incoming Town",
    origin: "https://incoming.example",
    disabled: true,
    verifiedAt: 30,
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
  assert.equal(neighbourhood.connections[0].lastObservedAt, 20);
  assert.equal(neighbourhood.connections[0].verified, true);
  assert.equal(neighbourhood.connections[0].enabled, true);
  assert.equal(neighbourhood.connections[1].enabled, false);
  assert.equal(neighbourhood.connections[2].known, false);
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
  assert.equal(neighbourhood.connections[0].siteKey, "town");
});
