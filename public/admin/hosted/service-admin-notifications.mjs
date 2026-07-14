import { createStatusSetter, postJson } from "./hosted-common.mjs";

export function createServiceAdminNotifications(getPassword) {
  const form = document.getElementById("send-notification-form");
  const messageInput = document.getElementById("notification-message");
  const submitButton = document.getElementById("send-notification-btn");
  const status = createStatusSetter(
    document.getElementById("send-notification-status"),
    { toggleHidden: true },
  );
  const recentList = document.getElementById("recent-notifications-list");

  async function load() {
    const response = await postJson("/api/service-admin/notifications/stats", {
      password: getPassword(),
    });
    if (!response.ok) return;

    recentList.replaceChildren();
    if (response.body.recent.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hosted-note";
      empty.textContent = "No notifications sent yet.";
      recentList.append(empty);
      return;
    }

    for (const notification of response.body.recent) {
      const row = document.createElement("div");
      row.className = "notification-row";

      const message = document.createElement("div");
      message.className = "notification-row-message";
      message.textContent = notification.message;

      const meta = document.createElement("div");
      meta.className = "notification-row-meta";
      const created = document.createElement("div");
      created.textContent = new Date(notification.createdAt).toLocaleString();
      const reads = document.createElement("div");
      reads.textContent = `${notification.read}/${notification.total} read`;
      meta.append(created, reads);

      row.append(message, meta);
      recentList.append(row);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message) {
      status("Message is required", true);
      return;
    }

    submitButton.disabled = true;
    status("Sending to all sites...");
    const response = await postJson("/api/service-admin/notifications/send", {
      password: getPassword(),
      message,
    });
    submitButton.disabled = false;

    if (!response.ok) {
      status(response.body.error || "Failed to send notifications", true);
      return;
    }

    messageInput.value = "";
    status(`Sent to ${response.body.sitesNotified} sites`);
    setTimeout(() => status(""), 3000);
    await load();
  });

  return { load };
}
