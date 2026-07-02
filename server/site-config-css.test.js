"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Sky and ground are two flat colors painted by two deliberately separate
// copies: the live widget via widget.css (gated on [data-townsquare-surface]),
// and a hosted embed via a snippet from buildSiteCss. The two color declarations
// are duplicated on purpose (the pasted snippet can't reference widget.css's own
// selectors), so they must be hand-kept identical. These helpers pull a property
// out of a rule so a test can assert the copies never drift.
function normalize(css) {
  return css.replace(/\s+/g, " ").trim();
}

function extractDecl(css, selectorFragment, prop) {
  // Grab `<prop>: <value>;` from the first rule whose selector contains
  // `selectorFragment`. Plain string scanning (no regex escaping of the
  // selector); rule values contain no braces, so the rule's first `}` after
  // `{` reliably ends the block.
  const selIdx = css.indexOf(selectorFragment);
  assert.ok(selIdx !== -1, `could not find selector "${selectorFragment}"`);
  const braceIdx = css.indexOf("{", selIdx);
  const block = css.slice(braceIdx + 1, css.indexOf("}", braceIdx));
  const propIdx = block.indexOf(`${prop}:`);
  assert.ok(propIdx !== -1, `could not find "${prop}" in rule for "${selectorFragment}"`);
  const after = block.slice(propIdx + prop.length + 1);
  return normalize(after.slice(0, after.indexOf(";")));
}

test("buildSiteCss paints sky/ground as flat colors, not a gradient", async () => {
  const { buildSiteCss } = await import(
    pathToFileURL(path.join(__dirname, "..", "public", "shared", "site-config-core.mjs")).href
  );
  const css = buildSiteCss();

  // The sky/ground split is two flat colors (sky = --scene fill, ground band =
  // --page with a --ground top border), not a linear-gradient. Guard against a
  // regression back to the gradient/percentage approach — and against the pasted
  // snippet depending on --ts-ground-offset (it must not; the band's height
  // lives in widget.css, so the snippet stays robust to a stale widget.css).
  assert.equal(
    extractDecl(css, ".townsquare__stage", "background"),
    "var(--scene)",
    "the pasted sky should be a flat --scene fill",
  );
  assert.ok(!/linear-gradient/.test(css), "the pasted stage/ground must not use a gradient");
  assert.ok(!/--ts-ground-offset/.test(css), "the pasted snippet must not depend on --ts-ground-offset");
  assert.ok(!/\b72%|\b72\.4%/.test(css), "the split must not hardcode a fixed percentage");
});

test("the pasted stage/ground CSS matches the copy painted in widget.css", async () => {
  const { buildSiteCss } = await import(
    pathToFileURL(path.join(__dirname, "..", "public", "shared", "site-config-core.mjs")).href
  );
  const widgetCss = fs.readFileSync(
    path.join(__dirname, "..", "public", "widget.css"),
    "utf8",
  );
  const pastedCss = buildSiteCss();

  // widget.css paints via the surface-gated rule; the pasted CSS via the
  // doubled-id selector. The sky fill, ground fill, and ground line must match.
  const widgetStage = "[data-townsquare-surface] .townsquare__stage";
  const widgetGround = "[data-townsquare-surface] .townsquare__ground";
  assert.equal(
    extractDecl(pastedCss, ".townsquare__stage", "background"),
    extractDecl(widgetCss, widgetStage, "background"),
    "the pasted sky fill has drifted from widget.css — update both copies together",
  );
  assert.equal(
    extractDecl(pastedCss, ".townsquare__ground", "background"),
    extractDecl(widgetCss, widgetGround, "background"),
    "the pasted ground fill has drifted from widget.css — update both copies together",
  );
  assert.equal(
    extractDecl(pastedCss, ".townsquare__ground", "border-top"),
    extractDecl(widgetCss, widgetGround, "border-top"),
    "the pasted ground line has drifted from widget.css — update both copies together",
  );
});
