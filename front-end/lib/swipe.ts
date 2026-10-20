/**
 * REQ-105 — Raphael, 2026-10-20, on the pinned /landing2: "why cant i click and drag the calendar
 * on mobile? the expierence on mobile leds itself better to that." — "do it."
 *
 * The demo's day strip (REQ-102) pages five days at a time; a finger — or a mouse — dragged across
 * it pages it too. These are the pure rules of that drag, bound into Landing2Demo.tsx: which way a
 * released drag pages, how far the strip follows the finger while held, and what counts as a drag
 * rather than a tap (a drag never picks the day it started on; a tap still does). Pixels in, a
 * verdict out — no DOM.
 */

/** sideways travel, in px, that turns a released drag into a page */
export const SWIPE_MIN = 40;
/** travel, in px, within which a touch is still a tap: the day under it is picked */
export const SWIPE_SLACK = 6;

/**
 * Which way a released drag pages: 1 for the next five (the finger went left), -1 for the five
 * before (it went right), 0 to stay — the travel short of `min`, or more up-and-down than
 * sideways (the page's own scroll, not the strip's).
 */
export function swipeDir(dx: number, dy: number, min = SWIPE_MIN): -1 | 0 | 1 {
  if (Math.abs(dx) < min || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * How far the strip follows the finger: all the way between pages, a third of the way when the
 * pull is past the first page or the last — the strip resists, there being nothing further.
 */
export function followOffset(dx: number, page: number, pages: number): number {
  const past = (dx > 0 && page === 0) || (dx < 0 && page >= pages - 1);
  return past ? dx / 3 : dx;
}

/** A pointer that moved past the slack, either way, is a drag, not a tap. */
export function isDrag(dx: number, dy: number, slack = SWIPE_SLACK): boolean {
  return Math.abs(dx) > slack || Math.abs(dy) > slack;
}
