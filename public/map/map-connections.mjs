import { normalizeAbsoluteOrigin } from "../lib/url.mjs";

export function buildMapEdges(sites) {
  const siteKeyByOrigin = new Map();
  for (const site of sites) {
    const origin = normalizeAbsoluteOrigin(site.origin);
    if (origin && !siteKeyByOrigin.has(origin)) siteKeyByOrigin.set(origin, site.siteKey);
  }

  const outgoingBySiteKey = new Map(sites.map((site) => [site.siteKey, new Set()]));
  for (const site of sites) {
    const outgoing = outgoingBySiteKey.get(site.siteKey);
    for (const connection of site.connections || []) {
      const toKey = siteKeyByOrigin.get(normalizeAbsoluteOrigin(connection.url));
      if (toKey && toKey !== site.siteKey) outgoing.add(toKey);
    }
  }

  const edges = [];
  const seen = new Set();
  for (const [fromKey, outgoing] of outgoingBySiteKey) {
    for (const toKey of outgoing) {
      const edgeKey = [fromKey, toKey].sort().join("|");
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({
        fromKey,
        toKey,
        bidirectional: outgoingBySiteKey.get(toKey)?.has(fromKey) || false,
      });
    }
  }
  const degreeBySiteKey = new Map(sites.map((site) => [site.siteKey, 0]));
  for (const edge of edges) {
    degreeBySiteKey.set(edge.fromKey, degreeBySiteKey.get(edge.fromKey) + 1);
    degreeBySiteKey.set(edge.toKey, degreeBySiteKey.get(edge.toKey) + 1);
  }
  for (const edge of edges) {
    edge.traffic = Math.min(degreeBySiteKey.get(edge.fromKey), degreeBySiteKey.get(edge.toKey));
    edge.kind = !edge.bidirectional ? "trail" : edge.traffic >= 5 ? "major" : edge.traffic >= 3 ? "local" : "minor";
  }
  return edges.sort((left, right) => {
    const trafficDelta = right.traffic - left.traffic;
    return trafficDelta || `${left.fromKey}|${left.toKey}`.localeCompare(`${right.fromKey}|${right.toKey}`);
  });
}

function stableBend(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

export function mapEdgePath(from, to, inset = 28, seed = "") {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const start = { x: from.x + (dx / length) * inset, y: from.y + (dy / length) * inset };
  const end = { x: to.x - (dx / length) * inset, y: to.y - (dy / length) * inset };
  const pathDx = end.x - start.x;
  const pathDy = end.y - start.y;
  const pathLength = Math.hypot(pathDx, pathDy) || 1;
  const bend = Math.min(70, pathLength * 0.15) * stableBend(seed);
  const controlX = (start.x + end.x) / 2 - (pathDy / pathLength) * bend;
  const controlY = (start.y + end.y) / 2 + (pathDx / pathLength) * bend;
  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
}
