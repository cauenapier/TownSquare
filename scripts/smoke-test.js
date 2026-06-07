const WebSocket = require("ws");

const SERVER_URL = process.env.TOWNSQUARE_WS_URL || "ws://127.0.0.1:8787/live";

function connect({ x, browserId }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const seen = [];

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "init", x, browserId }));
    });

    ws.on("message", (buffer) => {
      const message = JSON.parse(String(buffer));
      seen.push(message);
      if (message.type === "hello") {
        resolve({ ws, seen, id: message.id, hello: message });
      }
    });

    ws.on("error", reject);
  });
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const first = await connect({ x: 0.25, browserId: "browser-a" });
  const secondSameBrowser = await connect({ x: 0.75, browserId: "browser-a" });

  await delay(100);

  assert(first.id === secondSameBrowser.id, "same-browser tabs did not reuse one shared identity");
  assert(secondSameBrowser.hello.peers.length === 0, "same-browser tab should not see itself as a peer");
  assert(!first.seen.some((message) => message.type === "join"), "same-browser tab incorrectly triggered a join event");

  const third = await connect({ x: 0.62, browserId: "browser-b" });

  await delay(100);

  assert(third.hello.peers.length === 1, "third client should see one existing visitor, not one per tab");
  assert(first.seen.some((message) => message.type === "join" && message.peer.id === third.id), "first client did not observe different-browser join");

  secondSameBrowser.ws.send(JSON.stringify({ type: "move", x: 0.58 }));
  await delay(100);
  secondSameBrowser.ws.send(JSON.stringify({ type: "say", text: "hello from shared browser" }));
  await delay(100);

  assert(first.seen.some((message) => message.type === "move" && message.id === first.id), "same-browser move did not propagate to sibling tab");
  assert(first.seen.some((message) => message.type === "say" && message.id === first.id), "same-browser chat did not propagate to sibling tab");
  assert(third.seen.some((message) => message.type === "move" && message.id === first.id), "different browser did not observe shared visitor movement");
  assert(third.seen.some((message) => message.type === "say" && message.id === first.id), "different browser did not observe shared visitor chat");

  secondSameBrowser.ws.close();
  await delay(100);

  assert(!first.seen.some((message) => message.type === "leave" && message.id === first.id), "closing one same-browser tab incorrectly removed the shared visitor");

  third.ws.close();
  await delay(1700);

  assert(first.seen.some((message) => message.type === "leave" && message.id === third.id), "first client did not observe different-browser leave");

  console.log("Smoke test passed.");
  first.ws.close();
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
