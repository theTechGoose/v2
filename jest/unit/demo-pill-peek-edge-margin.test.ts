// REVISION (demo-loop run 15, by hand, 2026-11-17): REQ-820 AMENDMENT 4 (dm15, p4): `held` asks pointerRests first, so peekHolds sits further down
/**
 * REQ-849 — demo-loop cycle dm3, issue p14: "Customer's expanded pill sits flush (0 px margin,
 * 0.08 px past the edge) against the right edge at the bottom, while top-right keeps 12 px".
 * Raphael: "fix every issue the demo found, loop until there are none".
 *
 * RCA (CONFIRMED, skeptic UPHELD, at 5fef7e6d): the bottom-right box is the PEEK (the whole pill
 * shown out of the folded right-edge tab). `peekBox` used `max = view.w - w` with no margin and
 * `flush = max` for a right-edge tab (0 for a left-edge one), so a 444 px pill at 1280 sat at
 * 836–1280; the overlay measured `w` as `el.offsetWidth` (an integer) while the real box was
 * 444.08 px, so it ended 0.08 px past the edge. `pillSpots` keeps PILL_MARGIN (824..1268).
 *
 * Now: the peek keeps PILL_MARGIN from either window edge like every other spot; the pointer that
 * opened it (on the tab, which may be in the 12 px gap) keeps it whole — the hold region is the
 * pill plus the tab's box (`peekHolds`); and the overlay measures the pill with
 * Math.ceil(getBoundingClientRect().width), so it never ends past the margin.
 */
import * as fs from "fs";
import * as path from "path";
import {
  peekBox,
  peekHolds,
  PILL_MARGIN,
  PILL_TAB,
  pillHome,
  pillSpots,
  tabBox,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 800 };
const home = pillHome({ view, size: { w: 444, h: 43 } }).box;
const leftTab = tabBox(home);
const rightTab: Rect = { ...leftTab, left: view.w - PILL_TAB.w };

describe("REQ-849 (demo-loop cycle dm3, p14) — the peek keeps PILL_MARGIN from the window's edges", () => {
  test("REQ-849 a right-edge tab at 1280: the peek's right edge is at most view.w - margin (the top-right spot's 1268, not 1280)", () => {
    const box = peekBox({ home, view, tab: rightTab });
    expect(box.left + box.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    // the same column as pillSpots' right spots (824..1268)
    const right = pillSpots({ home, view })[1];
    expect(box.left).toBe(right.left);
    expect(box.left + box.width).toBe(1268);
    // its foot still on the tab's foot
    expect(box.top + box.height).toBe(rightTab.top + rightTab.height);
  });

  test("REQ-849 a left-edge tab: the peek starts at the margin, not at 0", () => {
    const box = peekBox({ home, view, tab: leftTab });
    expect(box.left).toBe(PILL_MARGIN);
  });

  test("REQ-849 a tab along the bottom near either edge: centred, but never closer than the margin", () => {
    for (const left of [PILL_TAB.w + 4, view.w - 2 * PILL_TAB.w - 4]) {
      const box = peekBox({ home, view, tab: { ...leftTab, left } });
      expect(box.left).toBeGreaterThanOrEqual(PILL_MARGIN);
      expect(box.left + box.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    }
  });

  test("REQ-849 slid off controls along the row: every place it may take stays inside the margins", () => {
    for (const tab of [leftTab, rightTab]) {
      for (let bad = 0; bad < view.w; bad += 40) {
        // a control everywhere except a 40 px strip: it must pick within the margins anyway
        const controls = (r: Rect) =>
          r.left <= bad && bad < r.left + r.width ? 0 : 1;
        const box = peekBox({ home, view, tab, controls });
        expect(box.left).toBeGreaterThanOrEqual(PILL_MARGIN);
        expect(box.left + box.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
      }
    }
  });
});

describe("REQ-849 — the peek's hold region is the pill plus the tab's box (the pointer that opened it may be in the gap)", () => {
  const box = peekBox({ home, view, tab: rightTab });
  const midY = rightTab.top + rightTab.height / 2;

  test("REQ-849 a pointer in the 12 px gap, where the tab was: held", () => {
    expect(view.w - 4).toBeGreaterThan(box.left + box.width);
    expect(peekHolds({ pill: box, tab: rightTab, x: view.w - 4, y: midY }))
      .toBe(true);
  });

  test("REQ-849 a pointer on the pill: held; away from both: not held", () => {
    expect(
      peekHolds({ pill: box, tab: rightTab, x: box.left + 10, y: box.top + 5 }),
    )
      .toBe(true);
    expect(peekHolds({ pill: box, tab: rightTab, x: 640, y: 200 })).toBe(false);
    // in the gap but above the tab (beside the pill's top): not the tab's box
    expect(
      peekHolds({ pill: box, tab: rightTab, x: view.w - 4, y: box.top + 2 }),
    )
      .toBe(false);
  });

  test("REQ-849 no tab box or no pointer seen: only the pill counts", () => {
    expect(peekHolds({ pill: box, tab: null, x: view.w - 4, y: midY })).toBe(
      false,
    );
    expect(peekHolds({ pill: box, tab: rightTab, x: NaN, y: NaN })).toBe(false);
  });
});

describe("REQ-849 — the island's wiring", () => {
  const src = () => read("front-end/islands/DemoModeOverlay.tsx");

  test("REQ-849 the pill's width is measured rounded UP from its real box (never offsetWidth's rounding)", () => {
    // REQ-890 — the size is measured once into `size`, then kept in the slot of the form shown
    expect(src()).toMatch(
      /const size = \{\s*w: Math\.ceil\(\w+\.width\)[\s\S]{0,400}fullRef\.current = size;/,
    );
    expect(src()).not.toMatch(/fullRef\.current = \{ w: el\.offsetWidth/);
  });

  test("REQ-849 the fold timer is held by a pointer in the pill-plus-tab region (peekHolds), not only on the pill", () => {
    expect(src()).toMatch(/held: \(\) =>[\s\S]{0,600}peekHolds\(/);
  });
});
