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
/** REQ-374 (demo m9) — a resting tag never fades out: the name stays readable.
 *  REQ-633 (demo m35, cycle 5) — and it no longer fades at all: at 0.6 the coach mark's dark
 *  scrim showed through it and the pointer read as "under the dark layer". It rests fully opaque
 *  on its solid colour, shrunk to the initials (`tagLabel`) so it covers less of the page */
export const TAG_REST_OPACITY = 1;
/** REQ-374 (demo p8) — the arrow is always fully opaque (it read as faint when it dimmed); only
 *  the tag rests — REQ-633: by shrinking (`compact`), not by fading */
export function pointerLook(
  resting: boolean,
): { arrow: number; tag: number; compact: boolean } {
  return {
    arrow: 1,
    tag: resting ? TAG_REST_OPACITY : 1,
    compact: resting,
  };
}
/** REQ-633 (demo m2, cycle 5) — the tag's text: the whole name while the pointer moves, its
 *  initials (two at most) once it rests */
export function tagLabel(name: string, compact: boolean): string {
  if (!compact) return name;
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join("");
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

/** REQ-437 + REQ-543 (demo m6, cycle 4) + REQ-633 (demo m2, cycle 5) — the tag's own top-left,
 *  in the same px as `tip`, `box` and `rect`:
 *   - `rect` (the element the pointer is anchored to): just past one of its edges — above,
 *     below, right or left of it — which covers neither the element nor the arrow and sits
 *     within TAG_REACH of the tip once fitted into the box, nearest to the tip first — never the
 *     side with the most room, which put the tag past a card's far edge, over the next control;
 *   - then the spots around the ARROW itself (a small virtual rect at the tip): under its tail
 *     ("tail"), above the tip ("tail-up"), right of its body, left of the tip — the only spots
 *     when there is no rect, or the rect is bigger than the reach around the tip (a list, a
 *     card); "tail" only where the box's bottom leaves room for it;
 *   - `covers` (the caller's hit-test of the page under a candidate: true/false, or a score of
 *     how much content — text, other controls — it would hide) picks among ALL of those: the
 *     least covered wins, the order above breaking ties; nothing covered keeps the first;
 *   - always TAG_EDGE inside `box` (the stage's frame, the customer's window), whatever the tip
 *     — `tip` is the DRAWN arrow (a glide in progress included) and `tag` its measured size. */
export function tagPlacement(
  tip: Pt,
  box: Rect,
  tag: { w: number; h: number },
  rect?: Rect | null,
  covers?: (r: Rect) => boolean | number,
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
  const cand = (x: number, y: number, side: TagSide) => {
    const at = fit(x, y, side);
    const r = { left: at.x, top: at.y, width: tag.w, height: tag.h };
    return { at, r, far: reachOf(tip, r) };
  };
  type Cand = ReturnType<typeof cand>;
  const sized = !!rect && rect.width > 0 && rect.height > 0;
  let near: Cand[] = [];
  if (rect && sized) {
    const rr = rect.left + rect.width;
    const rb = rect.top + rect.height;
    near = [
      // above: its bottom a gap over the element's top (and the tip)
      cand(tip.x, Math.min(rect.top, tip.y) - TAG_GAP - tag.h, "above"),
      // below: past the element and the arrow's tail
      cand(tip.x, Math.max(rb, arrowB) + TAG_GAP, "below"),
      // right: past the element and the arrow's body, level with the tip
      cand(Math.max(rr, tip.x + ARROW_BOX.w) + TAG_GAP, tip.y, "right"),
      // left: its right edge a gap before the element's left (and the tip)
      cand(Math.min(rect.left, tip.x) - TAG_GAP - tag.w, tip.y, "left"),
      // the arrow's tail, when the element is small enough to leave it clear
      cand(tip.x + TAG_GAP, ty, "tail"),
    ]
      .filter((c) =>
        c.far <= TAG_REACH && !overlap(c.r, rect) && !overlap(c.r, arrow)
      )
      .sort((a, b) => a.far - b.far);
  }
  // the spots around the arrow: for no rect, a rect bigger than the reach, or every side covered
  const tailFits = ty + tag.h <= bottom - TAG_EDGE;
  const around = [
    ...(tailFits ? [cand(tip.x + TAG_GAP, ty, "tail")] : []),
    cand(tip.x + TAG_GAP, tip.y - TAG_GAP - tag.h, "tail-up"),
    cand(tip.x + ARROW_BOX.w + TAG_GAP, tip.y, "right"),
    cand(tip.x - TAG_GAP - tag.w, tip.y, "left"),
  ].filter((c) =>
    c.far <= TAG_REACH && !overlap(c.r, arrow) &&
    // beside a small element the tag stays off it, as its own sides do
    !(near.length && rect && overlap(c.r, rect))
  );
  const all = [...near, ...around];
  if (!all.length) {
    return fit(tip.x + TAG_GAP, tip.y - TAG_GAP - tag.h, "tail-up");
  }
  if (!covers) return all[0].at;
  // the least covered wins; the first clean one ends the search (each score is a hit-test)
  let best = all[0];
  let bestScore = Infinity;
  for (const c of all) {
    const v = covers(c.r);
    const score = typeof v === "number" ? v : v ? 1 : 0;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
    if (score <= 0) break;
  }
  return best.at;
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
