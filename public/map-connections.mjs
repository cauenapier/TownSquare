import { normalizeAbsoluteOrigin } from "./shared/url.mjs";

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
  return edges;
}

export function mapEdgePath(from, to, inset = 28) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const start = { x: from.x + (dx / length) * inset, y: from.y + (dy / length) * inset };
  const end = { x: to.x - (dx / length) * inset, y: to.y - (dy / length) * inset };
  const pathDx = end.x - start.x;
  const pathDy = end.y - start.y;
  const pathLength = Math.hypot(pathDx, pathDy) || 1;
  const bend = Math.min(140, pathLength * 0.22);
  const controlX = (start.x + end.x) / 2 - (pathDy / pathLength) * bend;
  const controlY = (start.y + end.y) / 2 + (pathDx / pathLength) * bend;
  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
}
