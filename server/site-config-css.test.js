"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// The sky/ground are two flat colors, painted in one place: widget.css (gated on
// [data-townsquare-surface], which the widget sets for host embeds). A hosted
// site pastes only the palette *tokens* from buildSiteCss — it never repaints
// the stage. These tests guard both halves of that split of responsibility.
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

test("buildSiteCss emits palette tokens only, never repaints the stage", async () => {
  const { buildSiteCss } = await import(
    pathToFileURL(path.join(__dirname, "..", "public", "lib", "site-config-core.mjs")).href
  );
  const css = buildSiteCss();

  // The pasted snippet sets the palette tokens the widget paints from...
  assert.match(css, /--scene:/, "buildSiteCss must set the --scene token");
  assert.match(css, /--ground-fill:/, "buildSiteCss must set the --ground-fill token");
  assert.match(css, /--ground-line:/, "buildSiteCss must set the --ground-line token");

  // ...including the pre-rename alias names, so a freshly re-copied snippet
  // still colors visitors whose browsers hold a cached pre-rename widget.css
  // (which paints var(--page) / var(--ground) directly).
  assert.match(css, /--page:/, "buildSiteCss must keep emitting the legacy --page alias");
  assert.match(css, /--ground:\s/, "buildSiteCss must keep emitting the legacy --ground alias");

  // ...but never the paint itself: no stage/ground rules, no gradient, and no
  // dependency on --ts-ground-offset (the paint lives solely in widget.css, so a
  // stale cached widget.css can never leave the pasted snippet half-applied).
  assert.doesNotMatch(css, /\.townsquare__stage/, "the pasted snippet must not repaint the stage");
  assert.doesNotMatch(css, /\.townsquare__ground/, "the pasted snippet must not repaint the ground");
  assert.doesNotMatch(css, /linear-gradient/, "the pasted snippet must not paint a gradient");
  assert.doesNotMatch(css, /--ts-ground-offset/, "the pasted snippet must not depend on --ts-ground-offset");
});

test("widget.css paints the sky/ground as flat colors", async () => {
  const widgetCss = fs.readFileSync(
    path.join(__dirname, "..", "public", "widget.css"),
    "utf8",
  );
  const stage = "[data-townsquare-surface] .townsquare__stage";
  const ground = "[data-townsquare-surface] .townsquare__ground";

  // Flat colors, not a gradient: sky = --scene fill (a bare token, so definitionally
  // not a gradient), ground band = --ground-fill with a --ground-line top border,
  // each falling back to its pre-rename name so CSS pasted before the rename
  // keeps painting. Guards against a regression back to the gradient split and
  // against dropping the legacy fallbacks.
  assert.equal(extractDecl(widgetCss, stage, "background"), "var(--scene)", "the sky must be a flat --scene fill");
  assert.equal(extractDecl(widgetCss, ground, "background"), "var(--ground-fill, var(--page))", "the ground band must be a flat --ground-fill fill with the legacy --page fallback");
  assert.equal(extractDecl(widgetCss, ground, "border-top"), "1px solid var(--ground-line, var(--ground))", "the ground line must be the band's top border with the legacy --ground fallback");
});
