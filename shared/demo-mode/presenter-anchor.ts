/**
 * REQ-451 (demo-loop cycle 3, M1 + M14) — the presenter's pointer is WHAT HE POINTED AT, in pure
 * terms the stage, the customer's overlay and the pointer share. Amends REQ-393, which made it
 * "the spot under his still mouse", looked up again after every layout pass of the replay: the
 * customer's arrow stayed at one screen spot over whatever scrolled or loaded under it, and with
 * his mouse beside a phone frame the whole arrow and his name sat on the phone's edge.
 *
 *   - `anchorPoint`: where an anchor is drawn on a screen — a node anchor on its node only (the
 *     page load it names is the one shown, the node is still in the page and laid out), never at
 *     its old fraction: that spot, on another page or before the page moved, is over something
 *     else now. An anchor naming no element is a fraction; an off anchor is its edge's point.
 *   - `resendable`: the anchor sent again to a page that joined or was mirrored afresh — only when
 *     it was made on that very page load (a tab followed again, its page unchanged), or when it is
 *     his mouse beside the frame (it names no element of any page); a new page gets nothing else
 *     until he moves.
 *   - `lookAgain`: a layout pass looks his still mouse up again only for a fraction made before
 *     the replay could name a node there, once that page's replay has SETTLED (its stylesheets,
 *     web fonts and images in: before that the node under his mouse is not the one under it on
 *     their screen — a logo with no height yet put the Continue button under the middle of the
 *     phone, and the arrow stayed on it); and while his mouse is beside the frame (where it meets
 *     the frame's edge moves with the frame).
 *     REQ-538 (cycle 4 M1) — and a node anchor that died (another page load shown, its node gone:
 *     a card swapped or flipped) once that replay has settled: looked up once under his still
 *     mouse; `pointerAbsent` tells the stage his arrow is not on their screen meanwhile.
 *   - `seedOn`: the mouse handed over by the page that opened the stage counts only on the frame.
 *     REQ-539 (cycle 4, m24) — `seedUse`: and only the stage's own hand-off (a reload) is sent;
 *     /admin's is where his mouse is, not what he points at — a hint for the stage only.
 *   - `ghostAt`: where the stage draws his arrow as their screen has it, faint, when that is apart
 *     from where he put it (their page moved it with its element, or the frame moved).
 *   - `offEdge`, `offMark`: a pointer off their screen is a small translucent marker against the
 *     edge it is off, pointing that way — no arrow, no name tag over their controls.
 *   - REQ-635 (demo m37, cycle 5): `offBadge`, `initialOf` — the marker carries the sender's
 *     initial on a dot in their colour (a bare chevron read as a stray '<'), is shown for
 *     OFF_MARK_SHOW_MS then fades out over OFF_MARK_FADE_MS, and on the customer's screen sits at
 *     OFF_MARK_Z, under the app's modal dims.
 */
import { ARROW_BOX, outsideBox, type Pt } from "./motion.ts";
import {
  type Anchor,
  fracToPoint,
  type NodeAnchor,
  type Rect,
} from "./protocol.ts";

/** what this presenter points at, as the stage keeps it */
export interface Held {
  /** the anchor as last sent (null: none — not pointed yet, or his mouse left the window) */
  a: Anchor | null;
  /** the customer's page load the replay showed when it was made (null: none shown) */
  load: string | null;
  /** where on the stage his mouse was when it was made */
  at: Pt | null;
  /** a bare fraction made only because the replay could not name a node yet */
  provisional: boolean;
}

/** a node anchor's point inside its element's box; null when there is no box with an area (the
 *  element is not in the page, or not laid out: a closed menu) */
export function pointInBox(
  n: { x: number; y: number },
  r: Rect | null,
): Pt | null {
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width * n.x, y: r.top + r.height * n.y };
}

/** where an anchor is drawn on a screen that shows page load `load` in `view`; null: nowhere.
 *  `pointOfNode` finds a node of that load on this screen (null when it is not there) */
