import { normalizeAbsoluteOrigin } from "./url.mjs";

/**
 * Derive every known relationship involving one site from the site registry.
 * This is intentionally a read model: the saved outgoing connections remain
 * the sole source of truth, and no visitor/referral tracking is introduced.
 */
export function buildNeighbourhood(currentSite, sites) {
  const allSites = Array.from(sites || []);
  const siteByOrigin = new Map();
  const originsFor = (site) => (
    Array.isArray(site.allowedOrigins) && site.allowedOrigins.length > 0
      ? site.allowedOrigins
      : [site.origin]
  );

  for (const site of allSites) {
    for (const origin of originsFor(site)) {
      const normalized = normalizeAbsoluteOrigin(origin);
      if (normalized && !siteByOrigin.has(normalized)) siteByOrigin.set(normalized, site);
    }
  }

  const currentOrigins = new Set(
    originsFor(currentSite)
      .map(normalizeAbsoluteOrigin)
      .filter(Boolean),
  );
  const relationships = new Map();

  const knownRelationship = (site) => {
    const key = `site:${site.siteKey}`;
    if (!relationships.has(key)) {
      relationships.set(key, {
        siteKey: site.siteKey,
        name: site.name,
        url: site.origin,
        known: true,
        verified: Boolean(site.verifiedAt),
        enabled: !site.disabled,
        lastObservedAt: site.lastSeenAt || site.verifiedAt || null,
        incoming: false,
        outgoing: false,
      });
    }
    return relationships.get(key);
  };

  for (const connection of currentSite.connections || []) {
    const normalized = normalizeAbsoluteOrigin(connection?.url);
    if (!normalized || currentOrigins.has(normalized)) continue;

    const target = siteByOrigin.get(normalized);
    if (target && target.siteKey !== currentSite.siteKey) {
      knownRelationship(target).outgoing = true;
      continue;
    }

    const key = `url:${normalized}`;
    if (!relationships.has(key)) {
      relationships.set(key, {
        siteKey: null,
        name: connection.label || normalized,
        url: connection.url,
        known: false,
        verified: false,
        enabled: false,
        lastObservedAt: null,
        incoming: false,
        outgoing: true,
      });
    }
  }

  for (const site of allSites) {
    if (site.siteKey === currentSite.siteKey) continue;
    const connectsHere = (site.connections || []).some((connection) => (
      currentOrigins.has(normalizeAbsoluteOrigin(connection?.url))
    ));
    if (connectsHere) knownRelationship(site).incoming = true;
  }

  const connections = Array.from(relationships.values()).map((relationship) => ({
    siteKey: relationship.siteKey,
    name: relationship.name,
    url: relationship.url,
    state: relationship.incoming && relationship.outgoing
      ? "mutual"
      : relationship.incoming ? "incoming" : "outgoing",
    known: relationship.known,
    verified: relationship.verified,
    enabled: relationship.enabled,
    lastObservedAt: relationship.lastObservedAt,
  })).sort((left, right) => {
    const order = { mutual: 0, incoming: 1, outgoing: 2 };
    return order[left.state] - order[right.state]
      || left.name.localeCompare(right.name);
  });

  return {
    summary: {
      mutual: connections.filter((connection) => connection.state === "mutual").length,
      incoming: connections.filter((connection) => connection.state === "incoming").length,
      outgoing: connections.filter((connection) => connection.state === "outgoing").length,
    },
    connections,
  };
}
