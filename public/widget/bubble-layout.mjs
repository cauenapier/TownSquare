/**
 * Bubble column collision avoidance and proximity emphasis.
 *
 * Each figure's ghost stack is one column anchored above its head. When
 * speakers stand close together those columns overlap, so every frame the
 * columns are swept along the stage axis: overlapping neighbours merge into
 * clusters, each cluster settles on the mean of its anchors (clamped to the
 * stage), and the result lands as a horizontal shift on the column. The live
 * bubble's tail counter-shifts so it keeps pointing at the speaker.
 *
 * Columns also carry a prominence by distance from your own figure: nearby
 * conversation stays full size, far chatter fades and shrinks toward a floor.
 * The solver works with the shrunken widths, so distant clusters pack tighter
 * and shuffle around less — walking toward a group literally brings it into
 * focus. Hovering a character still restores them fully via the tray.
 */

import { clamp } from "./math.mjs";

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 */

/**
 * The reading-experience dials. These govern how a crowded scene packs and how
 * proximity emphasis falls off — exactly the knobs you tune by feel. The live
 * widget runs on the defaults; the dev scene passes overrides so they can be
 * adjusted with sliders and read back off to bake in.
 *
 * @typedef {Object} LayoutConfig
 * @property {number} columnGap Breathing room kept between neighbouring columns.
 * @property {number} edgeMargin Columns never get pushed closer than this to the stage edges.
 * @property {number} nearX Within this distance of your figure (normalized x) bubbles stay full prominence.
 * @property {number} farX Beyond this distance bubbles rest at the floor prominence.
 * @property {number} fadeFloor Opacity floor for the farthest columns — a murmur, never silence.
 * @property {number} scaleFloor Scale floor for the farthest columns.
 */

/** @type {LayoutConfig} */
export const DEFAULT_LAYOUT_CONFIG = {
  columnGap: 10,
  edgeMargin: 10,
  nearX: 0.2,
  farX: 0.29,
  fadeFloor: 0.2,
  scaleFloor: 0.55,
};

/** Minimum proximity opacity in expanded mode — distant chatter stays readable. */
export const FADE_FLOOR_EXPANDED = 0.38;

/**
 * @param {LayoutConfig} [config]
 * @param {boolean} [expanded]
 * @returns {LayoutConfig}
 */
export function layoutConfigFor(config, expanded = false) {
  const base = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  if (!expanded) return base;
  return { ...base, fadeFloor: Math.max(base.fadeFloor, FADE_FLOOR_EXPANDED) };
}

/** The tail's base stays clear of the live bubble's rounded corners by this much. */
const TAIL_INSET = 22;
/** How far the tail's tip can lean past its base toward the speaker. */
const TAIL_TIP_REACH = 56;
/** Shifts smaller than this aren't worth a style write. */
const SHIFT_EPSILON = 0.5;
/** Prominence changes smaller than this aren't worth a style write. */
const PROMINENCE_EPSILON = 0.01;

/**
 * @typedef {Object} Column
 * @property {AvatarView} avatar
 * @property {number} anchor Figure centre in stage px — where the column wants to sit.
 * @property {number} width Visual width in stage px (layout width × prominence scale).
 * @property {number} scale Prominence scale applied to the column.
 */

/**
 * @typedef {Object} Cluster
 * @property {number} width Total width including inner gaps.
 * @property {number} count
 * @property {number} sumIdealLeft Sum of each member's ideal cluster-left; mean gives the spot minimizing displacement.
 * @property {Array<{ column: Column, centerOffset: number }>} items Member columns with centres relative to cluster left.
 */

/**
 * How prominent a speaker is from where you stand: 1 inside NEAR_X, easing
 * down to 0 at FAR_X (smoothstep, so nothing pops while either of you walks).
 *
 * @param {number} x Speaker position, normalized.
 * @param {number} selfX Your figure's position, normalized.
 * @param {LayoutConfig} cfg
 */
