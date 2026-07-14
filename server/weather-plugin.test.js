"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PluginManager } = require("./plugins");
const { createWeatherPlugin, defaultWeatherConfig, normalizeWeatherConfig } = require("../plugins/weather");

test("weather configuration accepts complete 100 percent distributions", () => {
  assert.deepEqual(
    normalizeWeatherConfig({
      mode: "automatic",
      weather: "clear",
      distribution: { clear: 60, rain: 20, snow: 10, storm: 10 },
    }).value,
    { mode: "automatic", weather: "clear", distribution: { clear: 60, rain: 20, snow: 10, storm: 10 } },
  );
  assert.match(
    normalizeWeatherConfig({ mode: "automatic", weather: "clear", distribution: { clear: 60, rain: 20, snow: 10, storm: 9 } }).error,
    /100/,
  );
});

test("weather plugin is opt-in and supplies its default configuration when enabled", () => {
  const manager = new PluginManager();
  manager.register(createWeatherPlugin());
  assert.deepEqual(manager.browserModules("admin", () => ({ enabled: false })), []);
  assert.equal(manager.extend("extendWidgetConfig", {}, () => ({ enabled: false })).weatherConfig, undefined);
  assert.deepEqual(manager.extend("extendWidgetConfig", {}, () => ({ enabled: true })).weatherConfig, defaultWeatherConfig());
});
