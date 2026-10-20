/**
 * REQ-105 — Raphael, 2026-10-20, on the pinned /landing2: "why cant i click and drag the calendar
 * on mobile? the expierence on mobile leds itself better to that." — "do it." — and on the first
 * cut, which held five days and flipped the page on the release: "the boxes should render smoothly
 * as you scroll, these fucking boxes dont render until you release".
 *
 * The demo's day strip is a scroller: every day in one row, five to the view's width, snapping to
 * a day. The arithmetic the island needs — which day stands first for a scroll position, where an
 * arrow sends the strip, the nearest stop for a let-go mouse, what counts as a drag — lives in
 * front-end/lib/day-strip.ts, bound into Landing2Demo.tsx (landing2-page.test.ts binds the island
 * and the stylesheet).
 */
import {
  firstOnView,
  isDrag,
  nearestStop,
  pageTarget,
  SWIPE_SLACK,
} from "../../front-end/lib/day-strip";

describe("REQ-105 firstOnView — the day standing first for a scroll position", () => {
  test("a scroll of so many steps stands that many days in; between stops, the nearer one", () => {
    expect(firstOnView(0, 60)).toBe(0);
    expect(firstOnView(120, 60)).toBe(2);
    expect(firstOnView(125, 60)).toBe(2);
    expect(firstOnView(155, 60)).toBe(3);
  });

  test("a strip with no step yet (one day, or unmeasured) stands at its start", () => {
    expect(firstOnView(100, 0)).toBe(0);
    expect(firstOnView(100, Number.NaN)).toBe(0);
  });
});

describe("REQ-105 pageTarget — where an arrow sends the strip", () => {
  test("five on from where it stands, and five back", () => {
    expect(pageTarget(0, 1, 5, 90)).toBe(5);
    expect(pageTarget(5, 1, 5, 90)).toBe(10);
    expect(pageTarget(10, -1, 5, 90)).toBe(5);
    expect(pageTarget(7, 1, 5, 90)).toBe(12); // from wherever a finger left it
  });

  test("never past the first day, never past a view of the last five", () => {
    expect(pageTarget(3, -1, 5, 90)).toBe(0);
    expect(pageTarget(85, 1, 5, 90)).toBe(85);
    expect(pageTarget(83, 1, 5, 90)).toBe(85);
    expect(pageTarget(0, -1, 5, 90)).toBe(0);
  });

  test("a list shorter than a view has one place to stand", () => {
    expect(pageTarget(0, 1, 5, 4)).toBe(0);
    expect(pageTarget(0, -1, 5, 4)).toBe(0);
  });
});

describe("REQ-105 nearestStop — where a let-go mouse settles", () => {
  test("the nearest day's stop, in px", () => {
    expect(nearestStop(0, 60)).toBe(0);
    expect(nearestStop(125, 60)).toBe(120);
    expect(nearestStop(155, 60)).toBe(180);
    expect(nearestStop(-20, 60)).toBe(0); // never before the start
  });

  test("no step, no move", () => {
    expect(nearestStop(100, 0)).toBe(100);
  });
});

describe("REQ-105 isDrag — a tap is not a drag", () => {
  test("a pointer that moved no more than the slack is a tap: the day under it is picked by its click", () => {
    expect(SWIPE_SLACK).toBe(6);
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(3, 2)).toBe(false);
    expect(isDrag(SWIPE_SLACK, SWIPE_SLACK)).toBe(false);
  });

  test("past the slack, either way, it is a drag: the click it leaves is not a pick", () => {
    expect(isDrag(10, 0)).toBe(true);
    expect(isDrag(-10, 0)).toBe(true);
    expect(isDrag(0, 9)).toBe(true);
    expect(isDrag(0, -9)).toBe(true);
  });
});
