/**
 * REQ-818 — demo-loop cycle dm1, issue m5 "Demo pill covers page content (sidebar Log out, phone
 * headings, footer) and changes corners between pages". Raphael: "fix every issue the demo found,
 * loop until there are none".
 *
 * REQ-781 promises the floating pill is never over a control. Two places broke it:
 *   - placePill's last resort (`fold(tab() ?? tabs[0])`, also under a dialog) put the mini-pill on
 *     tabs[0], the bottom-left edge, a spot already known to hold a control — at 1280×800 on
 *     /customers that is the sidebar's Log out button (0,760). It now takes the spot with the
 *     FEWEST controls, and the mini-pill may also sit along the bottom edge, not only up the sides.
 *   - the pill shown out of its mini-pill (the peek) sat flush with the tab's edge whatever was
 *     under it (the footer's "SMS terms" link). `peekBox` slides it along the tab's row to the
 *     place with the fewest controls, nearest the edge first, always inside the window.
 * Covering text stays allowed (REQ-781).
 */
import * as fs from "fs";
import * as path from "path";
import {
  peekBox,
  PILL_MARGIN,
  PILL_TAB,
  pillHome,
  pillSpots,
  placePill,
  tabBox,
  tabSpots,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 800 };
const h = pillHome({ view, size: { w: 520, h: 43 } });
const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;

/** a page whose controls are boxes: how many of them a box touches */
const page = (ctrls: Rect[]) => (r: Rect) =>
  ctrls.filter((c) => overlap(r, c)).length;

describe("REQ-818 (demo-loop cycle dm1, m5) — the pill's last resort is the spot with the fewest controls", () => {
  test("REQ-818 at 1280×800 the first mini-pill spot is 0,760 — over the sidebar's Log out button", () => {
    const t = tabSpots(h.box, view);
    expect(t[0]).toEqual({ left: 0, top: 760, width: 96, height: 32 });
    const logout = { left: 16, top: 742, width: 196, height: 42 };
    expect(overlap(t[0], logout)).toBe(true);
  });

  test("REQ-818 the mini-pill may also sit along the bottom edge (stepping across), all inside the window", () => {
    const t = tabSpots(h.box, view);
    const foot = t[0].top;
    const across = t.filter((r) =>
      r.top === foot && r.left > 0 && r.left < view.w - PILL_TAB.w
    );
    expect(across.length).toBeGreaterThan(3);
    for (const r of t) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(view.w);
    }
    // the side edges come first, as REQ-781 asked
    expect(t[0]).toEqual(tabBox(h.box));
    expect(t[1]).toEqual({ ...tabBox(h.box), left: view.w - PILL_TAB.w });
  });

  test("REQ-818 every spot holds a control except one partly clear spot: that spot is chosen, never tabs[0]", () => {
    const tabs = tabSpots(h.box, view);
    const spots = pillSpots({ home: h.box, view });
    const partly = tabs[5];
    // two controls under every spot, one under `partly` — nothing is clear
    const controls = (r: Rect) => (same(r, partly) ? 1 : 2);
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 3,
      controls,
    });
    expect(p).toEqual({ box: partly, tucked: true, band: false });
    expect(spots.every((r) => controls(r) > 0)).toBe(true);
  });

  test("REQ-818 the partly clear spot may be a whole one: the whole pill goes there", () => {
    const centre = pillSpots({ home: h.box, view })[2];
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 3,
      controls: (r) => (same(r, centre) ? 1 : 2),
    });
    expect(p).toEqual({ box: centre, tucked: false, band: false });
  });

  test("REQ-818 a dialog with nowhere to dock: the mini-pill goes to the tab spot with the fewest controls", () => {
    const tabs = tabSpots(h.box, view);
    const partly = tabs[3];
    const p = placePill({
      home: h.box,
      view,
      dialog: true,
      blocked: () => 1,
      controls: (r) => (same(r, partly) ? 1 : 2),
    });
    expect(p).toEqual({ box: partly, tucked: true, band: false });
  });

  test("REQ-818 the /customers layout: Log out at the bottom-left and controls on both side edges — the mini-pill lands along the bottom, off Log out", () => {
    const logout = { left: 16, top: 742, width: 196, height: 42 };
    const sidebar = { left: 0, top: 0, width: 228, height: 740 };
    const rightRail = { left: 1180, top: 0, width: 100, height: 800 };
    const row = { left: 260, top: 300, width: 900, height: 400 };
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 3,
      controls: page([logout, sidebar, rightRail, row]),
    });
    expect(p.tucked).toBe(true);
    expect(overlap(p.box, logout)).toBe(false);
    expect(page([logout, sidebar, rightRail, row])(p.box)).toBe(0);
  });
});

