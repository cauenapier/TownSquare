const DAY_MS = 24 * 60 * 60 * 1000;
const MAP_FADE_AFTER_DAYS = 30;
const MAP_HIDE_AFTER_DAYS = 60;

function mapSiteLifecycle(site, now = Date.now()) {
  const lastActiveAt = Number(site?.lastSeenAt) || Number(site?.verifiedAt) || now;
  const inactiveMs = Math.max(0, now - lastActiveAt);
  const inactiveDays = Math.floor(inactiveMs / DAY_MS);
  const fadeProgress = Math.max(0, Math.min(1,
    (inactiveMs - MAP_FADE_AFTER_DAYS * DAY_MS)
      / ((MAP_HIDE_AFTER_DAYS - MAP_FADE_AFTER_DAYS) * DAY_MS),
  ));

  const hiddenForInactivity = inactiveMs >= MAP_HIDE_AFTER_DAYS * DAY_MS;

  return {
    inactiveDays,
    inactiveFor30Days: inactiveMs > MAP_FADE_AFTER_DAYS * DAY_MS,
    hiddenForInactivity,
    fadeProgress: hiddenForInactivity ? 1 : Math.min(0.999, Math.round(fadeProgress * 1000) / 1000),
  };
}

module.exports = {
  mapSiteLifecycle,
};
