/**
 * REQ-180 — how the demo pointer moves, in pure terms both sides share.
 *
 *   - the SENDER rates its moves with `moveThrottle`: the first of a burst goes at once, the last
 *     goes at the gap's end, nothing in between — so the rest position is never dropped;
 *     MOVE_GAP_DIRECT_MS on the data channel (the screen's rate), MOVE_GAP_RELAY_MS through the
 *     server (gentler on the relay);
 *   - every move carries the sender's clock, and `newerMove` drops one that arrives after a
 *     later one (the lossy channel is unordered);
 *   - the RECEIVER never snaps: `glideStep` moves the drawn pointer a fraction of the way to the
 *     latest target every frame (exponential approach, time constant GLIDE_TAU_MS), which never
 *     overshoots and settles exactly on the target.
 */
export interface Pt {
  x: number;
  y: number;
}

export const MOVE_GAP_DIRECT_MS = 16;
export const MOVE_GAP_RELAY_MS = 66;
export const GLIDE_TAU_MS = 50;
/** within this of the target the pointer is placed on it and the glide stops */
export const GLIDE_SETTLE_PX = 0.3;

export function glideStep(
  shown: Pt,
  target: Pt,
  dtMs: number,
  tau = GLIDE_TAU_MS,
): { at: Pt; settled: boolean } {
  const k = dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tau);
  const x = shown.x + (target.x - shown.x) * k;
  const y = shown.y + (target.y - shown.y) * k;
  const settled = Math.hypot(target.x - x, target.y - y) <= GLIDE_SETTLE_PX;
  return settled
    ? { at: { x: target.x, y: target.y }, settled }
    : { at: { x, y }, settled };
}

/** true when a move stamped `t` is at least as new as the last one seen; an unstamped move always is */
export function newerMove(lastSeen: number, t: number | undefined): boolean {
  return t === undefined || t >= lastSeen;
}

export interface MoveThrottle<T> {
  push(v: T): void;
  cancel(): void;
}

