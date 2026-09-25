"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Keep the public source modules editable while serving the stable embed URL as
// one browser module. A failed build falls back to the original module graph,
// so an unavailable bundler cannot take the realtime server offline.
function createWidgetAssetTransform(publicDir) {
  const entryPath = path.join(publicDir, "townsquare.mjs");
  const cssPath = path.join(publicDir, "widget.css");
  const tokensPath = path.join(publicDir, "tokens.css");
  const rootDir = path.dirname(publicDir);
  let bundle = null;
  let sourceStamps = null;
  let lastError = "";

  const stamp = (filePath) => {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  };

  function bundledModule(fallback) {
    try {
      if (bundle && sourceStamps && [...sourceStamps].every(([file, value]) => stamp(file) === value)) {
        return bundle;
      }
      // Rebuild on a source change in local development. The metafile includes
      // transitive imports, so edits below public/widget/ also invalidate it.
      const { buildSync } = require("esbuild");
      const result = buildSync({
        absWorkingDir: rootDir,
        entryPoints: [entryPath],
        bundle: true,
        format: "esm",
        target: "es2022",
        minify: true,
        legalComments: "none",
        metafile: true,
        write: false,
      });
      bundle = Buffer.from(result.outputFiles[0].contents);
      sourceStamps = new Map(Object.keys(result.metafile.inputs)
        .map((file) => {
          const absolute = path.resolve(rootDir, file);
          return [absolute, stamp(absolute)];
        }));
      lastError = "";
      return bundle;
    } catch (error) {
      const message = String(error);
      if (message !== lastError) console.error("Widget bundle unavailable; serving source modules:", error);
      lastError = message;
      bundle = null;
      sourceStamps = null;
      return fallback;
    }
  }

  return (filePath, body) => {
    if (filePath === entryPath) return bundledModule(body);
    if (filePath !== cssPath) return body;
    try {
      const source = body.toString("utf8");
      const importRule = '@import url("./tokens.css");';
      if (!source.includes(importRule)) return body;
      // This is the only import in widget.css. Combining it here removes its
      // serial request while leaving /tokens.css for older cached stylesheets.
      return Buffer.from(source.replace(importRule, fs.readFileSync(tokensPath, "utf8")));
    } catch (error) {
      console.error("Could not inline widget tokens; serving original stylesheet:", error);
      return body;
    }
  };
}

module.exports = { createWidgetAssetTransform };
