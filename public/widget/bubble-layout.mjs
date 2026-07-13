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
 * @typedef {import("./avatar.mjs").AvatarView} AvatarView
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

/** Breathing room kept between neighbouring name tags. */
const LABEL_GAP = 6;
/** Name tags never get pushed closer than this to the stage edges. */
const LABEL_EDGE = 6;
/** Stage width at/below which distant name tags fade hardest (crowded phones). */
const LABEL_FADE_NARROW = 360;
/** Stage width at/above which name tags barely fade (there's room to read all). */
const LABEL_FADE_WIDE = 700;
/** Opacity floor for the farthest tags on the narrowest stages. */
const LABEL_FADE_FLOOR_MIN = 0.25;
/** Opacity floor for the farthest tags on wide stages — essentially no fade. */
const LABEL_FADE_FLOOR_MAX = 0.92;
/** The tail's base stays clear of the live bubble's rounded corners by this much. */
const TAIL_INSET = 22;
/** How far the tail's tip can lean past its base toward the speaker. */
const TAIL_TIP_REACH = 56;
/** Shifts smaller than this aren't worth a style write. */
const SHIFT_EPSILON = 0.5;
/** Prominence changes smaller than this aren't worth a style write. */
const PROMINENCE_EPSILON = 0.01;

/**
 * Keep the wider history tray inside the same stage bounds as speech bubbles.
 * The tray width is measured up front (see `measurePresences`) so this stays a
 * write-only step.
 *
 * @param {AvatarView} avatar
 * @param {number} anchor
 * @param {number} minLeft
 * @param {number} maxRight
 * @param {number} width Pre-measured `tray.offsetWidth`.
 */
function placeTray(avatar, anchor, minLeft, maxRight, width) {
  if (!width) return;
  const halfWidth = Math.min(width / 2, (maxRight - minLeft) / 2);
  const shift = clamp(anchor, minLeft + halfWidth, maxRight - halfWidth) - anchor;
  if (Math.abs((avatar.trayShift ?? 0) - shift) <= SHIFT_EPSILON) return;
  avatar.trayShift = shift;
  avatar.tray.style.setProperty("--tray-shift", `${shift.toFixed(1)}px`);
}

/**
 * @typedef {Object} Column
 * @property {AvatarView} avatar
 * @property {number} anchor Figure centre in stage px — where the column wants to sit.
 * @property {number} width Visual width in stage px (layout width × prominence scale).
 * @property {number} scale Prominence scale applied to the column.
 * @property {number} [liveWidth] Pre-measured live-bubble width in px (bubble columns only).
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
 * exactly the stage, trading even partial overlap for keeping every item
 * visible and near its speaker.
 *
 * @param {Cluster} cluster
 * @param {number} minLeft
 * @param {number} maxRight
 * @param {(column: Column, shift: number) => void} apply
 */
