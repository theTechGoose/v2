/**
 * REQ-890 — demo-loop run 6 (r1feab847), issues m1 + m2 (re-check 11 of REQ-873 did not hold), fixed
 * by hand on Raphael's instruction ("you personally go fix the polish problems").
 *
 * Reproduced at 700×800 on /customers (EN, 405 px pill, tab folded at (0,560)): the tab's row has a
 * control under every x, so REQ-873 moved the peek to the nearest control-free box — (252,702),
 * three rows down and 250 px right of the tab, over the empty-state text. The pointer that opened
 * it then travelled from the tab to the pill through a gap `peekHolds` does not count, so the peek
 * folded under it (m2: "re-folds / element detached"). In ES (501 px) no control-free box exists
 * at all, so it fell back to the tab's row over the filter chips (m1).
 *
 * Now: (1) before leaving the tab's row, `peekBox` tries the pill's COMPACT form (the ≤640 px one:
 * name · status · End) at the same x's and rows, and returns it flagged `compact` when that is the
 * first control-free box; when neither form has a clear box it returns the row's fewest flagged
 * `crowded`, so the overlay can switch to the compact form and measure again. (2) `peekHolds`
 * counts the corridor between the tab and the pill for PEEK_TRAVEL_MS after the opening, so the
 * pointer reaching a peek that opened away from the tab does not fold it on the way.
 */
