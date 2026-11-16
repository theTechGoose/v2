/**
 * REQ-874 — demo-loop cycle dm5, issue p9 (amends REQ-781 / REQ-866).
 *
 * On /admin at 1280×800 the customer-ended notice ("Demo mode · Maria Lopez ended the demo ×",
 * the floating pill: `floats`) sat bottom-right over the footer's address line ("45…" cut off).
 * `placePill`'s rule 3 took the first `pillSpots` box with no CONTROL under it (text allowed)
 * before REQ-866's `standing()` ever looked through the rows between for a box with nothing of
 * the page under it. A pill that does not fold now tries, in order: a clear spot, a clear row,
 * a spot with only text (REQ-781), then REQ-866's fewest-controls fallback.
 */
import {
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillRows,
  pillSpots,
  placePill,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const view = { w: 1280, h: 800 };
const h = 43;
const home: Rect = {
  left: PILL_MARGIN,
  top: view.h - PILL_BAND_GAP - h,
  width: 444,
  height: h,
};
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;
const spots = pillSpots({ home, view });
const rows = pillRows({ home, view });
const bottomRight = spots[1];
/** the first row (nearest home) at the right edge: nothing of the page under it */
const clearRow = rows.find((r) => r.left === bottomRight.left)!;

/** /admin at 1280×800: home over the footer's links; bottom-right over the address text only;
 *  every other spot over a control; the right-edge row above the footer clear */
const blocked = (r: Rect) => (same(r, clearRow) ? 0 : 2);
const controls = (r: Rect) =>
  same(r, bottomRight) || rows.some((x) => same(x, r)) ? 0 : 2;

describe("REQ-874 (demo-loop cycle dm5, p9) — a pill that does not fold takes a clear row before a spot over text", () => {
  test("REQ-874 p9: the fixture — the row is clear, bottom-right holds text but no control", () => {
    expect(clearRow).toBeDefined();
    expect(blocked(bottomRight)).toBeGreaterThan(0);
    expect(controls(bottomRight)).toBe(0);
  });

  test("REQ-874 p9: the ended notice (floats) on /admin — home blocked, bottom-right only text, a row clear: the row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked,
      controls,
    });
    expect(p.tucked).toBe(false);
    expect(p.box).toEqual(clearRow);
  });

  test("REQ-874 p9: a pill that does not yield (the join grace) — the same: the clear row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked,
      controls,
    });
    expect(p.tucked).toBe(false);
    expect(p.box).toEqual(clearRow);
  });

  test("REQ-874 p9: no row clear — REQ-781's text-only spot still wins over REQ-866's fewest", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked: () => 2,
      controls,
    });
    expect(same(p.box, bottomRight)).toBe(true);
  });

  test("REQ-874 p9: a clear spot still comes before any row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked: (r) => (same(r, spots[2]) || same(r, clearRow) ? 0 : 2),
      controls,
    });
    expect(same(p.box, spots[2])).toBe(true);
  });

  test("REQ-874 p9: a pill that yields still folds to a clear tab before a text spot (REQ-853 unchanged)", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      blocked: (r) => (r.width < home.width ? 0 : 2),
      controls,
    });
    expect(p.tucked).toBe(true);
  });
});
