const COMMON_SECOND_LEVEL_DOMAINS = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

export function normalizeAbsoluteOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isIpHostname(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function canFlipWwwHost(hostname) {
  if (!hostname || hostname === "localhost" || isIpHostname(hostname)) return false;
  const bare = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  const labels = bare.split(".").filter(Boolean);
  if (labels.length === 2) return true;
  return labels.length === 3 && COMMON_SECOND_LEVEL_DOMAINS.has(labels[1]);
}

export function getMatchingWwwOrigin(origin) {
  const normalized = normalizeAbsoluteOrigin(origin);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (!canFlipWwwHost(url.hostname)) return null;
    url.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildAllowedOrigins(origin, options = {}) {
  const normalized = normalizeAbsoluteOrigin(origin);
  if (!normalized) return [];

  const origins = [normalized];
  if (options.includeMatchingWww) {
    const matching = getMatchingWwwOrigin(normalized);
    if (matching && matching !== normalized) origins.push(matching);
  }

  const seen = new Set();
  return origins.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function originUsesMatchingWwwPair(origin) {
  const normalized = normalizeAbsoluteOrigin(origin);
  if (!normalized) return false;
  const matching = getMatchingWwwOrigin(normalized);
  return Boolean(matching && matching !== normalized);
}
