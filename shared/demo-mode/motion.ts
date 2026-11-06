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
