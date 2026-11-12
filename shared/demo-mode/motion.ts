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

/** REQ-242 — the pointer's name tag fades after this long without a move (it hid what it pointed at) */
export const TAG_IDLE_MS = 1_500;
/** REQ-242 — and the arrow itself dims after this long (a resting pointer stays, faint) */
export const ARROW_IDLE_MS = 6_000;
/** where the tag sits from the arrow's tip: right of it and below it */
export const TAG_DX = 26;
export const TAG_DY = 18;

/** REQ-242 — which side of the arrow the name tag goes: right and below, unless that runs past the
 *  box's right or bottom edge (the stage's frame, or the customer's window — never a guess) */
export function tagPlacement(
  p: Pt,
  box: { left: number; top: number; width: number; height: number },
  tag: { w: number; h: number },
): { left: boolean; up: boolean } {
  return {
    left: p.x + TAG_DX + tag.w > box.left + box.width,
    up: p.y + TAG_DY + tag.h > box.top + box.height,
  };
}

/** REQ-305 — the arrow DemoPointer draws: 24 × 30 px, its tip at the point */
export const ARROW_BOX = { w: 24, h: 30 };

/** REQ-305 — where a pointer resolved to `p` is drawn inside `box` (the stage's frame, the
 *  customer's window): the point itself when it is inside; else the box's edge nearest to it, far
 *  enough in that the whole arrow shows, marked `outside` — the element it names is out of view
 *  (scrolled away, or a frame not yet scrolled), and the arrow says so from the edge instead of
 *  being drawn off-screen */
export function placeIn(
  p: Pt,
  box: { left: number; top: number; width: number; height: number },
  arrow: { w: number; h: number } = ARROW_BOX,
): { at: Pt; outside: boolean } {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  if (p.x >= box.left && p.x <= right && p.y >= box.top && p.y <= bottom) {
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