export function anchorPoint(
  a: Anchor,
  view: Rect,
  load: string | null,
  pointOfNode: (n: NodeAnchor) => Pt | null,
): Pt | null {
  if (!a.n) return fracToPoint(a, view);
  if (!a.n.l || a.n.l !== load) return null;
  return pointOfNode(a.n);
}

/** the anchor to send again to page load `load` (it just joined, or was mirrored afresh): the
 *  held one when it was made on that load, or when it is his mouse beside the frame (the marker on
 *  their screen's edge names no element of any page) — else null, nothing until he moves */
export function resendable(h: Held, load: string | null): Anchor | null {
  if (!h.a || load === null) return null;
  return h.a.o === 1 || h.load === load ? h.a : null;
}

/** whether a layout pass of the replay (showing `shown`) looks his still mouse up again: his mouse
 *  beside the frame (the frame may have moved: the marker goes where his mouse meets its edge now),
 *  or a provisional fraction made on the page shown, once that page's replay has settled.
 *  REQ-538 (REQ-451 AMENDMENT, cycle 4 M1) — and a DEAD node anchor, once the replay shown has
 *  settled: another page load is shown, or its node no longer resolves there (`alive` false: a
 *  card swapped or flipped, a button replaced). Nothing else ever brought the arrow back until he
 *  moved. A live node anchor is never looked up again (REQ-451); the look-up makes a live anchor,
 *  so it happens once. `alive` unknown counts as alive. */
export function lookAgain(
  h: Held,
  shown: { load: string | null; settled: boolean; alive?: boolean },
): boolean {
  if (h.a?.o === 1) return true;
  if (h.a?.n) {
    if (!shown.settled || shown.load === null) return false;
    return h.load !== shown.load || h.a.n.l !== shown.load ||
      shown.alive === false;
  }
  return h.provisional && h.load !== null && h.load === shown.load &&
    shown.settled;
}

/** REQ-538 — a dead anchor is looked up again only once the replay's layout has been still this
 *  long (a card flip's burst of changes) */
export const REANCHOR_QUIET_MS = 250;

/** REQ-538 — how long the stage waits before looking his still mouse up again for a dead anchor:
 *  REANCHOR_QUIET_MS, and never before the last settle pass after the latest snapshot (`snapAt`,
 *  `settleEnd` ms after it) — until then the replay's scroll may not be the customer's yet, and the
 *  node under his mouse is not the one under it on their screen */
export function reanchorDelay(
  now: number,
  snapAt: number | null,
  settleEnd: number,
  quiet = REANCHOR_QUIET_MS,
): number {
  return Math.max(quiet, snapAt === null ? 0 : snapAt + settleEnd - now);
}

/** REQ-538 — whether the stage tells him his arrow is not on their screen: he holds a node anchor
 *  that is not drawn there (`alive` false: another page, its node gone) — until he moves, or the
 *  settled replay looks his still mouse up again */
export function pointerAbsent(h: Held, alive: boolean): boolean {
  return !!h.a?.n && h.a.o !== 1 && !alive;
}

/** the mouse handed over by the page that opened the stage, counted only on the fitted frame */
export function seedOn(seed: Pt | null, frame: Rect): Pt | null {
  return seed && !outsideBox(seed, frame) ? seed : null;
}

/** REQ-539 (demo m24) — what the stage makes of a hand-off once the frame is fitted. The stage's
 *  own (its pagehide: a reload, the same page, the same spot) on the frame is where he points:
 *  `send`. /admin's (the click on Demo) says only where his mouse is — for a desktop customer the
 *  Demo button falls on the fitted frame, over whatever her page has there (her mic button) — so
 *  it is a hint for the stage's on/off-frame outline only, never sent: nothing reaches their
 *  screen until he moves. The stage's own beside the frame: nothing (REQ-451). */
export function seedUse(
  seed: (Pt & { from: "admin" | "stage" }) | null,
  frame: Rect,
): { at: Pt; send: boolean } | null {
  if (!seed) return null;
  const at = { x: seed.x, y: seed.y };
  if (seed.from !== "stage") return { at, send: false };
  return seedOn(at, frame) ? { at, send: true } : null;
}

