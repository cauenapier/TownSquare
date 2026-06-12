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

/**
 * @typedef {import("./dom.mjs").AvatarView} AvatarView
 */

/** Breathing room kept between neighbouring columns. */
const COLUMN_GAP = 10;
/** Columns never get pushed closer than this to the stage edges. */
const EDGE_MARGIN = 8;
/** The tail's base stays clear of the live bubble's rounded corners by this much. */
const TAIL_INSET = 22;
/** How far the tail's tip can lean past its base toward the speaker. */
const TAIL_TIP_REACH = 56;
/** Shifts smaller than this aren't worth a style write. */
const SHIFT_EPSILON = 0.5;
/** Prominence changes smaller than this aren't worth a style write. */
const PROMINENCE_EPSILON = 0.01;

/** Within this distance of your figure (normalized x) bubbles stay full prominence. */
const NEAR_X = 0.08;
/** Beyond this distance bubbles rest at the floor prominence. */
const FAR_X = 0.4;
/** Opacity floor for the farthest columns — a murmur, never silence. */
const FADE_FLOOR = 0.3;
/** Scale floor for the farthest columns. */
const SCALE_FLOOR = 0.75;

/**
 * @typedef {Object} Column
 * @property {AvatarView} avatar
 * @property {number} anchor Figure centre in stage px — where the column wants to sit.
 * @property {number} width Visual width in stage px (layout width × prominence scale).
 * @property {number} scale Prominence scale applied to the column.
 * @property {number} fade Prominence opacity for the column.
 * @property {number} liveHalfWidth Measured half-width of the live bubble in px.
 */

/**
 * @typedef {Object} Cluster
 * @property {number} width Total width including inner gaps.
 * @property {number} count
 * @property {number} sumIdealLeft Sum of each member's ideal cluster-left; mean gives the spot minimizing displacement.
 * @property {Array<{ column: Column, centerOffset: number }>} items Member columns with centres relative to cluster left.
 */

/**
 * @typedef {Object} ShiftResult
 * @property {number} shift
 * @property {number} tailShift
 * @property {number} tailTip
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * How prominent a speaker is from where you stand: 1 inside NEAR_X, easing
 * down to 0 at FAR_X (smoothstep, so nothing pops while either of you walks).
 *
 * @param {number} x Speaker position, normalized.
 * @param {number} selfX Your figure's position, normalized.
 */
function proximity(x, selfX) {
  const t = clamp((Math.abs(x - selfX) - NEAR_X) / (FAR_X - NEAR_X), 0, 1);
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
 * @returns {ShiftResult}
 */
function computeShift(column, shift) {
  const { scale, liveHalfWidth } = column;
  let tailShift = 0;
  let tailTip = 0;
  if (liveHalfWidth > 0) {
    const reach = Math.max(0, liveHalfWidth - TAIL_INSET);
    const bound = (reach + TAIL_TIP_REACH) * scale;
    shift = clamp(shift, -bound, bound);
    const target = -shift / scale;
    tailShift = clamp(target, -reach, reach);
    tailTip = target - tailShift;
  }
  return { shift, tailShift, tailTip };
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
 * @param {Map<AvatarView, ShiftResult>} shifts
 */
function placeCluster(cluster, minLeft, maxRight, shifts) {
  const left = clusterLeft(cluster, minLeft, maxRight);
  const span = maxRight - minLeft;
  if (cluster.width <= span) {
    for (const item of cluster.items) {
      shifts.set(
        item.column.avatar,
        computeShift(item.column, left + item.centerOffset - item.column.anchor),
      );
    }
    return;
  }

  const { items } = cluster;
  const firstHalf = items[0].column.width / 2;
  const lastHalf = items[items.length - 1].column.width / 2;
  const scale = (span - firstHalf - lastHalf) / Math.max(1, cluster.width - firstHalf - lastHalf);
  for (const item of items) {
    const center = minLeft + firstHalf + (item.centerOffset - firstHalf) * scale;
    shifts.set(item.column.avatar, computeShift(item.column, center - item.column.anchor));
  }
}

/**
 * Join two adjacent clusters into one, keeping member offsets and the
 * running ideal-left sum consistent.
 *
 * @param {Cluster} a
 * @param {Cluster} b Must sit to the right of `a`.
 * @returns {Cluster}
 */
function mergeClusters(a, b) {
  const offsetDelta = a.width + COLUMN_GAP;
  for (const item of b.items) {
    item.centerOffset += offsetDelta;
  }
  return {
    width: a.width + COLUMN_GAP + b.width,
    count: a.count + b.count,
    sumIdealLeft: a.sumIdealLeft + b.sumIdealLeft - b.count * offsetDelta,
    items: a.items.concat(b.items),
  };
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
 */
export function layoutBubbleColumns(stage, presences, selfX) {
  const stageWidth = stage.clientWidth;
  if (!stageWidth) return;

  /** @type {AvatarView[]} */
  const emptyAvatars = [];
  /** @type {Array<{ presence: { x: number, avatar: AvatarView }, aboveWidth: number, liveHalfWidth: number }>} */
  const measured = [];

  for (const presence of presences) {
    const { avatar } = presence;
    if (avatar.above.childElementCount === 0) {
      emptyAvatars.push(avatar);
      continue;
    }
    const aboveWidth = avatar.above.offsetWidth;
    if (!aboveWidth) continue;
    const live = avatar.messages[avatar.messages.length - 1];
    measured.push({
      presence,
      aboveWidth,
      liveHalfWidth: live ? live.el.offsetWidth / 2 : 0,
    });
  }

  /** @type {Array<Column>} */
  const columns = [];
  for (const { presence, aboveWidth, liveHalfWidth } of measured) {
    const prominence = proximity(presence.x, selfX);
    const scale = SCALE_FLOOR + (1 - SCALE_FLOOR) * prominence;
    columns.push({
      avatar: presence.avatar,
      anchor: presence.x * stageWidth,
      width: aboveWidth * scale,
      scale,
      fade: FADE_FLOOR + (1 - FADE_FLOOR) * prominence,
      liveHalfWidth,
    });
  }

  /** @type {Map<AvatarView, ShiftResult>} */
  const shifts = new Map();
  for (const avatar of emptyAvatars) {
    shifts.set(avatar, { shift: 0, tailShift: 0, tailTip: 0 });
  }

  if (columns.length > 0) {
    columns.sort((a, b) => a.anchor - b.anchor);

    const minLeft = EDGE_MARGIN;
    const maxRight = stageWidth - EDGE_MARGIN;

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
        if (previousRight + COLUMN_GAP <= clusterLeft(cluster, minLeft, maxRight)) break;
        cluster = mergeClusters(/** @type {Cluster} */ (clusters.pop()), cluster);
      }
      clusters.push(cluster);
    }

    for (const cluster of clusters) {
      placeCluster(cluster, minLeft, maxRight, shifts);
    }
  }

  for (const column of columns) {
    setProminenceVars(column.avatar, column.scale, column.fade);
  }
  for (const [avatar, result] of shifts) {
    setShiftVars(avatar, result.shift, result.tailShift, result.tailTip);
  }
}
