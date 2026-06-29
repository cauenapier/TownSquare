"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", ".data/**", ".claude/**", "tmp/**"] },

  js.configs.recommended,

  // Node CommonJS: server, scripts, plugins, fixtures, this config.
  {
    files: ["server.js", "server/**/*.js", "scripts/**/*.js", "plugins/**/*.js", "eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
  },

  // Browser ES modules: widget, hosted pages, shared (also imported in Node,
  // but the shared modules only use cross-environment globals).
  {
    files: ["public/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
  },

  // Node ES-module tooling (e.g. the Playwright screenshot harness) that also
  // contains browser-context callbacks (page.evaluate), so it needs both.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    rules: {
      // Catch genuine bugs (undefined references, e.g. a missed import).
      "no-undef": "error",
      // Surface dead bindings without failing the build on every one.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
