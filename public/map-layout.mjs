const SITE_LAYOUT = {
  edgeInset: 150,
  centerPull: 0.10,
  spread: 1.34,
  collisionPadding: 8,
  separationPasses: 140,
};

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildAgeRanks(sites) {
  const ranks = new Map();
  const sorted = [...sites].sort((left, right) => {
    const ageDelta = (Number(left.verifiedAt) || 0) - (Number(right.verifiedAt) || 0);
    return ageDelta || left.siteKey.localeCompare(right.siteKey);
  });
  const divisor = Math.max(1, sorted.length - 1);
  sorted.forEach((site, index) => ranks.set(site.siteKey, sorted.length === 1 ? 1 : index / divisor));
  return ranks;
}

function clampPosition(position, width, height) {
  const inset = SITE_LAYOUT.edgeInset;
  return {
    x: Math.max(inset, Math.min(width - inset, position.x)),
    y: Math.max(inset, Math.min(height - inset, position.y)),
  };
}

function initialPosition(site, ageRank, width, height) {
  const hash = hashString(site.siteKey);
  const angle = (hash % 6283) / 1000;
  const band = 0.26 + ((hash >>> 8) % 44) / 100;
  const drift = ((hash >>> 20) % 1000) / 1000;
  const x = 240 + ((hash % 1320) + drift * 120) % 1320;
  const y = 190 + Math.abs(Math.sin(angle)) * 620 + band * 160;
  const centerX = width / 2;
  const centerY = height / 2;
  const pull = SITE_LAYOUT.centerPull * ageRank;
  return clampPosition({
    x: centerX + (x + (centerX - x) * pull - centerX) * SITE_LAYOUT.spread,
    y: centerY + (y + (centerY - y) * pull - centerY) * SITE_LAYOUT.spread,
  }, width, height);
}

function collisionPush(siteA, siteB, posA, posB) {
  const rx = Math.max(32, Math.max(76, siteA.name.length * 8.2) * 0.52)
    + Math.max(32, Math.max(76, siteB.name.length * 8.2) * 0.52)
    + SITE_LAYOUT.collisionPadding;
  const ry = 116 + SITE_LAYOUT.collisionPadding;
  let dx = posB.x - posA.x;
  let dy = posB.y - posA.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    const angle = (hashString(`${siteA.siteKey}|${siteB.siteKey}`) % 6283) / 1000;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  const metric = (dx / rx) ** 2 + (dy / ry) ** 2;
  if (metric >= 1) return null;
  const scale = 1 / Math.sqrt(metric);
  return { dx: (scale - 1) * dx / 2, dy: (scale - 1) * dy / 2 };
}

export function layoutMapSites(sites, width, height) {
  const ranks = buildAgeRanks(sites);
  const positions = new Map(sites.map((site) => [
    site.siteKey,
    initialPosition(site, ranks.get(site.siteKey) ?? 0, width, height),
  ]));
  const anchors = new Map([...positions].map(([key, position]) => [key, { ...position }]));

  for (let pass = 0; pass < SITE_LAYOUT.separationPasses; pass += 1) {
    for (let index = 0; index < sites.length; index += 1) {
      for (let other = index + 1; other < sites.length; other += 1) {
        const left = positions.get(sites[index].siteKey);
        const right = positions.get(sites[other].siteKey);
        const push = collisionPush(sites[index], sites[other], left, right);
        if (!push) continue;
        left.x -= push.dx;
        left.y -= push.dy;
        right.x += push.dx;
        right.y += push.dy;
      }
    }
    for (const site of sites) {
      const position = positions.get(site.siteKey);
      const anchor = anchors.get(site.siteKey);
      position.x += (anchor.x - position.x) * 0.05;
      position.y += (anchor.y - position.y) * 0.05;
      Object.assign(position, clampPosition(position, width, height));
    }
  }
  return positions;
}
