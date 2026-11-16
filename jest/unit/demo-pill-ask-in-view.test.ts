/**
 * REQ-816 — demo-loop cycle dm1, issue M1: the customer could not confirm or dismiss End's
 * question. Folded on the RIGHT edge (REQ-781), the mini-pill's × opened the whole pill flush right
 * at its width at rest (`peekBox`), then End's question made it far wider (657-671 px on a 1280
 * window; 366 px on a 390 phone) while REQ-300 froze its place, so it grew past the window's right
 * edge and "Yes, end it" / "Keep going" were off-screen. The same for a whole pill parked at the
 * bottom-right / top-right spot. Now the asking pill is placed once at its asking size
 * (`keepInView`) before the freeze.
 */
import * as fs from "fs";
import * as path from "path";
import {
  keepInView,
  peekBox,
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillHome,
  pillSpots,
  placePill,
  tabBox,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** the pill grown to `size` where it stood: its left and its foot kept (it is anchored so) */
const grown = (r: Rect, size: { w: number; h: number }): Rect => ({
  left: r.left,
  top: r.top + r.height - size.h,
  width: size.w,
  height: size.h,
});
const inside = (r: Rect, view: { w: number; h: number }) =>
  r.left >= 0 && r.left + r.width <= view.w - PILL_MARGIN &&
  r.top >= PILL_MARGIN;

/** the right-edge mini-pill: everything on the left edge has a control under it */
function rightPeek(view: { w: number; h: number }, rest: number) {
  const home = pillHome({ view, size: { w: rest, h: 43 } }).box;
  const p = placePill({
    home,
    view,
    dialog: false,
    yields: true,
    blocked: () => 1,
    controls: (r) => (r.left === 0 ? 1 : 0),
  });
  expect(p.tucked).toBe(true);
  expect(p.box.left).toBeGreaterThan(0);
  return peekBox({ home, tab: p.box, edge: tabBox(home), view });
}

describe("REQ-816 (demo-loop cycle dm1, M1) — End's question opens inside the window", () => {
  test("REQ-816 desktop 1280×800: a peek from the right-edge tab (rest 405 px) asking at 657 px keeps left + width ≤ view.w − margin", () => {
    const view = { w: 1280, h: 800 };
    const peek = rightPeek(view, 405);
    // the bug, as the demo measured it: x 875, right edge 1532
    expect(peek.left).toBe(875);
    const asking = grown(peek, { w: 657, h: 43 });
    expect(asking.left + asking.width).toBeGreaterThan(view.w);
    const fit = keepInView(asking, view);
    expect(fit.width).toBe(657);
    expect(fit.left + fit.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    expect(inside(fit, view)).toBe(true);
    // its foot stays where it was (only the left moves)
    expect(fit.top + fit.height).toBe(asking.top + asking.height);
  });

  test("REQ-816 desktop: rest 444 px asking at 671 px (demos 1 and 4) — inside", () => {
    const view = { w: 1280, h: 800 };
    const fit = keepInView(
      grown(rightPeek(view, 444), { w: 671, h: 43 }),
      view,
    );
    expect(fit.left + fit.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
  });

  test("REQ-816 phone 390×844: the compact pill wraps to 366 px and two rows — left 12, inside", () => {
    const view = { w: 390, h: 844 };
    const asking = grown(rightPeek(view, 265), { w: 366, h: 74 });
    expect(asking.left + asking.width).toBeGreaterThan(view.w);
    const fit = keepInView(asking, view);
    expect(fit.left).toBe(PILL_MARGIN);
    expect(fit.left + fit.width).toBe(view.w - PILL_MARGIN);
  });

  test("REQ-816 the bottom-right and top-right spots: grown to asking size they stay inside (a top spot grown taller is kept under the top margin)", () => {
    const view = { w: 1280, h: 800 };
    const home = pillHome({ view, size: { w: 405, h: 43 } }).box;
    const spots = pillSpots({ home, view, top: 0 });
    for (const spot of [spots[1], spots[3]]) {
      const fit = keepInView(grown(spot, { w: 657, h: 86 }), view);
      expect(inside(fit, view)).toBe(true);
    }
  });

  test("REQ-816 a pill that already fits does not move (the left-edge peek stays flush with the edge)", () => {
    const view = { w: 1280, h: 800 };
    const r = { left: 0, top: 700, width: 657, height: 43 };
    expect(keepInView(r, view)).toEqual(r);
    const home = { left: 12, top: 749, width: 657, height: 43 };
    expect(keepInView(home, view)).toEqual(home);
  });

  test("REQ-816 the overlay re-places the asking pill once, before paint, then freezes (REQ-300)", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(/peekBox\(/);
    const effect = src.match(
      /useLayoutEffect\(\(\) => \{[\s\S]*?keepInView\([\s\S]*?\}, \[asking\]\);/,
    );
    expect(effect).not.toBeNull();
    expect(effect![0]).toMatch(/offsetWidth/);
    expect(effect![0]).toMatch(/PILL_BAND_GAP/);
    expect(PILL_BAND_GAP).toBeGreaterThan(0);
  });
});
