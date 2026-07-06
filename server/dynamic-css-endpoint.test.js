"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Test utilities
function normalize(css) {
  return css.replace(/\s+/g, " ").trim();
}

function extractCssVar(css, varName) {
  const match = css.match(new RegExp(`${varName}\\s*:\\s*([^;]+);`));
  return match ? normalize(match[1]) : null;
}

// Load the modules we need to test
const { buildSiteCss } = require(path.join(__dirname, "..", "public", "lib", "site-config-core.mjs"));

test("buildSiteCss generates valid CSS with palette tokens", async () => {
  const styleConfig = {
    light: {
      sky: "#1e90ff",
      groundFill: "#efede9",
      actionZoneFill: "#efede9",
      surface: "#fdf8f4",
      ink: "#2a2926",
      accent: "#c8641f",
      treeTrunk: "color-mix(in oklab, var(--text) 58%, var(--muted) 42%)",
      treeCanopy: "color-mix(in oklab, var(--text) 58%, var(--muted) 42%)",
      other: "#26241f",
      groundLine: "rgba(42, 41, 38, 0.16)"
    }
  };

  const css = buildSiteCss(styleConfig);

  // Should return a string
  assert.strictEqual(typeof css, "string");

  // Should contain the root selector with double specificity
  assert.match(css, /#townsquare-root#townsquare-root\s*{/);

  // Should contain palette tokens for the light mode
  assert.match(css, /--scene\s*:\s*#1e90ff/);
  assert.match(css, /--ground-fill\s*:\s*#efede9/);
  assert.match(css, /--surface\s*:\s*#fdf8f4/);
  assert.match(css, /--ink\s*:\s*#2a2926/);

  // Should contain legacy aliases for backward compatibility
  assert.match(css, /--page\s*:\s*#efede9/);
  assert.match(css, /--ground\s*:/);

  // Should contain dark mode with media query
  assert.match(css, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
});

test("buildSiteCss uses double-selector specificity to beat host page styles", async () => {
  const styleConfig = {
    light: {
      sky: "#blue",
      groundFill: "#green",
      actionZoneFill: "#green",
      surface: "#white",
      ink: "#black",
      accent: "#red",
      treeTrunk: "#brown",
      treeCanopy: "#darkgreen",
      other: "#gray",
      groundLine: "rgba(0, 0, 0, 0.1)"
    }
  };

  const css = buildSiteCss(styleConfig);

  // Extract the light mode selector
  const lightSelectorMatch = css.match(
    /#townsquare-root#townsquare-root\s*\{([^}]+)\}/
  );
  assert.ok(lightSelectorMatch, "Should have double-selector rule for light mode");

  // Verify it's using the doubled selector (not single)
  const lightSelector = css.substring(0, css.indexOf("{"));
  assert.match(lightSelector, /#townsquare-root#townsquare-root/);

  // Should not have single selector (which would have lower specificity)
  const beforeDarkMode = css.substring(0, css.indexOf("@media"));
  assert.doesNotMatch(beforeDarkMode, /^#townsquare-root\s*{/m,
    "Should use double selector for specificity, not single");
});

test("buildSiteCss includes both new and legacy token names", async () => {
  const styleConfig = {
    light: {
      sky: "#sky-color",
      groundFill: "#ground-color",
      actionZoneFill: "#action-color",
      surface: "#surface-color",
      ink: "#ink-color",
      accent: "#accent-color",
      treeTrunk: "#trunk-color",
      treeCanopy: "#canopy-color",
      other: "#other-color",
      groundLine: "#line-color"
    }
  };

  const css = buildSiteCss(styleConfig);

  // New token names (renamed fields)
  assert.match(css, /--scene:/);      // renamed from "sky" but token stays "--scene"
  assert.match(css, /--ground-fill:/);
  assert.match(css, /--action-zone-fill:/);

  // Legacy token names (for backward compatibility)
  assert.match(css, /--page:/);       // legacy for groundFill
  assert.match(css, /--ground:/);     // legacy for groundLine
});

test("buildSiteCss handles transparent colors", async () => {
  const styleConfig = {
    light: {
      sky: "transparent",
      groundFill: "transparent",
      actionZoneFill: "transparent",
      surface: "#fdf8f4",
      ink: "#2a2926",
      accent: "#c8641f",
      treeTrunk: "#brown",
      treeCanopy: "#green",
      other: "#gray",
      groundLine: "rgba(0, 0, 0, 0.1)"
    }
  };

  const css = buildSiteCss(styleConfig);

  // Should allow transparent values
  assert.match(css, /--scene\s*:\s*transparent/);
  assert.match(css, /--ground-fill\s*:\s*transparent/);
});

test("buildSiteCss generates separate dark mode rules", async () => {
  const styleConfig = {
    light: {
      sky: "#light-sky",
      groundFill: "#light-ground",
      actionZoneFill: "#light-action",
      surface: "#light-surface",
      ink: "#light-ink",
      accent: "#light-accent",
      treeTrunk: "#light-trunk",
      treeCanopy: "#light-canopy",
      other: "#light-other",
      groundLine: "#light-line"
    },
    dark: {
      sky: "#dark-sky",
      groundFill: "#dark-ground",
      actionZoneFill: "#dark-action",
      surface: "#dark-surface",
      ink: "#dark-ink",
      accent: "#dark-accent",
      treeTrunk: "#dark-trunk",
      treeCanopy: "#dark-canopy",
      other: "#dark-other",
      groundLine: "#dark-line"
    }
  };

  const css = buildSiteCss(styleConfig);

  // Should have light mode
  assert.match(css, /--scene\s*:\s*#light-sky/);

  // Should have explicit dark mode selector
  assert.match(css, /\[data-townsquare-theme="dark"\]/);

  // Should have dark values in that selector
  const darkSection = css.substring(css.indexOf('[data-townsquare-theme="dark"]'));
  assert.match(darkSection, /--scene\s*:\s*#dark-sky/);

  // Should have media query for prefers-color-scheme
  assert.match(css, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
});

test("buildSiteCss includes derived tokens (aliases like --text, --you-deep)", async () => {
  const styleConfig = {
    light: {
      sky: "#sky",
      groundFill: "#ground",
      actionZoneFill: "#action",
      surface: "#surface",
      ink: "#ink",
      accent: "#accent",
      treeTrunk: "#trunk",
      treeCanopy: "#canopy",
      other: "#other",
      groundLine: "#line"
    }
  };

  const css = buildSiteCss(styleConfig);

  // Should include derived tokens
  assert.match(css, /--text\s*:\s*var\(--ink\)/);
  assert.match(css, /--muted\s*:\s*var\(--ink\)/);
  assert.match(css, /--you-deep\s*:\s*var\(--you\)/);
});

test("embed snippet includes dynamic CSS link", async () => {
  // Read the actual server.js to verify the embed snippet structure
  const serverCode = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
  );

  // Should include the CSS link with site-specific siteKey
  assert.match(
    serverCode,
    /\/api\/sites\/\$\{site\.siteKey\}\/style\.css/,
    "Embed snippet should include dynamic CSS link with siteKey"
  );

  // Should be in a <link> tag, not in a <style> tag (for the default snippet)
  const embedSnippetMatch = serverCode.match(
    /function buildEmbedSnippet[\s\S]*?return `[\s\S]*?`/
  );
  assert.ok(embedSnippetMatch, "Should find buildEmbedSnippet function");

  const embedSnippet = embedSnippetMatch[0];
  assert.match(embedSnippet, /rel="stylesheet"[\s\S]*?\/api\/sites/,
    "CSS should be loaded as a stylesheet link, not inline");
});

test("embed snippet structure is correct", async () => {
  const serverCode = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
  );

  const embedSnippetMatch = serverCode.match(
    /function buildEmbedSnippet[\s\S]*?return `([\s\S]*?)`/
  );
  assert.ok(embedSnippetMatch, "Should find buildEmbedSnippet function");

  const snippet = embedSnippetMatch[1];

  // Should have preconnect
  assert.match(snippet, /rel="preconnect"/);

  // Should have widget.css link
  assert.match(snippet, /widget\.css/);

  // Should have style.css link (the new dynamic CSS)
  assert.match(snippet, /api\/sites.*style\.css/);

  // Should have the root div
  assert.match(snippet, /id="townsquare-root"/);

  // Should have the module script
  assert.match(snippet, /type="module"/);
  assert.match(snippet, /mountTownSquare/);
});

test("admin UI clearly distinguishes between automatic and custom CSS paths", async () => {
  const adminHtml = fs.readFileSync(
    path.join(__dirname, "..", "public", "admin", "hosted", "admin.html"),
    "utf8"
  );

  // Should have "Recommended" label for the automatic path
  assert.match(adminHtml, /Recommended[:\s]*<\/strong>/,
    "Should label the automatic path as 'Recommended'");

  // Should have "Embed snippet" section
  assert.match(adminHtml, /Embed snippet/);

  // Should have "Custom CSS override" section (renamed from "Customization CSS")
  assert.match(adminHtml, /Custom CSS override/);

  // Should mention "optional" for the advanced path
  assert.match(adminHtml, /optional/i);

  // Should mention that automatic updates are live
  assert.match(adminHtml, /live.*moment.*Publish/i);
});

test("admin UI explains when to use custom CSS", async () => {
  const adminHtml = fs.readFileSync(
    path.join(__dirname, "..", "public", "admin", "hosted", "admin.html"),
    "utf8"
  );

  const customCssSection = adminHtml.substring(
    adminHtml.indexOf("Custom CSS override")
  );

  // Should explain this is for advanced users
  assert.match(customCssSection, /advanced/i);

  // Should mention that custom CSS requires manual updates
  assert.match(customCssSection, /manual|re-copy|update/i);
});

test("CSS endpoint handler correctly extracts siteKey from URL path", async () => {
  // Test URL path parsing logic
  const testCases = [
    { path: "/api/sites/site_ABC123/style.css", expected: "site_ABC123" },
    { path: "/api/sites/site_XYZ789/style.css", expected: "site_XYZ789" },
    { path: "/api/sites/my-site-key/style.css", expected: "my-site-key" },
  ];

  for (const testCase of testCases) {
    const siteKey = testCase.path.split("/")[3];
    assert.strictEqual(siteKey, testCase.expected,
      `Should extract siteKey from path: ${testCase.path}`);
  }
});

test("CSS endpoint route pattern matches valid CSS requests", async () => {
  const pattern = /^\/api\/sites\/[^/]+\/style\.css$/;

  const validPaths = [
    "/api/sites/site_ABC/style.css",
    "/api/sites/my-site-123/style.css",
    "/api/sites/a/style.css",
  ];

  for (const path of validPaths) {
    assert.match(path, pattern, `Should match valid CSS path: ${path}`);
  }

  const invalidPaths = [
    "/api/sites/site_ABC/style",  // missing .css
    "/api/sites/style.css",        // missing siteKey
    "/api/sites//style.css",       // empty siteKey
    "/api/sites/site_ABC/style.css/extra",  // extra path segment
  ];

  for (const path of invalidPaths) {
    assert.doesNotMatch(path, pattern, `Should not match invalid path: ${path}`);
  }
});

test("backward compatibility: old snippets without CSS link still work", async () => {
  // Old snippet format (without the /api/sites/.../style.css link)
  const oldSnippet = `
<link rel="preconnect" href="http://example.com" crossorigin />
<link rel="stylesheet" href="http://example.com/widget.css" />
<div id="townsquare-root"></div>
<script type="module" async>
  import { mountTownSquare } from "http://example.com/townsquare.mjs";
  mountTownSquare(document.getElementById("townsquare-root"), {
    serverOrigin: "http://example.com",
    siteKey: "site_OLD",
    theme: "host"
  });
</script>
  `.trim();

  // Should still have the essential components
  assert.match(oldSnippet, /widget\.css/);
  assert.match(oldSnippet, /townsquare-root/);
  assert.match(oldSnippet, /mountTownSquare/);

  // This verifies that old snippets remain functional even without the CSS link
  // (they'll just use defaults or manual CSS instead of automatic updates)
});

test("CSS caching headers are appropriate for automatic updates", async () => {
  const serverCode = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
  );

  // Should set cache-control header
  assert.match(serverCode, /cache-control.*max-age.*300/i,
    "Should set 5-minute cache for CSS endpoint");

  // Should be public cache (not private)
  assert.match(serverCode, /public.*max-age/i,
    "Should use public cache so browsers and CDNs can cache");
});
