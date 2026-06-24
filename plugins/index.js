"use strict";

const { registerPlugin } = require("../server/plugins");
const { createTelegramNotificationsPlugin } = require("./telegram-notifications");
const { createSoccerBallPlugin } = require("./soccer-ball");

function readLimit(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function registerPublicPlugins(env = process.env) {
  registerPlugin(createTelegramNotificationsPlugin({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    maxPerMinute: readLimit("TELEGRAM_MAX_NOTIFICATIONS_PER_MIN", 20, env),
  }));
  registerPlugin(createSoccerBallPlugin());
}

module.exports = { registerPublicPlugins };
