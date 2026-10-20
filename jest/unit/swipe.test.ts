/**
 * REQ-105 — Raphael, 2026-10-20, on the pinned /landing2: "why cant i click and drag the calendar
 * on mobile? the expierence on mobile leds itself better to that." — "do it."
 *
 * The demo's day strip was paged by its two arrows alone (REQ-102): no gesture handler, no
 * scroller, so a finger across it did nothing. Now a drag across the strip pages it: the pure
 * rules — which way a released drag pages, how far the strip follows the finger, and what counts
 * as a drag rather than a tap — live in front-end/lib/swipe.ts, bound into Landing2Demo.tsx
 * (landing2-page.test.ts binds the island and the stylesheet).
 */
import {
  followOffset,
  isDrag,
  SWIPE_MIN,
  SWIPE_SLACK,
  swipeDir,
} from "../../front-end/lib/swipe";

describe("REQ-105 swipeDir — which way a released drag pages", () => {
  test("a finger that went left past the threshold pages to the next five; right, to the five before", () => {
    expect(SWIPE_MIN).toBe(40);
    expect(swipeDir(-60, 5)).toBe(1);
    expect(swipeDir(60, -5)).toBe(-1);
    expect(swipeDir(-SWIPE_MIN, 0)).toBe(1); // the threshold itself counts
    expect(swipeDir(SWIPE_MIN, 0)).toBe(-1);
  });

  test("a drag too short, or more up-and-down than sideways, stays on its page", () => {
    expect(swipeDir(-30, 0)).toBe(0);
    expect(swipeDir(30, 0)).toBe(0);
    expect(swipeDir(-60, -80)).toBe(0); // the page's own scroll, not the strip's
    expect(swipeDir(60, 60)).toBe(0); // a diagonal is not a swipe
    expect(swipeDir(0, 0)).toBe(0);
  });

  test("the threshold can be named", () => {
    expect(swipeDir(-25, 0, 20)).toBe(1);
    expect(swipeDir(-25, 0, 30)).toBe(0);
  });
});

describe("REQ-105 followOffset — how far the strip follows the finger", () => {
  test("between pages the strip follows the finger all the way", () => {
    expect(followOffset(-100, 3, 18)).toBe(-100);
    expect(followOffset(100, 3, 18)).toBe(100);
  });

  test("past the first page or the last the strip resists: a third of the way", () => {
    expect(followOffset(90, 0, 18)).toBe(30); // pulling right on the first page
    expect(followOffset(-90, 0, 18)).toBe(-90); // pulling left on the first page is free
    expect(followOffset(-90, 17, 18)).toBe(-30); // pulling left on the last page
    expect(followOffset(90, 17, 18)).toBe(90);
  });

  test("a strip of one page resists both ways", () => {
    expect(followOffset(90, 0, 1)).toBe(30);
    expect(followOffset(-90, 0, 1)).toBe(-30);
  });
});

describe("REQ-105 isDrag — a tap is not a drag", () => {
  test("a finger that moved no more than the slack is a tap: the day under it is picked", () => {
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