import * as fs from "fs";
import * as path from "path";
import {
  PEEK_TRAVEL_MS,
  peekBox,
  peekHolds,
  PILL_MARGIN,
  pillHome,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const page = (controls: Rect[]) => (r: Rect) =>
  controls.filter((c) => overlap(r, c)).length;

// 700×800 /customers as measured: the sidebar's buttons (x 16-212), the filter chips, Sort and Export
const view = { w: 700, h: 800 };
const tab: Rect = { left: 0, top: 560, width: 96, height: 32 };
const sidebar: Rect[] = [
  { left: 16, top: 410, width: 196, height: 42 }, // Field
  { left: 16, top: 454, width: 196, height: 42 }, // Roles
  { left: 16, top: 498, width: 196, height: 42 }, // Reports
  { left: 16, top: 638, width: 196, height: 52 }, // account
  { left: 16, top: 698, width: 196, height: 42 }, // Add a worker
  { left: 16, top: 742, width: 196, height: 42 }, // Log out
];
const content: Rect[] = [
  { left: 270, top: 418, width: 380, height: 42 }, // Open the assistant
  { left: 261, top: 523, width: 65, height: 30 },
  { left: 330, top: 523, width: 74, height: 30 },
  { left: 407, top: 523, width: 109, height: 30 },
  { left: 521, top: 523, width: 81, height: 30 },
  { left: 261, top: 557, width: 97, height: 30 },
  { left: 362, top: 557, width: 98, height: 30 },
  { left: 464, top: 557, width: 79, height: 30 },
  { left: 259, top: 597, width: 402, height: 32 }, // Sort
  { left: 259, top: 637, width: 402, height: 35 }, // Export
];
const controls = page([...sidebar, ...content]);
const whole = pillHome({ view, size: { w: 405, h: 43 } }).box; // EN at 700
const wholeEs = pillHome({ view, size: { w: 501, h: 43 } }).box; // ES at 700
const compact = { w: 236, h: 43 }; // "● Alex · Connected · End demo"

describe("REQ-890 (run 6, m1 + m2) — a crowded tab row opens the compact pill before moving away", () => {
  test("the bug: at 700 px the whole EN pill's only clear box is rows away from the tab", () => {
    const box = peekBox({ home: whole, view, tab, controls });
    expect(controls(box)).toBe(0);
    expect(Math.abs(box.top - (tab.top + tab.height - whole.height)))
      .toBeGreaterThan(100);
  });

  test("with the compact size offered, the peek opens compact on the tab's row, flush with the tab", () => {
    const box = peekBox({ home: whole, view, tab, controls, compact });
    expect(box.compact).toBe(true);
    expect(box.width).toBe(compact.w);
    expect(box.height).toBe(compact.h);
    expect(box.left).toBe(PILL_MARGIN);
    expect(box.top + box.height).toBe(tab.top + tab.height);
    expect(controls(box)).toBe(0);
  });

  test("the whole pill fits on its row: no compact, as before", () => {
    const box = peekBox({ home: whole, view, tab, controls: () => 0, compact });
    expect(box.compact).toBeFalsy();
    expect(box.crowded).toBeFalsy();
    expect(box.width).toBe(whole.width);
  });

  test("ES 501 px with no compact size known: the row's fewest, flagged crowded so the overlay can switch", () => {
    const box = peekBox({
      home: wholeEs,
      view,
      tab,
      controls: page([...sidebar, ...content, {
        left: 0,
        top: 0,
        width: 700,
        height: 800,
      }]),
    });
    expect(box.crowded).toBe(true);
    expect(box.compact).toBeFalsy();
  });

  test("a clear box for neither form: the whole row's fewest, still flagged crowded", () => {
    const everywhere = page([{ left: 0, top: 0, width: 700, height: 800 }]);
    const box = peekBox({
      home: whole,
      view,
      tab,
      controls: everywhere,
      compact,
    });
    expect(box.crowded).toBe(true);
    expect(box.width).toBe(whole.width);
  });
});

describe("REQ-890 — the pointer travelling from the tab to a peek that opened away is not a leave", () => {
  const pill: Rect = { left: 252, top: 702, width: 405, height: 43 };
  const corridor = { x: 150, y: 640 }; // between the tab (0,560) and the pill (252,702)
  test("inside the tab-to-pill corridor within PEEK_TRAVEL_MS of the opening: held", () => {
    expect(
      peekHolds({
        pill,
        tab,
        ...corridor,
        since: 1_000,
        now: 1_000 + PEEK_TRAVEL_MS - 1,
      }),
    ).toBe(true);
  });
  test("the same point after the travel time: not held (the pointer is simply off the pill)", () => {
    expect(
      peekHolds({
        pill,
        tab,
        ...corridor,
        since: 1_000,
        now: 1_000 + PEEK_TRAVEL_MS + 1,
      }),
    ).toBe(false);
  });
  test("outside the corridor during the travel time: not held", () => {
    expect(peekHolds({ pill, tab, x: 680, y: 100, since: 1_000, now: 1_100 }))
      .toBe(false);
  });
  test("no `since`: the REQ-849 rule alone (pill or tab)", () => {
    expect(peekHolds({ pill, tab, ...corridor })).toBe(false);
    expect(peekHolds({ pill, tab, x: 300, y: 720 })).toBe(true);
    expect(peekHolds({ pill, tab, x: 40, y: 570 })).toBe(true);
  });
});

/**
 * REQ-890 AMENDMENT — a peek opened by the tab's × (End asked) is never switched to the compact
 * form. The REQ-866 m2 / REQ-876 e2e on /welcome at 1280×800 went red with REQ-890: the whole
 * pill's row holds the wizard's Skip link, so the switch made the question the compact form,
 * wrapped to two rows (74 px) — which no longer fit the 75 px gap between that link and the
 * footer's links, so `askSpot` (REQ-876) moved it 426 px from the press. The question has its own
 * placement; the whole pill's one row (43 px) fits.
 */
describe("REQ-890 AMENDMENT — End asked from the tab: the peek stays the whole form", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../front-end/islands/DemoModeOverlay.tsx"),
    "utf8",
  );
  test("the tab's × marks the peek as End's before opening it; the switch is gated on the mark; folding clears it", () => {
    expect(src).toMatch(
      /setAskEnd\(true\);\s*peekForAskRef\.current = true;[^\n]*\n\s*openPeek\(\);/,
    );
    expect(src).toMatch(
      /p\.tucked && peekRef\.current && !compactNow && !peekForAskRef\.current/,
    );
    expect(src).toMatch(
      /if \(!peek\) \{\s*setPeekCompact\(false\);\s*peekForAskRef\.current = false;/,
    );
  });
});
