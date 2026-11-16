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
        /useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[asking\]\);/,
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
      const branch = o.slice(i, o.indexOf("setCompact(narrow());", i));
      expect(branch).not.toMatch(/placeAsk\(/);
      expect(branch).toMatch(/clampAsk\(\);\s*sendPill\(\);\s*return;/);
    });
  });
});
