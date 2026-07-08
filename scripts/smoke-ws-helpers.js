"use strict";

const crypto = require("crypto");

function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function solveChallenge({ salt, difficulty }) {
  for (let nonce = 0; ; nonce += 1) {
    const digest = crypto.createHash("sha256").update(`${salt}:${nonce}`).digest();
    if (leadingZeroBits(digest) >= difficulty) return String(nonce);
  }
}

function handleSmokeSocketMessage(ws, message, { onHello, onUnexpectedHello, seen }) {
  seen.push(message);
  if (message.type === "challenge") {
    if (typeof message.salt !== "string" || typeof message.difficulty !== "number") {
      throw new Error("invalid bot-protection challenge");
    }
    ws.send(JSON.stringify({ type: "solve", nonce: solveChallenge(message) }));
    return;
  }
  if (message.type === "hello") {
    if (onUnexpectedHello) {
      onUnexpectedHello(message);
      return;
    }
    onHello(message);
  }
}

function withTimeout(promise, timeoutMs, label) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function waitForClose(ws, timeoutMs = 10000) {
  return withTimeout(new Promise((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
  }), timeoutMs, "waitForClose");
}

module.exports = {
  handleSmokeSocketMessage,
  solveChallenge,
  waitForClose,
  withTimeout,
};