describe("REQ-818 (demo-loop cycle dm1, m5) — the pill shown out of its mini-pill slides off a control along the tab's row", () => {
  const whole = { w: 520, h: 43 };
  const homeBox = pillHome({ view, size: whole }).box;

  // REQ-849 (cycle dm3, p14) AMENDMENT — at the tab's edge, PILL_MARGIN in (the tab's box holds it)
  test("REQ-818 nothing under it: at the tab's edge, PILL_MARGIN in (REQ-849)", () => {
    const left = peekBox({
      home: homeBox,
      view,
      tab: tabBox(homeBox),
      controls: () => 0,
    });
    expect(left.left).toBe(PILL_MARGIN);
    expect(left.top + left.height).toBe(
      tabBox(homeBox).top + tabBox(homeBox).height,
    );
    const rightTab = { ...tabBox(homeBox), left: view.w - PILL_TAB.w };
    const right = peekBox({
      home: homeBox,
      view,
      tab: rightTab,
      controls: () => 0,
    });
    expect(right.left + right.width).toBe(view.w - PILL_MARGIN);
  });

  test("REQ-818 a peek box over a footer link slides off it, inside the window", () => {
    const tab = tabBox(homeBox);
    const flush = {
      ...homeBox,
      left: 0,
      top: tab.top + tab.height - homeBox.height,
    };
    // the footer's "SMS terms" link under the flush box's right half
    const link = { left: 300, top: flush.top, width: 200, height: 20 };
    const controls = page([link]);
    expect(controls(flush)).toBe(1);
    const box = peekBox({ home: homeBox, view, tab, controls });
    expect(controls(box)).toBe(0);
    expect(box.top).toBe(flush.top);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(view.w);
  });

  test("REQ-818 controls all along the row: the place with the fewest, nearest the tab's edge", () => {
    const tab = tabBox(homeBox);
    const top = tab.top + tab.height - homeBox.height;
    const links = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      left: i * 200,
      top,
      width: 20,
      height: 20,
    }));
    const controls = page(links);
    const box = peekBox({ home: homeBox, view, tab, controls });
    let best = Infinity;
    for (let x = 0; x <= view.w - homeBox.width; x++) {
      best = Math.min(best, controls({ ...homeBox, left: x, top }));
    }
    // REQ-873 (cycle dm5, p5) AMENDMENT — the row's fewest is the last resort: every x on this row
    // holds a control (best > 0), so the peek takes the nearest clear row instead
    expect(best).toBeGreaterThan(0);
    expect(controls(box)).toBe(0);
    expect(box.top).not.toBe(top);
    // nothing clear anywhere: the row's fewest, as REQ-818 had it
    const everywhere = (r: Rect) => r.top === top ? controls(r) : 9;
    const last = peekBox({ home: homeBox, view, tab, controls: everywhere });
    expect(last.top).toBe(top);
    expect(controls(last)).toBe(best);
    expect(box.left + box.width).toBeLessThanOrEqual(view.w);
  });

  test("REQ-818 the overlay places the peek through peekBox with countControls", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(
      /peekBox\(\{[\s\S]{0,200}controls:\s*can && peekRef\.current\s*\?\s*(\(r\) => )?countControls/,
    );
  });
});
