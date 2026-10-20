/**
 * REQ-105 — Raphael, 2026-10-20, on the pinned /landing2: "why cant i click and drag the calendar
 * on mobile? the expierence on mobile leds itself better to that." — "do it." — and on the first
 * cut, which held five days and flipped the page on the release: "the boxes should render smoothly
 * as you scroll, these fucking boxes dont render until you release".
 *
 * The demo's day strip (REQ-102) is a scroller: every day in one row, five to the view's width,
 * snapping to a day. The browser does the scrolling; this is the arithmetic the island needs
 * around it — which day stands first for a scroll position, where an arrow sends the strip, the
 * nearest stop for a let-go mouse, and what counts as a drag rather than a click. Pixels in, a
 * number out — no DOM.
 */

/** travel, in px, within which a mouse is still a click: the day under it is picked */
export const SWIPE_SLACK = 6;

/**
 * The day standing first for a scroll position: the nearest stop, a stop being `step` px from
 * the next. No step yet (one day, or unmeasured) — the start.
 */
export function firstOnView(scrollLeft: number, step: number): number {
  return step > 0 ? Math.max(0, Math.round(scrollLeft / step)) : 0;
}

/**
 * Where an arrow sends the strip: `count` days on (or back) from where it stands — never before
 * the first day, never past a view of the last `count`.
 */
export function pageTarget(
  first: number,
  dir: -1 | 1,
  count: number,
  total: number,
): number {
  const last = Math.max(0, total - count);
  return Math.min(last, Math.max(0, first + dir * count));
}

/** Where a let-go mouse settles: the nearest day's stop, in px — never before the start. */
export function nearestStop(scrollLeft: number, step: number): number {
  return step > 0
    ? Math.max(0, Math.round(scrollLeft / step) * step)
    : scrollLeft;
}

/** A pointer that moved past the slack, either way, is a drag, not a click. */
export function isDrag(dx: number, dy: number, slack = SWIPE_SLACK): boolean {
  return Math.abs(dx) > slack || Math.abs(dy) > slack;
}
