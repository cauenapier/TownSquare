"use strict";

const { registerPlugin } = require("../server/plugins");
const { createTelegramNotificationsPlugin } = require("./telegram-notifications");

function registerPublicPlugins(env = process.env) {
  registerPlugin(createTelegramNotificationsPlugin({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  }));
}

module.exports = { registerPublicPlugins };
