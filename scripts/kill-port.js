"use strict";

const { execSync } = require("child_process");

const port = Number(process.env.PORT || process.argv[2] || 8787);

function findPidsOnUnix() {
  try {
    const output = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    return output ? output.split("\n").map((pid) => Number(pid)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function findPidsOnWindows() {
  const output = execSync("netstat -ano", { encoding: "utf8" });
  const pids = new Set();
  const portToken = `:${port}`;

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(portToken) || !/LISTENING/i.test(line)) continue;
    const pid = Number(line.trim().split(/\s+/).at(-1));
    if (pid) pids.add(pid);
  }

  return [...pids];
}

function findPids() {
  if (process.platform === "win32") return findPidsOnWindows();
  return findPidsOnUnix();
}

function killPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`stopped pid ${pid} on port ${port}`);
  } catch (err) {
    if (err.code !== "ESRCH") {
      console.warn(`could not stop pid ${pid}: ${err.message}`);
    }
  }
}

for (const pid of findPids()) {
  killPid(pid);
}
