/**
 * REQ-873 — demo-loop cycle dm5 (run r38fa8936), issue p5: "Hover-opened customer pill covers the
 * list filter tabs on /customers at 700 wide". Raphael: "fix every issue the demo found, loop
 * until there are none".
 *
 * RCA (CONFIRMED, skeptic UPHELD, at abbf6bc3): `peekBox` (REQ-818/849) kept the peek on the tab's
 * own row and only slid it along x. At 700×800 the ES pill is 501 px wide, so x ranges over 12..187
 * and every box spans the filter tabs (Todos 261-342, Nuevos 346-436, En curso 440-535 ×
 * 551-581): each try counted 3 controls and the tie kept flush, {12,549,501,43} — exactly the
 * 12-513 × 549-592 the demo measured (fleet-r38fa8936-1/stdout:79-85).
 *
 * Now: when every x on the tab's row holds a control, the peek tries the rows above and below (a
 * pill height plus PILL_BAND_GAP apart, nearest first), then `pillSpots`, and takes the first box
 * with no control under it; only when none is clear, the row's fewest (REQ-818). The tab's box
 * still holds it (`peekHolds`, REQ-849), so the pointer that opened it keeps it whole.
 */
import {
  peekBox,
  peekHolds,
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillHome,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const page = (controls: Rect[]) => (r: Rect) =>
  controls.filter((c) => overlap(r, c)).length;

// the demo's measured geometry: 700×800, ES pill 501×43, tab folded on the left edge at (0,560)
const view = { w: 700, h: 800 };
const home = pillHome({ view, size: { w: 501, h: 43 } }).box;
const tab: Rect = { left: 0, top: 560, width: 96, height: 32 };
// filter tabs Todos / Nuevos / En curso, and the row under them (Te deben / Habituales /
// Inactivos — its top 7 px were under the peek)
const filters: Rect[] = [
  { left: 261, top: 551, width: 81, height: 30 },
  { left: 346, top: 551, width: 90, height: 30 },
  { left: 440, top: 551, width: 95, height: 30 },
  { left: 261, top: 585, width: 81, height: 30 },
  { left: 346, top: 585, width: 90, height: 30 },
  { left: 440, top: 585, width: 95, height: 30 },
];
const controls = page(filters);

describe("REQ-873 (demo-loop cycle dm5, p5) — a peek whose whole row holds controls tries other rows", () => {
  test("REQ-873 the bug: every x on the tab's row covers a filter tab", () => {
    const top = tab.top + tab.height - home.height;
    for (let x = PILL_MARGIN; x <= view.w - PILL_MARGIN - home.width; x++) {
      expect(controls({ ...home, left: x, top })).toBeGreaterThan(0);
    }
  });

  test("REQ-873 /customers at 700×800 (ES, 501 px pill): the peek covers no control, inside the window", () => {
    const box = peekBox({ home, view, tab, controls });
    expect(controls(box)).toBe(0);
    expect(box.width).toBe(home.width);
    expect(box.left).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(box.left + box.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    expect(box.top).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(box.top + box.height).toBeLessThanOrEqual(view.h);
  });

  test("REQ-873 the nearest clear row first: a pill height plus a gap from the tab's row", () => {
    const row = tab.top + tab.height - home.height;
    const step = home.height + PILL_BAND_GAP;
    const box = peekBox({ home, view, tab, controls });
    // one step down (600) still hits the second filter row; one step up (498) is clear
    expect(box.top).toBe(row - step);
    expect(box.left).toBe(PILL_MARGIN);
  });

  test("REQ-873 rows below are tried too (nearest first)", () => {
    // a control band across the tab's row and the row above it, nothing below
    const row = tab.top + tab.height - home.height;
    const step = home.height + PILL_BAND_GAP;
    const band = page([{
      left: 0,
      top: row - step,
      width: view.w,
      height: 2 * step,
    }]);
    const box = peekBox({ home, view, tab, controls: band });
    expect(band(box)).toBe(0);
    expect(box.top).toBe(row + step);
  });

  test("REQ-873 no row is clear: then the pillSpots (the top-right one here), first clear", () => {
    // controls everywhere except the top 60 px on the right
    const blocks = page([
      { left: 0, top: 60, width: view.w, height: view.h },
      { left: 0, top: 0, width: 150, height: 60 },
    ]);
    const box = peekBox({ home, view, tab, controls: blocks });
    expect(blocks(box)).toBe(0);
    expect(box.top).toBe(PILL_MARGIN);
    expect(box.left + box.width).toBe(view.w - PILL_MARGIN);
  });

  test("REQ-873 nothing clear anywhere: the tab's row's fewest (REQ-818), flush on a tie", () => {
    const all = () => 2;
    const box = peekBox({ home, view, tab, controls: all });
    expect(box.top).toBe(tab.top + tab.height - home.height);
    expect(box.left).toBe(PILL_MARGIN);
  });

  test("REQ-873 a clear row keeps the old place (no control: flush on the tab's row)", () => {
    const box = peekBox({ home, view, tab, controls: () => 0 });
    expect(box.top).toBe(tab.top + tab.height - home.height);
    expect(box.left).toBe(PILL_MARGIN);
  });

  test("REQ-873 the peek moved off the tab's row is still held by a pointer on the tab (REQ-849)", () => {
    const pill = peekBox({ home, view, tab, controls });
    expect(overlap(pill, tab)).toBe(false);
    expect(
      peekHolds({ pill, tab, x: tab.left + 10, y: tab.top + tab.height / 2 }),
    ).toBe(true);
  });
});
