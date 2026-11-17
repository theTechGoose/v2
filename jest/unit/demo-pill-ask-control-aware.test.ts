/**
 * REQ-852 — demo-loop cycle dm3, issue p4 (amends REQ-228 / REQ-835).
 *
 * End's question widened the customer's pill where it stood and REQ-835's clamp only pulled it
 * back inside the window: on /welcome the 444 px pill at the top-right (824..1268 x 12..55) grew
 * to 671 px and was moved to 597..1268, over the centred DocuMonster brand link (565..718 x
 * 30..58), a control. The asking box is now placed once, control-aware (`askSpot`): the current
 * anchor, the same row at the opposite edge, then the bottom row; first with no control, else the
 * fewest; REQ-835's in-view clamp last; REQ-300's freeze after.
 */
// REVISION (demo-loop run 16, by hand): another [asking] effect (Keep going's guard, REQ-890 AMENDMENT 6) sits before the layout effect; it is found by its first line.
import * as fs from "fs";
import * as path from "path";
import {
  askDock,
  askSpot,
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillSpots,
  placePill,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
/** controls under a box: how many of `cs` it overlaps */
const counter = (cs: Rect[]) => (r: Rect) =>
  cs.filter((c) => overlap(r, c)).length;

const view = { w: 1280, h: 800 };
/** /welcome's `<a href="/" class="welcome-shell__brand">` as the demo measured it */
const brand: Rect = { left: 565, top: 30, width: 153, height: 28 };
/** the whole 444 px pill at the top-right pillSpot: 824..1268 x 12..55 */
const restW = 444;
const h = 43;
const topRightDock = {
  x: view.w - PILL_MARGIN - restW - PILL_MARGIN, // 812 → left 824
  y: PILL_MARGIN + h - (view.h - PILL_BAND_GAP), // foot at 55
};
const asking = { w: 671, h };

describe("REQ-852 (demo-loop cycle dm3, p4) — the asking pill is placed where no control is", () => {
  test("REQ-852 p4: the bug — REQ-835's clamp alone puts the asking pill at 597..1268 x 12..55, over the brand link", () => {
    const { fit } = askDock({ view, dock: topRightDock, size: asking });
    expect(fit).toEqual({ left: 597, top: 12, width: 671, height: 43 });
    expect(overlap(fit, brand)).toBe(true);
  });

  test("REQ-852 p4: /welcome — top-right 444 px pill growing to 671 px leaves the top row (both edges cover the brand) for the bottom-left", () => {
    const { dock, fit } = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter([brand]),
    });
    expect(overlap(fit, brand)).toBe(false);
    expect(fit).toEqual({
      left: PILL_MARGIN,
      top: view.h - PILL_BAND_GAP - h,
      width: 671,
      height: 43,
    });
    // the dock lays the pill out in exactly that box (left:12 + foot PILL_BAND_GAP up, translated)
    expect(PILL_MARGIN + dock.x).toBe(fit.left);
    expect(view.h - PILL_BAND_GAP + dock.y - h).toBe(fit.top);
  });

  test("REQ-852 p4: the same row at the opposite edge is tried before the bottom row", () => {
    // a control only at the top-right: the top-left of the same row is clear
    const right: Rect = { left: 1100, top: 20, width: 60, height: 30 };
    const { fit } = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter([right]),
    });
    expect(fit).toEqual({ left: PILL_MARGIN, top: 12, width: 671, height: 43 });
  });

  test("REQ-852 p4: then the bottom-right when the bottom-left has a control", () => {
    const cs = [brand, { left: 40, top: 760, width: 80, height: 20 }];
    const { fit } = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter(cs),
    });
    expect(fit).toEqual({
      left: view.w - PILL_MARGIN - 671,
      top: view.h - PILL_BAND_GAP - h,
      width: 671,
      height: 43,
    });
  });

  test("REQ-852 REQ-300: a clear current anchor keeps its dock (the same object) — nothing moves", () => {
    const dock = { x: 0, y: 0 };
    const r = askSpot({ view, dock, size: asking, controls: () => 0 });
    expect(r.dock).toBe(dock);
  });

  test("REQ-852: no place is clear — the fewest controls wins, a tie keeps the current anchor", () => {
    const all = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: () => 2,
    });
    expect(all.dock).toEqual(
      askDock({ view, dock: topRightDock, size: asking }).dock,
    );
    // the bottom-left has 1, the rest 3: the bottom-left
    const few = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: (r) => (r.left === PILL_MARGIN && r.top > 400 ? 1 : 3),
    });
    expect(few.fit.left).toBe(PILL_MARGIN);
    expect(few.fit.top).toBe(view.h - PILL_BAND_GAP - h);
  });

  test("REQ-852 REQ-835: every candidate is kept in view (a 390 phone, the asking pill wider than the window)", () => {
    const phone = { w: 390, h: 844 };
    const { fit } = askSpot({
      view: phone,
      dock: { x: 0, y: 0 },
      size: { w: 500, h: 80 },
      controls: () => 1,
    });
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.top).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(fit.top + fit.height).toBeLessThanOrEqual(phone.h);
  });

  describe("REQ-852 the island's wiring", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");

    test("End's question coming up places the asking box once with askSpot + countControls (through the dialog backdrop), then REQ-835's clamp", () => {
      const effect = o.match(
        /useLayoutEffect\(\(\) => \{\s*if \(!asking\) return;[\s\S]*?\}, \[asking\]\);/,
      );
      expect(effect).not.toBeNull();
      expect(effect![0]).toMatch(/placeAsk\(\);\s*clampAsk\(\);/);
      const i = o.indexOf("const placeAsk = () => {");
      expect(i).toBeGreaterThanOrEqual(0);
      const body = o.slice(i, o.indexOf("\n  };", i));
      expect(body).toMatch(/askSpot\(/);
      expect(body).toMatch(/countControls\(r, backdrop\)/);
      expect(body).toMatch(/dialogBackdropUp\(\)/);
      expect(body).toMatch(/offsetWidth/);
    });

    test("REQ-300: place()'s asking branch still only clamps — no re-choosing while End asks", () => {
      const i = o.indexOf("const place = () => {");
      const branch = o.slice(i, o.indexOf("setCompact(isNarrow());", i));
      expect(branch).not.toMatch(/placeAsk\(/);
      expect(branch).toMatch(/clampAsk\(\);\s*sendPill\(\);\s*return;/);
    });
  });
});

