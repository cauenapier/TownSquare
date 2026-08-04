"use strict";

const { registerPlugin } = require("../server/plugins");
const { createCampfirePlugin } = require("./campfire");
const { createTelegramNotificationsPlugin } = require("./telegram-notifications");
const { createSoccerBallPlugin } = require("./soccer-ball");
const { createWeatherPlugin } = require("./weather");

function readLimit(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function registerPublicPlugins(env = process.env, logger = console) {
  // Build each plugin lazily so a throw constructing one doesn't prevent the
  // others from registering. registerPlugin also throws on an invalid plugin
  // shape; isolating each registration keeps a single bad plugin from taking
  // down server boot (which, under systemd Restart=always, becomes a crash loop).
  const factories = [
    () => createTelegramNotificationsPlugin({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      maxPerMinute: readLimit("TELEGRAM_MAX_NOTIFICATIONS_PER_MIN", 20, env),
    }),
    () => createCampfirePlugin(),
    () => createSoccerBallPlugin(),
    () => createWeatherPlugin(),
  ];

  for (const factory of factories) {
    try {
      registerPlugin(factory());
    } catch (error) {
      logger.error?.("Skipping plugin that failed to register", error);
    }
  }
}

module.exports = { registerPublicPlugins };
