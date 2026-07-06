export function mountainPath(x, y) {
  return `M${x - 44} ${y + 46} L${x} ${y - 42} L${x + 48} ${y + 46} M${x - 10} ${y - 20} L${x + 7} ${y + 3} L${x + 21} ${y - 16}`;
}

export function treeCrownPath(x, y) {
  return `M${x} ${y - 31} C${x - 24} ${y - 12} ${x - 18} ${y + 10} ${x} ${y + 8} C${x + 24} ${y + 10} ${x + 28} ${y - 14} ${x} ${y - 31} Z`;
}

export function treeTrunkPath(x, y) {
  return `M${x} ${y + 8} L${x} ${y + 31}`;
}
