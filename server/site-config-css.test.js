"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("buildSiteCss anchors the ground split to --ts-ground-offset, not a fixed percentage", async () => {
  const modulePath = pathToFileURL(
    path.join(__dirname, "..", "public", "shared", "site-config-core.mjs"),
  ).href;
  const { buildSiteCss } = await import(modulePath);

  const css = buildSiteCss();

  // Regression guard: this gradient is a second, hand-maintained copy of the
  // one in widget.css (this is the CSS hosted sites paste into their own
  // page). It used to hardcode a 72%/72.4% split tuned only for the default
  // 180px stage, which drifted from the actual ground line (a fixed px
  // offset from the stage's bottom edge) whenever the stage was a different
  // height — e.g. expanded/fullscreen view.
  assert.ok(
    css.includes("calc(100% - var(--ts-ground-offset, 52px))"),
    "expected the sky/ground split to be anchored to --ts-ground-offset",
  );
  assert.ok(
    !/\b72%|\b72\.4%/.test(css),
    "the sky/ground split must not hardcode a fixed percentage",
  );

  // Every --ts-ground-offset reference must carry the 52px fallback. This
  // snippet is pasted onto host pages that can still be serving a browser-cached
  // older widget.css without the variable; without the fallback an undefined var
  // invalidates the whole gradient and the sky/ground colors stop painting.
  const bareRefs = css.match(/var\(--ts-ground-offset\)/g);
  assert.equal(
    bareRefs,
    null,
    "every --ts-ground-offset reference must include the 52px fallback",
  );
});