/** within this of where he put it, his arrow on their screen is under his own cursor: no ghost */
export const GHOST_GAP_PX = 6;
/** the ghost is faint: the live arrow on their screen is the real one */
export const GHOST_OPACITY = 0.5;

/** where the stage draws the ghost of his arrow, or null: `placed` is where their screen has it
 *  now (on the frame), the page shown is `shownLoad` */
export function ghostAt(
  h: Held,
  shownLoad: string | null,
  placed: { at: Pt; outside: boolean } | null,
): { at: Pt; outside: boolean } | null {
  if (!h.a || h.a.o === 1 || !placed || h.load !== shownLoad) return null;
  if (
    !placed.outside && h.at &&
    Math.hypot(placed.at.x - h.at.x, placed.at.y - h.at.y) <= GHOST_GAP_PX
  ) return null;
  return placed;
}

/** the off-screen marker: its size (px) and how translucent it is */
export const OFF_MARK_PX = 14;
export const OFF_MARK_OPACITY = 0.7;
/** how far the marker sits in from the edge */
const OFF_MARK_INSET = 2;

/** which edge of `box` a pointer placed off the screen sits against (`placeIn(…, off)` put its
 *  arrow box inside `box`): -1 left / top, 1 right / bottom, 0 neither */
export function offEdge(
  at: Pt,
  box: Rect,
  arrow = ARROW_BOX,
): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
  const side = (v: number, lo: number, hi: number): -1 | 0 | 1 =>
    v <= lo + 0.5 ? -1 : v >= hi - 0.5 ? 1 : 0;
  return {
    dx: side(at.x, box.left, box.left + box.width - arrow.w),
    dy: side(at.y, box.top, box.top + box.height - arrow.h),
  };
}

/** the marker inside the pointer's arrow box (its top-left at `at`): against the edge it is off,
 *  centred on the point along that edge (never pushed off the screen), turned to point out */
export function offMark(
  at: Pt,
  box: Rect,
): { left: number; top: number; deg: number } {
  const { dx, dy } = offEdge(at, box);
  const half = OFF_MARK_PX / 2;
  const left = dx === 1
    ? ARROW_BOX.w - OFF_MARK_PX - OFF_MARK_INSET
    : dx === -1
    ? OFF_MARK_INSET
    : Math.max(box.left - at.x, -half);
  const top = dy === 1
    ? ARROW_BOX.h - OFF_MARK_PX - OFF_MARK_INSET
    : dy === -1
    ? OFF_MARK_INSET
    : Math.max(box.top - at.y, -half);
  const deg = dx === 0 && dy === 0
    ? 0
    : Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  return { left, top, deg };
}

/** REQ-635 (demo m37, cycle 5) — how long the off marker is shown before it fades, and the fade */
export const OFF_MARK_SHOW_MS = 2_500;
export const OFF_MARK_FADE_MS = 400;
/** REQ-635 — the off marker's layer on the customer's screen: under the app's modal dims (the
 *  lowest is z-index 50) — a hint, never over a dialog. The arrow keeps the overlay's top layer. */
export const OFF_MARK_Z = 45;
/** REQ-635 — the dot with the sender's initial beside the chevron */
export const OFF_BADGE_PX = 16;
/** the gap between the chevron and the dot */
const OFF_BADGE_GAP = 1;

/** REQ-635 — where the initial's dot sits, relative to the marker's box (`offMark`'s left/top):
 *  on the chevron's inner side (away from the edge it is off), so it never leaves the screen */
export function offBadge(at: Pt, box: Rect): { left: number; top: number } {
  const { dx, dy } = offEdge(at, box);
  const mid = (OFF_MARK_PX - OFF_BADGE_PX) / 2;
  const after = OFF_MARK_PX + OFF_BADGE_GAP;
  const before = -OFF_BADGE_PX - OFF_BADGE_GAP;
  const left = dx === -1 ? after : dx === 1 ? before : dy === 0 ? after : mid;
  const top = dy === -1 ? after : dy === 1 ? before : mid;
  return { left, top };
}

/** REQ-635 — the sender's initial: the name's first letter, upper-cased ('?' for no name) */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}
