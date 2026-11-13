/**
 * REQ-781 — demo-loop cycle dv1, issue d7 "No empty strip is reserved for the demo pill".
 * Raphael: "the gap reserved for the demo pill ... that's not a decision" (fix it).
 *
 * REQ-379 reserved a band under the page for the customer's pill (`--demo-pill-h`, the body's
 * bottom padding, the shells subtract it) and REQ-440 painted it; REQ-643 kept it while the pill
 * sat home. At 1280×720 that was an empty ~64 px strip under every app page. Now no band is ever
 * kept: the pill floats over the page, in the first place where nothing of the page is under it
 * (bottom-left, bottom-right, bottom-centre, top-right, top-left), else folded to its mini-pill at
 * an edge with no control under it, else whole where no control is under it.
 */
import * as fs from "fs";
import * as path from "path";
import {
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

const view = { w: 1280, h: 720 };
const h = pillHome({ view, size: { w: 520, h: 44 } });
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;

describe("REQ-781 (demo-loop cycle dv1, d7) — the pill floats: no band, never over a control", () => {
  test("REQ-781 the spots: home first, then bottom-right, bottom-centre, top-right, top-left — all inside the window", () => {
    const s = pillSpots({ home: h.box, view, top: 0 });
    expect(s[0]).toEqual(h.box);
    expect(s[1].left + s[1].width).toBe(view.w - 12);
    expect(s[1].top).toBe(h.box.top);
    expect(Math.round(s[2].left + s[2].width / 2)).toBe(view.w / 2);
    expect(s[3].top).toBe(12);
    expect(s[3].left + s[3].width).toBe(view.w - 12);
    expect(s[4]).toEqual({ ...h.box, top: 12 });
    for (const r of s) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(view.w);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.top + r.height).toBeLessThanOrEqual(view.h);
    }
    // under the impersonation banner
    expect(pillSpots({ home: h.box, view, top: 40 })[3].top).toBe(52);
  });

  test("REQ-781 the mini-pill's spots: the left edge (tabBox), the right edge, then up both edges", () => {
    const t = tabSpots(h.box, view);
    expect(t[0]).toEqual(tabBox(h.box));
    expect(t[1]).toEqual({
      ...tabBox(h.box),
      left: view.w - PILL_TAB.w,
    });
    expect(t[2]).toEqual({ ...t[0], top: t[0].top - PILL_TAB.h - 8 });
    expect(t[3]).toEqual({ ...t[1], top: t[1].top - PILL_TAB.h - 8 });
    for (const r of t) expect(r.top).toBeGreaterThanOrEqual(12);
    // never under the impersonation banner
    for (const r of tabSpots(h.box, view, 40)) {
      expect(r.top).toBeGreaterThanOrEqual(52);
    }
  });

  test("REQ-781 a control at both bottom edges (a phone footer's links): the mini-pill moves up an edge", () => {
    const t = tabSpots(h.box, view);
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 2,
      controls: (r) => (r.top >= t[0].top - 1 ? 1 : 0),
    });
    expect(p).toEqual({ box: t[2], tucked: true, band: false });
  });

  test("REQ-781 never a band: home clear, the pill sits home over the page (band false)", () => {
    const p = placePill({ home: h.box, view, dialog: false, blocked: () => 0 });
    expect(p).toEqual({ box: h.box, tucked: false, band: false });
  });

  test("REQ-781 the page under the home (a sidebar's Log out): the pill floats whole to the first clear spot", () => {
    const right = pillSpots({ home: h.box, view })[1];
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: (r) => (same(r, right) ? 0 : 2),
    });
    expect(p).toEqual({ box: right, tucked: false, band: false });
  });

  test("REQ-781 no spot clear: the mini-pill at an edge with no control under it (the right edge when the left has one)", () => {
    const [left, rightTab] = tabSpots(h.box, view);
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 2,
      controls: (r) => (same(r, left) ? 1 : 0),
    });
    expect(p).toEqual({ box: rightTab, tucked: true, band: false });
  });

  test("REQ-781 both edges hold a control: the whole pill where no control is under it (text only)", () => {
    const centre = pillSpots({ home: h.box, view })[2];
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: () => 2,
      controls: (r) => (same(r, centre) ? 0 : 1),
    });
    expect(p).toEqual({ box: centre, tucked: false, band: false });
  });

  test("REQ-781 a public /q page (minimal) keeps the whole pill: clear spot, else no control under it, else the mini-pill", () => {
    const right = pillSpots({ home: h.box, view })[1];
    expect(
      placePill({
        home: h.box,
        view,
        dialog: false,
        minimal: true,
        blocked: () => 3,
        controls: (r) => (same(r, right) ? 0 : 1),
      }),
    ).toEqual({ box: right, tucked: false, band: false });
    const tab = placePill({
      home: h.box,
      view,
      dialog: false,
      minimal: true,
      blocked: () => 3,
      controls: (r) => (r.width === PILL_TAB.w ? 0 : 1),
    });
    expect(tab.tucked).toBe(true);
    expect(tab.band).toBe(false);
  });

  test("REQ-781 a dialog docks it as before, but never on a band", () => {
    expect(placePill({ home: h.box, view, dialog: true, blocked: () => 0 }))
      .toEqual({ box: h.box, tucked: false, band: false });
  });

  test("REQ-781 the ended notice (floats) never folds and never takes a band", () => {
    const right = pillSpots({ home: h.box, view })[1];
    expect(
      placePill({
        home: h.box,
        view,
        dialog: false,
        floats: true,
        blocked: (r) => (same(r, right) ? 0 : 1),
      }),
    ).toEqual({ box: right, tucked: false, band: false });
  });
});

describe("REQ-781 — the overlay keeps no strip for the pill", () => {
  const o = () => read("front-end/islands/DemoModeOverlay.tsx");

  test("REQ-781 place() reserves no room and paints no band", () => {
    const src = o();
    expect(src).not.toMatch(/setPillRoom\(/);
    expect(src).not.toMatch(/\broom\(/);
    expect(src).not.toMatch(/data-cy="demo-band"/);
    expect(src).not.toMatch(/bandRoom/);
  });

  test("REQ-781 placePill is told which spots hold a control (countControls), and the mini-pill can sit on either edge", () => {
    const src = o();
    expect(src).toMatch(/controls:\s*can \? countControls/);
    expect(src).toMatch(/function countControls\(/);
    expect(src).toMatch(/tabAt/);
  });
});
