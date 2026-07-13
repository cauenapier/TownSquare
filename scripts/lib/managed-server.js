"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(origin, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`managed server did not become healthy at ${origin}`);
}

async function startManagedServer({
  dataPrefix = "townsquare-test-",
  env = {},
  captureOutput = false,
} = {}) {
  const port = await findFreePort();
  const host = "127.0.0.1";
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), dataPrefix));
  const httpOrigin = `http://${host}:${port}`;
  const extraEnv = typeof env === "function" ? env({ host, port, dataDir, httpOrigin }) : env;
  const output = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server.js")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      DATA_DIR: dataDir,
      ALLOWED_ORIGINS: httpOrigin,
      ...extraEnv,
    },
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });

  child.stdout?.on("data", (chunk) => { output.stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { output.stderr += String(chunk); });

  const cleanup = async (signal = "SIGTERM") => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(httpOrigin);
  } catch (error) {
    await cleanup("SIGKILL");
    const detail = captureOutput ? `\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}` : "";
    throw new Error(`${error.message}${detail}`);
  }

  return {
    child,
    dataDir,
    port,
    httpOrigin,
    wsOrigin: `ws://${host}:${port}`,
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    cleanup,
  };
}

module.exports = { findFreePort, startManagedServer, waitForHealth };
