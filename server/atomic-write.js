"use strict";

const fs = require("fs");
const path = require("path");

// Atomically write `data` as pretty-printed JSON to `filePath`.
//
// We serialize to a sibling temp file and rename(2) it over the target. rename
// is atomic on the same filesystem, so a crash or disk-full mid-write leaves the
// previous valid file intact rather than a truncated one. The parent directory
// is created if missing. A trailing newline keeps the files diff/editor friendly.
function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmpFile, filePath);
}

module.exports = { atomicWriteJson };