export function moveThrottle<T>(o: {
  gap: () => number;
  send: (v: T) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): MoveThrottle<T> {
  const now = o.now ?? (() => performance.now());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as number));
  let lastSent = -Infinity;
  let pending: { v: T } | null = null;
  let timer: unknown = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const v = pending.v;
    pending = null;
    lastSent = now();
    o.send(v);
  };
  return {
    push(v) {
      const gap = o.gap();
      const t = now();
      if (!timer && t - lastSent >= gap) {
        lastSent = t;
        o.send(v);
        return;
      }
      pending = { v };
      if (!timer) timer = setTimer(flush, Math.max(0, gap - (t - lastSent)));
    },
    cancel() {
      if (timer) clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}

/** REQ-242 — the pointer's name tag rests after this long without a re-placement */
export const TAG_IDLE_MS = 1_500;
/** REQ-374 (demo m9) — a resting tag fades to this, never to 0: the name stays readable */
export const TAG_REST_OPACITY = 0.6;
/** REQ-374 (demo p8) — the arrow is always fully opaque (it read as faint when it dimmed); only
 *  the tag rests */
export function pointerLook(resting: boolean): { arrow: number; tag: number } {
  return { arrow: 1, tag: resting ? TAG_REST_OPACITY : 1 };
}
/** REQ-374 / REQ-437 — the gap between the tag and what it sits beside (the arrow, an element) */
export const TAG_GAP = 6;
/** REQ-543 (demo m6, cycle 4; was REQ-437's 140) — how far from the tip (to the tag's nearest
 *  point) the tag may sit: next to the arrow, never past the far edge of a card or a chip, over
 *  the next control. A side farther than this gives way to the arrow's tail. */
export const TAG_REACH = 40;
/** REQ-543 (demo m6) — the tag stays this far inside the box: never flush against its edge */
export const TAG_EDGE = 4;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** REQ-437 — where the tag went: past an edge of the element pointed at, or under the arrow's
 *  tail ("tail"; above the tip, "tail-up", only where the box's bottom leaves no room) */
export type TagSide = "below" | "above" | "right" | "left" | "tail" | "tail-up";

const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
/** the distance from `p` to the nearest point of `r` */
const reachOf = (p: Pt, r: Rect) =>
  Math.hypot(
    Math.max(r.left - p.x, 0, p.x - (r.left + r.width)),
    Math.max(r.top - p.y, 0, p.y - (r.top + r.height)),
  );

/** REQ-437 + REQ-543 (demo m6, cycle 4) — the tag's own top-left, in the same px as `tip`, `box`
 *  and `rect`:
 *   - `rect` (the element the pointer is anchored to): just past one of its edges — above,
 *     below, right or left of it — or under the arrow's tail, whichever covers neither the
 *     element nor the arrow and sits within TAG_REACH of the tip once fitted into the box; of
 *     those, one that `covers` no OTHER control (the caller's hit-test of the page under it)
 *     wins, then the NEAREST to the tip — never the side with the most room, which put the tag
 *     past a card's far edge, over the next control;
 *   - no rect, or no such side (an element bigger than the reach around the tip: a card, a
 *     page): below-right of the tip past the arrow's tail (ARROW_H + TAG_GAP down), above the
 *     tip only at the box's bottom;
 *   - always TAG_EDGE inside `box` (the stage's frame, the customer's window), whatever the tip
 *     — `tip` is the DRAWN arrow (a glide in progress included) and `tag` its measured size. */
export function tagPlacement(
  tip: Pt,
  box: Rect,
  tag: { w: number; h: number },
  rect?: Rect | null,
  covers?: (r: Rect) => boolean,
): { x: number; y: number; side: TagSide } {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const fit = (x: number, y: number, side: TagSide) => ({
    x: clamp(x, box.left + TAG_EDGE, right - TAG_EDGE - tag.w),
    y: clamp(y, box.top + TAG_EDGE, bottom - TAG_EDGE - tag.h),
    side,
  });
  const arrow: Rect = {
    left: tip.x,
    top: tip.y,
    width: ARROW_BOX.w,
    height: ARROW_BOX.h,
  };
  const arrowB = tip.y + ARROW_BOX.h;
  const ty = arrowB + TAG_GAP;
  if (rect && rect.width > 0 && rect.height > 0) {
    const rr = rect.left + rect.width;
    const rb = rect.top + rect.height;
    const wanted: [TagSide, number, number][] = [
      // above: its bottom a gap over the element's top (and the tip)
      ["above", tip.x, Math.min(rect.top, tip.y) - TAG_GAP - tag.h],
      // below: past the element and the arrow's tail
      ["below", tip.x, Math.max(rb, arrowB) + TAG_GAP],
      // right: past the element and the arrow's body, level with the tip
      ["right", Math.max(rr, tip.x + ARROW_BOX.w) + TAG_GAP, tip.y],
      // left: its right edge a gap before the element's left (and the tip)
      ["left", Math.min(rect.left, tip.x) - TAG_GAP - tag.w, tip.y],
      // the arrow's tail, when the element is small enough to leave it clear
      ["tail", tip.x + TAG_GAP, ty],
    ];
    const ok = wanted
      .map(([side, x, y]) => {
        const at = fit(x, y, side);
        const r = { left: at.x, top: at.y, width: tag.w, height: tag.h };
        return { at, r, far: reachOf(tip, r) };
      })
      .filter((c) =>
        c.far <= TAG_REACH && !overlap(c.r, rect) && !overlap(c.r, arrow)
      )
      .sort((a, b) => a.far - b.far);
    if (ok.length) {
      return ((covers && ok.find((c) => !covers(c.r))) || ok[0]).at;
    }
  }
  if (ty + tag.h <= bottom - TAG_EDGE) return fit(tip.x + TAG_GAP, ty, "tail");
  return fit(tip.x + TAG_GAP, tip.y - TAG_GAP - tag.h, "tail-up");
}

/** REQ-305 — the arrow DemoPointer draws: 24 × 30 px, its tip at the point */
export const ARROW_BOX = { w: 24, h: 30 };

/** REQ-393 — a point is OFF a box: past one of its edges (a point on an edge is inside) */
export function outsideBox(
  p: Pt,
  box: { left: number; top: number; width: number; height: number },
): boolean {
  return !(p.x >= box.left && p.x <= box.left + box.width &&
    p.y >= box.top && p.y <= box.top + box.height);
}

/** REQ-305 — where a pointer resolved to `p` is drawn inside `box` (the stage's frame, the
 *  customer's window): the point itself when it is inside; else the box's edge nearest to it, far
 *  enough in that the whole arrow shows, marked `outside` — the element it names is out of view
 *  (scrolled away, or a frame not yet scrolled), and the arrow says so from the edge instead of
 *  being drawn off-screen. REQ-393 — `off`: the sender's pointer is off the shared screen (its
 *  anchor names the edge's point): drawn the same way, on the edge and marked outside */
export function placeIn(
  p: Pt,
  box: { left: number; top: number; width: number; height: number },
  arrow: { w: number; h: number } = ARROW_BOX,
  off = false,
): { at: Pt; outside: boolean } {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  if (!off && !outsideBox(p, box)) {
    return { at: { x: p.x, y: p.y }, outside: false };
  }
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(lo, hi), Math.max(lo, v));
  return {
    at: {
      x: clamp(p.x, box.left, right - arrow.w),
      y: clamp(p.y, box.top, bottom - arrow.h),
    },
    outside: true,
  };
}
