"use strict";

const WEATHER_KINDS = ["clear", "rain", "snow", "storm"];
const DEFAULT_DISTRIBUTION = Object.freeze({ clear: 58, rain: 17, snow: 17, storm: 8 });

function defaultWeatherConfig() {
  return { mode: "automatic", weather: "clear", distribution: { ...DEFAULT_DISTRIBUTION } };
}

function normalizeWeatherConfig(input) {
  const mode = String(input?.mode || "");
  const weather = String(input?.weather || "");
  if (mode !== "automatic" && mode !== "permanent") return { error: "Choose automatic or permanent weather." };
  if (!WEATHER_KINDS.includes(weather)) return { error: "Choose a valid permanent weather." };

  const distribution = {};
  for (const kind of WEATHER_KINDS) {
    const value = input?.distribution?.[kind];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      return { error: "Each weather percentage must be a whole number from 0 to 100." };
    }
    distribution[kind] = value;
  }
  if (Object.values(distribution).reduce((sum, value) => sum + value, 0) !== 100) {
    return { error: "Weather percentages must add up to 100%." };
  }
  return { value: { mode, weather, distribution } };
}

function createWeatherPlugin() {
  return {
    name: "weather",
    label: "Weather",
    description: "Add shared ambient weather to your square.",
    adminModule: "/plugins/weather/admin.mjs",
    adminActions: {
      update({ setData }, input) {
        const result = normalizeWeatherConfig(input);
        if (result.error) return result;
        setData(result.value);
      },
    },
    extendWidgetConfig(config, { data }) {
      return { ...config, weatherConfig: data || defaultWeatherConfig() };
    },
    extendAdminPanel(panel, { data }) {
      return { ...panel, plugins: { ...panel.plugins, weather: data || defaultWeatherConfig() } };
    },
  };
}

module.exports = { WEATHER_KINDS, DEFAULT_DISTRIBUTION, defaultWeatherConfig, normalizeWeatherConfig, createWeatherPlugin };