function placeCluster(cluster, minLeft, maxRight, apply) {
  const left = clusterLeft(cluster, minLeft, maxRight);
  const span = maxRight - minLeft;
  if (cluster.width <= span) {
    for (const item of cluster.items) {
      apply(item.column, left + item.centerOffset - item.column.anchor);
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
    apply(item.column, center - item.column.anchor);
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
 * Resolve adjacent overlaps by seeding one cluster per column, merging any
 * cluster that collides with the previous one, then applying final shifts.
 *
 * @param {Array<Column>} columns
 * @param {{ minLeft: number, maxRight: number, gap: number, apply: (column: Column, shift: number) => void }} options
 */
function solveClusters(columns, { minLeft, maxRight, gap, apply }) {
  columns.sort((a, b) => a.anchor - b.anchor);

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
      if (previousRight + gap <= clusterLeft(cluster, minLeft, maxRight)) break;
      cluster = mergeClusters(/** @type {Cluster} */ (clusters.pop()), cluster, gap);
    }
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    placeCluster(cluster, minLeft, maxRight, apply);
  }
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
  const { avatar, scale, liveWidth = 0 } = column;
  // The tail must always land on its speaker: its base slides along the
  // bubble's flat bottom, and its tip leans the remaining distance. The
  // column shift itself is bounded by that combined reach, so when the
  // solver wants more, this column yields separation (overlap is handled by
  // speak-order stacking) rather than orphan its bubble from the speaker.
  // Tail movement happens inside the scaled column, so the maths run in
  // pre-scale units. The live bubble's width is pre-measured (see
  // `measurePresences`) to keep this a write-only step.
  let tailShift = 0;
  let tailTip = 0;
  if (liveWidth) {
    const reach = Math.max(0, liveWidth / 2 - TAIL_INSET);
    const bound = (reach + TAIL_TIP_REACH) * scale;
    shift = clamp(shift, -bound, bound);
    const target = -shift / scale;
    tailShift = clamp(target, -reach, reach);
    tailTip = target - tailShift;
  }
  setShiftVars(avatar, shift, tailShift, tailTip);
}

/**
 * @typedef {Object} MeasuredPresence
 * @property {AvatarView} avatar
 * @property {number} x Speaker position, normalized.
 * @property {number} anchor Figure centre in stage px.
 * @property {number} trayWidth Measured history-tray width.
 * @property {boolean} hasBubble Whether the bubble column has any children.
 * @property {number} aboveWidth Measured speech-column width.
 * @property {number} liveWidth Measured live-bubble width (0 when none).
 * @property {number} belowWidth Measured name-tag width (0 when hidden).
 */

/**
 * The single DOM-read pass. Reading every width up front — with no interleaved
 * style writes — lets the browser satisfy all reads from one layout, instead of
 * forcing a reflow each time a read follows a write. The write passes
 * (`applyBubbleColumns` / `applyNameLabels`) only set transforms and opacity,
 * neither of which changes these measured widths, so the two phases are
 * equivalent to the old interleaved code minus the per-avatar reflows.
 *
 * @param {Iterable<{ x: number, avatar: AvatarView }>} presences
 * @param {number} stageWidth
 * @returns {Array<MeasuredPresence>}
 */
function measurePresences(presences, stageWidth) {
  /** @type {Array<MeasuredPresence>} */
  const measured = [];
  for (const presence of presences) {
    const { avatar } = presence;
    const live = avatar.messages[avatar.messages.length - 1];
    const belowWidth = avatar.below ? avatar.below.offsetWidth : 0;
    const profileWidth = avatar.profileForm && !avatar.profileForm.hidden ? avatar.profileForm.offsetWidth : 0;
    measured.push({
      avatar,
      x: presence.x,
      anchor: presence.x * stageWidth,
      trayWidth: avatar.tray.offsetWidth,
      // Expiring bubbles are out of `messages` but still fading in the DOM, so
      // visibility is judged by children: keep the column pinned until they
      // finish, and re-centre the empty column for the next fresh line.
      hasBubble: avatar.above.childElementCount > 0,
      aboveWidth: avatar.above.offsetWidth,
      liveWidth: live ? live.el.offsetWidth : 0,
      belowWidth: Math.max(belowWidth, profileWidth),
    });
  }
  return measured;
}

/**
 * Write pass for the speech-bubble columns: proximity prominence plus overlap
 * de-confliction, from pre-measured widths.
 *
 * @param {Array<MeasuredPresence>} measured
 * @param {number} selfX
 * @param {LayoutConfig} cfg
 * @param {number} stageWidth
 */
function applyBubbleColumns(measured, selfX, cfg, stageWidth) {
  const minLeft = cfg.edgeMargin;
  const maxRight = stageWidth - cfg.edgeMargin;

  /** @type {Array<Column>} */
  const columns = [];
  for (const m of measured) {
    placeTray(m.avatar, m.anchor, minLeft, maxRight, m.trayWidth);
    if (!m.hasBubble) {
      setShiftVars(m.avatar, 0, 0, 0);
      continue;
    }
    if (!m.aboveWidth) continue;

    const prominence = proximity(m.x, selfX, cfg);
    const scale = cfg.scaleFloor + (1 - cfg.scaleFloor) * prominence;
    setProminenceVars(m.avatar, scale, cfg.fadeFloor + (1 - cfg.fadeFloor) * prominence);
    columns.push({ avatar: m.avatar, anchor: m.anchor, width: m.aboveWidth * scale, scale, liveWidth: m.liveWidth });
  }
  if (columns.length === 0) return;

  solveClusters(columns, {
    minLeft,
    maxRight,
    gap: cfg.columnGap,
    apply: applyShift,
  });
}

/**
 * Push the resolved name-tag shift to the DOM, skipping sub-pixel-noise writes.
 *
 * @param {AvatarView} avatar
 * @param {number} shift
 */
function setLabelShift(avatar, shift) {
  if (!avatar.below) return;
  if (Math.abs((avatar.labelShift ?? 0) - shift) <= SHIFT_EPSILON) return;
  avatar.labelShift = shift;
  avatar.below.style.setProperty("--label-shift", `${shift.toFixed(1)}px`);
}

/**
 * Push the resolved name-tag opacity to the DOM, skipping noise writes.
 *
 * @param {AvatarView} avatar
 * @param {number} fade
 */
function setLabelFade(avatar, fade) {
  if (!avatar.below) return;
  if (Math.abs((avatar.labelFade ?? 1) - fade) <= PROMINENCE_EPSILON) return;
  avatar.labelFade = fade;
  avatar.below.style.setProperty("--label-fade", fade.toFixed(3));
}

/**
 * De-conflict the always-visible name tags so none — including your own —
 * covers another. Same 1D cluster solver as the speech-bubble columns, but over
 * the figures' name-tag widths, written as a `--label-shift` on each `below`.
 *
 * Distant tags also fade toward an opacity floor (like the bubble columns), so
 * a crowded narrow stage stays legible — you focus on who's near you, and the
 * unavoidable overlap of far tags recedes instead of fighting for attention. On
 * wide stages the floor stays high, so there's effectively no fade.
 *
 * Invoked by layoutStage after its shared measurement pass.
 *
 * @param {Array<MeasuredPresence>} measured
 * @param {number} selfX
 * @param {LayoutConfig} cfg
 * @param {number} stageWidth
 */
function applyNameLabels(measured, selfX, cfg, stageWidth) {
  const minLeft = LABEL_EDGE;
  const maxRight = stageWidth - LABEL_EDGE;

  // Narrow stages fade distant tags hard; wide stages keep the floor near 1.
  const widthT = clamp((stageWidth - LABEL_FADE_NARROW) / (LABEL_FADE_WIDE - LABEL_FADE_NARROW), 0, 1);
  const fadeFloor = LABEL_FADE_FLOOR_MIN + (LABEL_FADE_FLOOR_MAX - LABEL_FADE_FLOOR_MIN) * widthT;

  /** @type {Array<Column>} */
  const columns = [];
  for (const m of measured) {
    const prominence = proximity(m.x, selfX, cfg);
    setLabelFade(m.avatar, fadeFloor + (1 - fadeFloor) * prominence);
    // A tag hidden via CSS (display:none) measures 0 — leave it un-shifted.
    if (!m.belowWidth) {
      setLabelShift(m.avatar, 0);
      continue;
    }
    columns.push({ avatar: m.avatar, anchor: m.anchor, width: m.belowWidth, scale: 1 });
  }
  if (columns.length === 0) return;

  solveClusters(columns, {
    minLeft,
    maxRight,
    gap: LABEL_GAP,
    apply: (column, shift) => setLabelShift(column.avatar, shift),
  });
}

/**
 * Lay out both speech bubbles and name tags for one frame in a single
 * measure-then-write cycle: every width is read up front, then both passes
 * write their transforms/opacity with no intervening reads. This keeps the
 * frame to one layout flush instead of one per read-after-write, which is the
 * dominant cost in a busy scene (see review G1).
 *
 * The per-frame hot path: `config` is expected to already carry every dial
 * (the loop passes `layoutConfigFor` output), so this takes it as-is rather
 * than re-spreading defaults every frame (review D1). The single fresh merge in
 * `layoutConfigFor` is deliberate — the dev scene mutates its tuning object in
 * place, and re-reading it each frame is what makes the sliders live.
 *
 * @param {HTMLElement} stage
 * @param {Iterable<{ x: number, avatar: AvatarView }>} presences
 * @param {number} selfX Your figure's position, normalized — the focus point.
 * @param {LayoutConfig} [config] Complete config (from `layoutConfigFor`); defaults when omitted.
 */
export function layoutStage(stage, presences, selfX, config) {
  const cfg = config || DEFAULT_LAYOUT_CONFIG;
  const stageWidth = stage.clientWidth;
  if (!stageWidth) return;

  const measured = measurePresences(presences, stageWidth);
  applyBubbleColumns(measured, selfX, cfg, stageWidth);
  applyNameLabels(measured, selfX, cfg, stageWidth);
}