function proximity(x, selfX, cfg) {
  const t = clamp((Math.abs(x - selfX) - cfg.nearX) / (cfg.farX - cfg.nearX), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Where this cluster's left edge lands: the displacement-minimizing spot,
 * kept inside the stage. A cluster wider than the stage pins to the left
 * edge; placement then compresses its members to fit (see placeCluster).
 *
 * @param {Cluster} cluster
 * @param {number} minLeft
 * @param {number} maxRight
 */
function clusterLeft(cluster, minLeft, maxRight) {
  const maxLeft = maxRight - cluster.width;
  if (maxLeft < minLeft) return minLeft;
  return clamp(cluster.sumIdealLeft / cluster.count, minLeft, maxLeft);
}

/**
 * Apply final shifts for one cluster. Past the point where the stage can hold
 * every column side by side, non-overlap is unwinnable — so the cluster
 * compresses: member centres squeeze proportionally until the run spans
 * exactly the stage, trading even partial overlap for keeping every bubble
 * visible and near its speaker.
 *
 * @param {Cluster} cluster
 * @param {number} minLeft
 * @param {number} maxRight
 */
function placeCluster(cluster, minLeft, maxRight) {
  const left = clusterLeft(cluster, minLeft, maxRight);
  const span = maxRight - minLeft;
  if (cluster.width <= span) {
    for (const item of cluster.items) {
      applyShift(item.column, left + item.centerOffset - item.column.anchor);
    }
    return;
  }

  // Squeeze centres between the half-widths of the outermost members so the
  // cluster's edges land on the stage edges.
  const { items } = cluster;
  const firstHalf = items[0].column.width / 2;
  const lastHalf = items[items.length - 1].column.width / 2;
  const scale = (span - firstHalf - lastHalf) / Math.max(1, cluster.width - firstHalf - lastHalf);
  for (const item of items) {
    const center = minLeft + firstHalf + (item.centerOffset - firstHalf) * scale;
    applyShift(item.column, center - item.column.anchor);
  }
}

/**
 * Join two adjacent clusters into one, keeping member offsets and the
 * running ideal-left sum consistent.
 *
 * @param {Cluster} a
 * @param {Cluster} b Must sit to the right of `a`.
 * @param {number} gap Breathing room kept between the joined columns.
 * @returns {Cluster}
 */
function mergeClusters(a, b, gap) {
  const offsetDelta = a.width + gap;
  for (const item of b.items) {
    item.centerOffset += offsetDelta;
  }
  return {
    width: a.width + gap + b.width,
    count: a.count + b.count,
    sumIdealLeft: a.sumIdealLeft + b.sumIdealLeft - b.count * offsetDelta,
    items: a.items.concat(b.items),
  };
}

/**
 * Push the resolved shift to the DOM as CSS variables, skipping writes when
 * nothing moved beyond sub-pixel noise.
 *
 * @param {AvatarView} avatar
 * @param {number} shift
 * @param {number} tailShift
 * @param {number} tailTip
 */
function setShiftVars(avatar, shift, tailShift, tailTip) {
  if (Math.abs((avatar.bubbleShift ?? 0) - shift) > SHIFT_EPSILON) {
    avatar.bubbleShift = shift;
    avatar.above.style.setProperty("--bubble-shift", `${shift.toFixed(1)}px`);
  }
  if (Math.abs((avatar.tailShift ?? 0) - tailShift) > SHIFT_EPSILON) {
    avatar.tailShift = tailShift;
    avatar.above.style.setProperty("--tail-shift", `${tailShift.toFixed(1)}px`);
  }
  if (Math.abs((avatar.tailTip ?? 0) - tailTip) > SHIFT_EPSILON) {
    avatar.tailTip = tailTip;
    avatar.above.style.setProperty("--tail-tip", `${tailTip.toFixed(1)}px`);
  }
}

/**
 * Push the column's proximity prominence to the DOM as CSS variables.
 *
 * @param {AvatarView} avatar
 * @param {number} scale
 * @param {number} fade
 */
function setProminenceVars(avatar, scale, fade) {
  if (Math.abs((avatar.bubbleScale ?? 1) - scale) > PROMINENCE_EPSILON) {
    avatar.bubbleScale = scale;
    avatar.above.style.setProperty("--bubble-scale", scale.toFixed(3));
  }
  if (Math.abs((avatar.bubbleFade ?? 1) - fade) > PROMINENCE_EPSILON) {
    avatar.bubbleFade = fade;
    avatar.above.style.setProperty("--bubble-fade", fade.toFixed(3));
  }
}

/**
 * @param {Column} column
 * @param {number} shift
 */
function applyShift(column, shift) {
  const { avatar, scale } = column;
  // The tail must always land on its speaker: its base slides along the
  // bubble's flat bottom, and its tip leans the remaining distance. The
  // column shift itself is bounded by that combined reach, so when the
  // solver wants more, this column yields separation (overlap is handled by
  // speak-order stacking) rather than orphan its bubble from the speaker.
  // Tail movement happens inside the scaled column, so the maths run in
  // pre-scale units.
  const live = avatar.messages[avatar.messages.length - 1];
  let tailShift = 0;
  let tailTip = 0;
  if (live) {
    const reach = Math.max(0, live.el.offsetWidth / 2 - TAIL_INSET);
    const bound = (reach + TAIL_TIP_REACH) * scale;
    shift = clamp(shift, -bound, bound);
    const target = -shift / scale;
    tailShift = clamp(target, -reach, reach);
    tailTip = target - tailShift;
  }
  setShiftVars(avatar, shift, tailShift, tailTip);
}

/**
 * Resolve overlap and proximity prominence for every visible bubble column.
 *
 * Run once per animation frame. Both the live widget loop and the dev scene
 * call this with whatever presences they track; anything shaped
 * `{ x, avatar }` works.
 *
 * @param {HTMLElement} stage
 * @param {Iterable<{ x: number, avatar: AvatarView }>} presences
 * @param {number} selfX Your figure's position, normalized — the focus point.
 * @param {Partial<LayoutConfig>} [config] Tuning overrides; defaults fill the rest.
 */
export function layoutBubbleColumns(stage, presences, selfX, config) {
  const cfg = config ? { ...DEFAULT_LAYOUT_CONFIG, ...config } : DEFAULT_LAYOUT_CONFIG;
  const stageWidth = stage.clientWidth;
  if (!stageWidth) return;

  /** @type {Array<Column>} */
  const columns = [];
  for (const presence of presences) {
    const { avatar } = presence;
    // Expiring bubbles are out of `messages` but still fading in the DOM, so
    // visibility is judged by children: keep their column pinned until they
    // finish, and re-centre the empty column for the next fresh line.
    if (avatar.above.childElementCount === 0) {
      setShiftVars(avatar, 0, 0, 0);
      continue;
    }
    const width = avatar.above.offsetWidth;
    if (!width) continue;

    const prominence = proximity(presence.x, selfX, cfg);
    const scale = cfg.scaleFloor + (1 - cfg.scaleFloor) * prominence;
    setProminenceVars(avatar, scale, cfg.fadeFloor + (1 - cfg.fadeFloor) * prominence);
    columns.push({ avatar, anchor: presence.x * stageWidth, width: width * scale, scale });
  }
  if (columns.length === 0) return;

  columns.sort((a, b) => a.anchor - b.anchor);

  const minLeft = cfg.edgeMargin;
  const maxRight = stageWidth - cfg.edgeMargin;

  // Classic 1D label placement: seed one cluster per column, and while a new
  // cluster would overlap the one before it, merge them. Each merge re-centres
  // the group on the mean of its anchors, which can cascade further left.
  /** @type {Array<Cluster>} */
  const clusters = [];
  for (const column of columns) {
    /** @type {Cluster} */
    let cluster = {
      width: column.width,
      count: 1,
      sumIdealLeft: column.anchor - column.width / 2,
      items: [{ column, centerOffset: column.width / 2 }],
    };
    while (clusters.length > 0) {
      const previous = clusters[clusters.length - 1];
      const previousRight = clusterLeft(previous, minLeft, maxRight) + previous.width;
      if (previousRight + cfg.columnGap <= clusterLeft(cluster, minLeft, maxRight)) break;
      cluster = mergeClusters(/** @type {Cluster} */ (clusters.pop()), cluster, cfg.columnGap);
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    placeCluster(cluster, minLeft, maxRight);
  }
}
