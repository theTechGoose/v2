/**
 * REQ-876 — demo-loop cycle dm5, issue m2 (amends REQ-852 / REQ-866).
 *
 * Opening End's question moved the customer's pill ~630 px from where End was clicked: on
 * /welcome at 1280×800 the 444 px pill at the top-right (x823 y12) grew to 671 px and `askSpot`
 * took the FIRST box with no control under it — every top-row box covers the centred brand, both
 * bottom-row boxes the footer's phone link, the right of row 63 the wizard's EN | ES switch — so
 * (12,63) at the far left won, its answers ~630 px from the click at (1199,34)
 * (fleet-r38fa8936-3 stdout:92-101). REQ-852/866's rule stays (no control under the asking pill);
 * among the boxes with the fewest controls the one whose answers are nearest End's press wins, and
 * the anchor's row and the rows next to it are also tried in PILL_TAB.w/2 steps from the anchor's
 * edge.
 */
import * as fs from "fs";
import * as path from "path";
import {
  askDock,
  askSpot,
  PILL_BAND_GAP,
  PILL_MARGIN,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const counter = (cs: Rect[]) => (r: Rect) =>
  cs.filter((c) => overlap(r, c)).length;
/** the gap between two boxes (0 when they touch or overlap) */
const gap = (a: Rect, b: Rect) => {
  const dx = Math.max(
    0,
    b.left - (a.left + a.width),
    a.left - (b.left + b.width),
  );
  const dy = Math.max(
    0,
    b.top - (a.top + a.height),
    a.top - (b.top + b.height),
  );
  return Math.hypot(dx, dy);
};

const view = { w: 1280, h: 800 };
const h = 43;
const restW = 444;
const asking = { w: 671, h };
/** the whole pill at the top-right before End: left 823 (fleet-3 stdout:92) */
const topRightDock = {
  x: view.w - PILL_MARGIN - restW - PILL_MARGIN,
  y: PILL_MARGIN + h - (view.h - PILL_BAND_GAP),
};
/** /welcome's controls: the centred brand, the footer's phone link, the wizard's right-aligned
 *  EN | ES switch (.welcome__lang, align-self:flex-end in the 560 px centred column) in row 63 */
const brand: Rect = { left: 562, top: 28, width: 156, height: 34 };
const tel: Rect = { left: 592, top: 734, width: 96, height: 24 };
const lang: Rect = { left: 860, top: 70, width: 60, height: 28 };
const welcome = counter([brand, tel, lang]);
/** where the customer pressed End */
const click: Rect = { left: 1199, top: 34, width: 0, height: 0 };
/** the answers ("Sí, terminar" + "Seguir") inside the 671 px asking pill, as the demo measured
 *  them at x12: 521..671 → 509..659 from the pill's left */
const answers: Rect = { left: 509, top: 6, width: 150, height: 31 };
const answersAt = (fit: Rect, a: Rect = answers): Rect => ({
  left: fit.left + a.left,
  top: fit.top + a.top,
  width: a.width,
  height: a.height,
});

describe("REQ-876 (demo-loop cycle dm5, m2) — End's question opens near where End was pressed", () => {
  test("REQ-876 m2: the bug — first-clear alone takes (12,63), the answers ~500 px from the click", () => {
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: welcome,
    });
    expect(r.fit).toEqual({ left: 12, top: 63, width: 671, height: 43 });
    expect(gap(answersAt(r.fit), click)).toBeGreaterThan(400);
  });

  test("REQ-876 m2: /welcome at 1280×800 — no control under the asking pill and its answers within 150 px of the click at (1199,34)", () => {
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: welcome,
      near: click,
      answers,
    });
    expect(r.controls).toBe(0);
    expect(welcome(r.fit)).toBe(0);
    expect(gap(answersAt(r.fit), click)).toBeLessThanOrEqual(150);
    // inside the window, and the dock lays the pill out in exactly that box
    expect(r.fit.left).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(r.fit.left + r.fit.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    expect(r.fit.top).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(PILL_MARGIN + r.dock.x).toBe(r.fit.left);
    expect(view.h - PILL_BAND_GAP + r.dock.y - h).toBe(r.fit.top);
  });

  test("REQ-876 m2: no answers measured — the right end of the asking pill stands for them", () => {
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: welcome,
      near: click,
    });
    expect(r.controls).toBe(0);
    const end: Rect = {
      left: r.fit.left + r.fit.width - 150,
      top: r.fit.top,
      width: 150,
      height: r.fit.height,
    };
    expect(gap(end, click)).toBeLessThanOrEqual(150);
  });

  test("REQ-876 m2: the anchor's row is tried in PILL_TAB.w/2 steps from its edge — a box slid just clear of a control wins over the far edge and the centre", () => {
    // row 12: a control at each end and one under the centred box; every other row holds a control
    const cs: Rect[] = [
      { left: 1240, top: 20, width: 20, height: 20 },
      { left: 0, top: 20, width: 40, height: 20 },
      { left: 300, top: 20, width: 20, height: 20 },
      { left: 0, top: 60, width: 1280, height: 740 },
    ];
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter(cs),
      near: click,
      answers,
    });
    expect(r.controls).toBe(0);
    expect(r.fit.top).toBe(PILL_MARGIN);
    // slid left from the right edge just past the control at 1240, not the far-left 321..568 end
    expect(r.fit.left).toBeGreaterThan(500);
    expect(r.fit.left + r.fit.width).toBeLessThanOrEqual(1240);
  });

  test("REQ-876 m2 (e2e-measured): the clear gap between two of the page's controls is off the pill-height grid — rows are also tried in a third of that step, so it is found", () => {
    // /welcome as the e2e met it: the mini-pill's × pressed at (82,616), the 912 px asking pill
    // anchored at 12,589 over "Omitir configuración" (536,565 209×36); the wizard's controls fill
    // the centred column except a 53 px gap from 603 to 655. On REQ-866's grid (589 ± 51k) every
    // row holds a control and the pill went to 12,232 — its answers 765 px from the press
    const wide = { w: 912, h };
    const dock = { x: 0, y: -160 };
    const cs: Rect[] = [
      { left: 400, top: 0, width: 500, height: 603 },
      { left: 400, top: 656, width: 500, height: 144 },
    ];
    const r = askSpot({
      view,
      dock,
      size: wide,
      controls: counter(cs),
      near: { left: 82, top: 616, width: 0, height: 0 },
      answers: { left: 751, top: 7, width: 149, height: 29 },
    });
    expect(askDock({ view, dock, size: wide }).fit.top).toBe(589);
    expect(r.controls).toBe(0);
    expect(r.fit.top).toBeGreaterThanOrEqual(603);
    expect(r.fit.top + r.fit.height).toBeLessThanOrEqual(656);
  });

  test("REQ-876 REQ-300: a clear current anchor keeps its dock (the same object) with a press too", () => {
    const dock = { x: 0, y: 0 };
    const r = askSpot({
      view,
      dock,
      size: asking,
      controls: () => 0,
      near: { left: 1000, top: 700, width: 0, height: 0 },
    });
    expect(r.dock).toBe(dock);
  });

  test("REQ-876: nothing clear — the fewest still wins, the nearest of those (here, the anchor)", () => {
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: () => 1,
      near: click,
      answers,
    });
    expect(r.controls).toBe(1);
    expect(r.dock).toEqual(
      askDock({ view, dock: topRightDock, size: asking }).dock,
    );
  });

  describe("REQ-876 the island's wiring", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");

    test("placeAsk passes where End was pressed and the answers' box to askSpot", () => {
      const i = o.indexOf("const placeAsk = () => {");
      expect(i).toBeGreaterThanOrEqual(0);
      const body = o.slice(i, o.indexOf("\n  };", i));
      expect(body).toMatch(/askSpot\(/);
      expect(body).toMatch(/near[,:]/);
      expect(body).toMatch(/answers[,:]/);
      expect(body).toMatch(/demo-end-confirm/);
      expect(body).toMatch(/endPressRef\.current/);
    });

    test("a press on the pill is recorded (endPressRef) so the question knows where End was", () => {
      expect(o).toMatch(/endPressRef = useRef/);
      expect(o).toMatch(
        /onPointerDownCapture=\{[\s\S]{0,200}endPressRef\.current =/,
      );
    });
  });
});
