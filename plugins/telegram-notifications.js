"use strict";

const TELEGRAM_API_TIMEOUT_MS = 5000;

function escapeMarkdown(text) {
  return String(text || "").replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function buildMessage({ site, visitor, message }) {
  const siteLabel = site ? `${site.name} (${site.origin})` : "default scene";
  return [
    "*TownSquare message*",
    `Site: ${escapeMarkdown(siteLabel)}`,
    `Visitor: ${escapeMarkdown(String(visitor.id))}`,
    `Browser: ${escapeMarkdown(visitor.browserId)}`,
    `At: ${escapeMarkdown(new Date(message.at).toISOString())}`,
    "",
    escapeMarkdown(message.text),
  ].join("\n");
}

function createNotificationBudget(maxPerMinute) {
  let windowStart = 0;
  let windowCount = 0;

  return function allowNotification(now = Date.now()) {
    if (maxPerMinute <= 0) return true;
    if (now - windowStart >= 60000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= maxPerMinute) return false;
    windowCount += 1;
    return true;
  };
}

function createTelegramNotificationsPlugin({ botToken = "", chatId = "", maxPerMinute = 20 } = {}) {
  const token = String(botToken).trim();
  const target = String(chatId).trim();
  const allowNotification = createNotificationBudget(maxPerMinute);

  return {
    name: "telegram-notifications",
    onMessage(event) {
      if (!token || !target) return;
      const at = event.message?.at;
      if (!allowNotification(typeof at === "number" ? at : Date.now())) return;
      void sendNotification(token, target, event);
    },
  };
}

async function sendNotification(token, chatId, event) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildMessage(event),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) console.warn(`Telegram notification failed with ${response.status}`);
  } catch (error) {
    console.warn(`Telegram notification failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { createTelegramNotificationsPlugin };