/**
 * REQ-866 — demo-loop cycle dm4, issues m2 + m2b (amends REQ-852 / REQ-781 / REQ-818).
 *
 * m2: REQ-852's fixture modelled only /welcome's brand, so the bottom row looked clear. The real
 * /welcome also renders the full SiteFooter at the window's foot: its centred phone link
 * (a[href^=tel], about 592..688 × 734..758) is under both bottom-row boxes. Every one of
 * askSpot's five boxes then held one control, the tie kept the top-right anchor, and End's
 * question covered the brand again (fleet-rf5fcb8b9-0 stdout:60: [597,12,671,43]).
 * m2b: a whole pill that may not fold (REQ-821's join grace, REQ-298's restart line) fell back to
 * home blindly when every spot held a control — over the sidebar's Log out at 12,749
 * (fleet-rf5fcb8b9-3 stdout:83-86) — instead of REQ-818's fewest-controls last resort.
 */
describe("REQ-866 (demo-loop cycle dm4, m2 + m2b) — the pill's fallbacks count controls", () => {
  /** /welcome's brand link as the dm4 demo measured it */
  const welcomeBrand: Rect = { left: 562, top: 28, width: 156, height: 34 };
  /** /welcome's full SiteFooter: the centred, bold phone link at the window's foot */
  const welcomeTel: Rect = { left: 592, top: 734, width: 96, height: 24 };

  test("REQ-866 m2: the bug — with the footer's phone link every one of REQ-852's five boxes holds a control", () => {
    const count = counter([welcomeBrand, welcomeTel]);
    const rightX = view.w - 2 * PILL_MARGIN - asking.w;
    const rowY = topRightDock.y;
    for (
      const d of [
        { x: rightX, y: rowY },
        { x: 0, y: rowY },
        { x: 0, y: 0 },
        { x: rightX, y: 0 },
      ]
    ) {
      const { fit } = askDock({ view, dock: d, size: asking });
      expect(count(fit)).toBe(1);
    }
  });

  test("REQ-866 m2: /welcome at 1280×800 — End's 671 px question covers neither the brand nor the footer's phone link", () => {
    const count = counter([welcomeBrand, welcomeTel]);
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: count,
    });
    expect(count(r.fit)).toBe(0);
    expect(overlap(r.fit, welcomeBrand)).toBe(false);
    expect(overlap(r.fit, welcomeTel)).toBe(false);
    // inside the window, a margin from every edge
    expect(r.fit.left).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(r.fit.left + r.fit.width).toBeLessThanOrEqual(view.w - PILL_MARGIN);
    expect(r.fit.top).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(r.fit.top + r.fit.height).toBeLessThanOrEqual(
      view.h - PILL_BAND_GAP,
    );
    // the dock lays the pill out in exactly that box
    expect(PILL_MARGIN + r.dock.x).toBe(r.fit.left);
    expect(view.h - PILL_BAND_GAP + r.dock.y - h).toBe(r.fit.top);
    // and it says how many controls are under it, so the island can tell a clear box
    expect(r.controls).toBe(0);
  });

  test("REQ-866 m2: rows between the top and the bottom are tried, nearest the anchor first, a pill height plus a gap apart", () => {
    // controls at the window's left, right and centre in the top and bottom rows only
    const cs = [welcomeBrand, welcomeTel, {
      left: 20,
      top: 20,
      width: 40,
      height: 20,
    }, {
      left: 1200,
      top: 760,
      width: 40,
      height: 20,
    }];
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter(cs),
    });
    expect(r.controls).toBe(0);
    // the next row down from the top one: top 12 + 43 + 8
    expect(r.fit.top).toBe(PILL_MARGIN + h + PILL_BAND_GAP);
  });

  test("REQ-866 m2: a centred box in a row is tried when both edges hold a control", () => {
    // every row's left and right ends hold a control; the middle is clear below the brand
    const edges: Rect[] = [];
    for (let y = 0; y < view.h; y += 20) {
      edges.push({ left: 0, top: y, width: 300, height: 10 });
      edges.push({ left: 980, top: y, width: 300, height: 10 });
    }
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: counter([...edges, welcomeBrand]),
    });
    expect(r.controls).toBe(0);
    expect(r.fit.left).toBe(Math.round((view.w - asking.w) / 2));
  });

  test("REQ-866 m2: nothing clear anywhere — the fewest still wins and a tie keeps the anchor (REQ-852)", () => {
    const r = askSpot({
      view,
      dock: topRightDock,
      size: asking,
      controls: () => 2,
    });
    expect(r.controls).toBe(2);
    expect(r.dock).toEqual(
      askDock({ view, dock: topRightDock, size: asking }).dock,
    );
  });

  // m2b — a whole pill that may not fold
  const home: Rect = {
    left: PILL_MARGIN,
    top: view.h - PILL_BAND_GAP - h,
    width: restW,
    height: h,
  };
  const same = (a: Rect, b: Rect) =>
    a.left === b.left && a.top === b.top && a.width === b.width &&
    a.height === b.height;
  /** /customers at 1280×800: page under every spot; home over Log out + two footer links */
  const controlsAt = (r: Rect) => (same(r, home) ? 3 : 1);

  test("REQ-866 m2b: yields:false (the join grace) — every spot holds a control, home the most: the pill is NOT placed at home", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked: () => 5,
      controls: controlsAt,
    });
    expect(p.tucked).toBe(false);
    expect(same(p.box, home)).toBe(false);
    expect(controlsAt(p.box)).toBe(1);
    expect(pillSpots({ home, view }).some((s) => same(s, p.box))).toBe(true);
  });

  test("REQ-866 m2b: /customers with no customers yet (ES, 1280×800, the measured counts) — every pillSpot holds 3 controls: a row between, clear of controls, is taken", () => {
    // measured on the real page (e2e/demo-mode/demo-pill-fallback-controls): the 563 px whole pill
    // at home 3 (Cerrar sesión + 2 footer links), bottom-right 3, bottom-centre 5, top-left 3,
    // top-right 3; above the footer on the right only the empty page
    const w = 563;
    const home563: Rect = { ...home, width: w };
    const spots = pillSpots({ home: home563, view });
    const right = view.w - PILL_MARGIN - w;
    const clearRow = home.top - (h + PILL_BAND_GAP); // 698
    const counts = (r: Rect) => {
      const i = spots.findIndex((s) => same(s, r));
      if (i >= 0) return [3, 3, 3, 3, 3][i];
      return r.left === right && r.top === clearRow ? 0 : 2;
    };
    const p = placePill({
      home: home563,
      view,
      dialog: false,
      yields: false,
      blocked: () => 5,
      controls: counts,
    });
    expect(p.tucked).toBe(false);
    expect(p.box).toEqual({ ...home563, left: right, top: clearRow });
  });

  test("REQ-866 m2b: among the rows between, one with nothing of the page under it comes first", () => {
    const rows: Rect[] = [];
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked: (r) => {
        rows.push(r);
        return r.top === 290 && r.left === PILL_MARGIN ? 0 : 5;
      },
      controls: (r) => (r.top < 700 && r.top > 60 ? 0 : 2),
    });
    // the nearest clear-of-controls row would be 698; the one with nothing under it wins
    const want = rows.find((r) => r.top === 290 && r.left === PILL_MARGIN);
    expect(want).toBeDefined();
    expect(p.box).toEqual(want);
  });

  test("REQ-866 m2b: the ended notice (floats) takes the fewest too, never home over Log out", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked: () => 5,
      controls: controlsAt,
    });
    expect(p.tucked).toBe(false);
    expect(controlsAt(p.box)).toBe(1);
  });

  test("REQ-866 m2b: a dialog with no dock free — a pill that may not fold takes the spot with the fewest controls, not home", () => {
    const p = placePill({
      home,
      view,
      dialog: true,
      yields: false,
      blocked: () => 5,
      controls: controlsAt,
    });
    expect(p.tucked).toBe(false);
    expect(same(p.box, home)).toBe(false);
    expect(controlsAt(p.box)).toBe(1);
  });

  test("REQ-866 m2b: tied on controls, the spot with less of the page under it wins", () => {
    const spots = pillSpots({ home, view });
    const quiet = spots[2];
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked: (r) => (same(r, quiet) ? 1 : 5),
      controls: () => 1,
    });
    expect(same(p.box, quiet)).toBe(true);
  });

  test("REQ-866 m2b: home still wins when it is as good as any (a tie on both keeps home)", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked: () => 5,
      controls: () => 1,
    });
    expect(same(p.box, home)).toBe(true);
  });
});
