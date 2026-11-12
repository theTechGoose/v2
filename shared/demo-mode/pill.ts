/**
 * REQ-228 — where the demo pills go so they never cover the page (demo issue
 * pointer-and-replica-side-effects-m4).
 *
 * The customer's pill is one line and sits in the first slot of the screen with no control under
 * it: the four corners first (bottom-left, the old place, leads), then down the left and right
 * edges from the bottom up. A clear current slot is kept (no hopping); when nothing is clear the
 * slot with the fewest controls under it wins. The staff stage keeps the frame out of the band its
 * own pill measures (its height, its offset from the bottom, a gap) instead of a guessed 76 px.
 */
import type { Rect } from "./protocol.ts";

export type Corner = "bl" | "br" | "tl" | "tr";
/** bottom-left (where the pill always was) first */
export const PILL_CORNERS: readonly Corner[] = ["bl", "br", "tl", "tr"];
/** the pill's distance from the screen's edges */
export const PILL_MARGIN = 12;
/** at or below this width the customer's pill shows only its status and End (details on tap) */
export const PILL_COMPACT_MAX_W = 640;
/** what counts as a control of the page: a pill on top of one of these is in the way */
export const CONTROL_SELECTOR =
  'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';

type Size = { w: number; h: number };

/** the pill's box at a corner of the view, a margin in from both edges */
export function cornerRect(
  corner: Corner,
  view: Size,
  pill: Size,
  margin = PILL_MARGIN,
): Rect {
  const left = corner[1] === "l" ? margin : view.w - margin - pill.w;
  const top = corner[0] === "t" ? margin : view.h - margin - pill.h;
  return { left, top, width: pill.w, height: pill.h };
}

/** every place the pill may go, best first: the corners, then the side edges from the bottom up */
export function pillSlots(
  view: Size,
  pill: Size,
  margin = PILL_MARGIN,
): Rect[] {
  const out = PILL_CORNERS.map((c) => cornerRect(c, view, pill, margin));
  const step = Math.max(8, Math.round(pill.h / 2));
  const lowest = view.h - margin - pill.h;
  for (let top = lowest - step; top > margin; top -= step) {
    out.push({ left: margin, top, width: pill.w, height: pill.h });
    out.push({
      left: view.w - margin - pill.w,
      top,
      width: pill.w,
      height: pill.h,
    });
  }
  return out;
}

/** a grid of points over a box, edges included, a little inside them (to ask what is under it) */
export function samplePoints(
  r: Rect,
  cols = 5,
  rows = 3,
): { x: number; y: number }[] {
  const pad = Math.min(2, r.width / 4, r.height / 4);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      pts.push({
        x: r.left + pad + ((r.width - 2 * pad) * i) / Math.max(1, cols - 1),
        y: r.top + pad + ((r.height - 2 * pad) * j) / Math.max(1, rows - 1),
      });
    }
  }
  return pts;
}

/** the slot to use: the current box while it is clear, else the first clear slot, else the fewest */
export function pickPillSlot(
  current: Rect | null,
  slots: Rect[],
  blocked: (r: Rect) => number,
): Rect {
  let best: Rect | null = null;
  let bestN = Infinity;
  if (current) {
    const n = blocked(current);
    if (n === 0) return current;
    best = current;
    bestN = n;
  }
  for (const s of slots) {
    const n = blocked(s);
    if (n === 0) return s;
    if (n < bestN) {
      best = s;
      bestN = n;
    }
  }
  return best ?? slots[0];
}

/** keep a remembered box on the screen after a resize */
export function clampRect(r: Rect, view: Size, margin = PILL_MARGIN): Rect {
  const maxLeft = Math.max(margin, view.w - margin - r.width);
  const maxTop = Math.max(margin, view.h - margin - r.height);
  return {
    ...r,
    left: Math.min(Math.max(margin, r.left), maxLeft),
    top: Math.min(Math.max(margin, r.top), maxTop),
  };
}

/** the stage pill's distance from the bottom of the window */
export const STAGE_PILL_BOTTOM = 14;
/** air between the frame and the stage pill */
export const STAGE_PILL_GAP = 10;
/** the band under the frame before the pill has been measured */
const STAGE_INSET_FALLBACK = 76;

/** REQ-228 — the room the stage keeps under the frame: what its pill really takes */
export function stageInsetBottom(pillH: number): number {
  return pillH > 0
    ? Math.ceil(pillH) + STAGE_PILL_BOTTOM + STAGE_PILL_GAP
    : STAGE_INSET_FALLBACK;
}
