/**
 * REQ-853 — demo-loop cycle dm3, issues p1 + p8. Raphael: "fix every issue the demo found, loop
 * until there are none".
 *
 * p1: the folded "Demo ×" chip sat over the compact footer's address line on /clients at 1280×800
 *     (ES: "…, SC 29588" reaches x 1251): placePill's step 2 folded at the first tab spot with no
 *     CONTROL under it (1184,760) and never asked whether anything of the page (text) was there.
 *     It now prefers a tab spot with NOTHING under it (`blocked`), then one with no control.
 * p8: the chip jumped 1184,760 → 1184,680 ~0.7 s after /dashboard loaded: the first place() saw the
 *     loading skeleton, and placePill always scanned from tabs[0]. It now keeps the current (or
 *     carried) spot (`keep`) while it is still clear, and the overlay places it again on the page's
 *     own layout changes (a body ResizeObserver + a frame-debounced MutationObserver), not only on
 *     the 700 ms poll.
 */
import * as fs from "fs";
import * as path from "path";
import { pillHome, placePill, tabSpots } from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 800 };
const h = pillHome({ view, size: { w: 520, h: 43 } });
const overlap = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const under = (things: Rect[]) => (r: Rect) =>
  things.filter((c) => overlap(r, c)).length;
const at = (left: number, top: number): Rect => ({
  left,
  top,
  width: 96,
  height: 32,
});

// the /clients page at 1280×800: the sidebar's Log out (a control) at the bottom-left, the
// centred compact footer's ES line with the address span (text, not a control) ending at x 1251,
// and the page's cards filling the content area, so no whole-pill spot is clear
const logout = { left: 16, top: 742, width: 196, height: 42 };
const footerLinks = { left: 300, top: 772, width: 690, height: 24 };
const address = { left: 1007, top: 772, width: 244, height: 24 };
const cards = { left: 240, top: 60, width: 1000, height: 600 };
// the page's top bar (its title text) across the window: no whole-pill spot along the top is clear
const header = { left: 0, top: 0, width: 1280, height: 56 };

describe("REQ-853 (demo-loop cycle dm3, p1) — the mini-pill avoids text: a tab spot with nothing under it first", () => {
  test("REQ-853 the tab spots at 1280×800 start (0,760), (1184,760), (0,720), (1184,720)", () => {
    const t = tabSpots(h.box, view);
    expect(t.slice(0, 4)).toEqual([
      at(0, 760),
      at(1184, 760),
      at(0, 720),
      at(1184, 720),
    ]);
  });

  test("REQ-853 an ES-width footer address under (1184,760): the chip folds at (1184,720), off the text", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, footerLinks, address, cards]),
      controls: under([logout, footerLinks]),
    });
    expect(p).toEqual({ box: at(1184, 720), tucked: true, band: false });
    expect(overlap(p.box, address)).toBe(false);
  });

  test("REQ-853 text under every tab spot: still the first spot with no control (REQ-781/818 unchanged)", () => {
    const everywhere = { left: 0, top: 0, width: 1280, height: 800 };
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([logout, everywhere]),
      controls: under([logout]),
    });
    expect(p).toEqual({ box: at(1184, 760), tucked: true, band: false });
  });

  test("REQ-853 a dialog with nowhere to dock: the chip also prefers a tab spot with nothing under it", () => {
    const dialogBox = { left: 0, top: 0, width: 1280, height: 800 };
    const p = placePill({
      home: h.box,
      view,
      dialog: true,
      dialogBox,
      blocked: (r) =>
        // the panel covers the window but the foot's right corner holds the address only
        overlap(r, address) ? 1 : r.top >= 700 && r.left >= 1184 ? 0 : 2,
      controls: (r) => (overlap(r, logout) ? 1 : 0),
    });
    expect(p.tucked).toBe(true);
    expect(p.box).toEqual(at(1184, 720));
  });
});

describe("REQ-853 (demo-loop cycle dm3, p8) — the chip keeps its current/carried spot while it is still clear", () => {
  // the dashboard's loading skeleton: the content area's cards, nothing at the window's foot on the
  // right edge; Log out at the bottom-left
  const skeleton = { left: 240, top: 60, width: 900, height: 700 };

  test("REQ-853 a carried tab at (1184,680) over a skeleton with nothing at (1184,760) stays at 680", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, skeleton]),
      controls: under([logout]),
      keep: at(1184, 680),
    });
    expect(p).toEqual({ box: at(1184, 680), tucked: true, band: false });
  });

  test("REQ-853 with no carried spot the same skeleton folds at the first clear spot (1184,760)", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, skeleton]),
      controls: under([logout]),
    });
    expect(p.box).toEqual(at(1184, 760));
  });

  test("REQ-853 a kept spot that now has a control under it is left", () => {
    const button = { left: 1150, top: 670, width: 120, height: 40 };
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, skeleton, button]),
      controls: under([logout, button]),
      keep: at(1184, 680),
    });
    expect(p.box).toEqual(at(1184, 760));
  });

  test("REQ-853 a kept spot over text is left for a spot with nothing under it (p1 wins over staying)", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, footerLinks, address, cards]),
      controls: under([logout, footerLinks]),
      keep: at(1184, 760),
    });
    expect(p.box).toEqual(at(1184, 720));
  });

  test("REQ-853 text under every tab spot: a kept spot with no control stays (no hop between equal spots)", () => {
    const everywhere = { left: 0, top: 0, width: 1280, height: 800 };
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([logout, everywhere]),
      controls: under([logout]),
      keep: at(1184, 680),
    });
    expect(p.box).toEqual(at(1184, 680));
  });

  test("REQ-853 a kept box that is not one of the tab spots (a stale size) is ignored", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: under([header, logout, skeleton]),
      controls: under([logout]),
      keep: at(1100, 333),
    });
    expect(p.box).toEqual(at(1184, 760));
  });
});

describe("REQ-853 (cycle dm3, p8) — the overlay hands placePill its spot and places again on the page's layout changes", () => {
  const src = read("front-end/islands/DemoModeOverlay.tsx");

  test("REQ-853 place() passes the folded spot it has (lastPlaceRef, seeded by the carry) as `keep`", () => {
    expect(src).toMatch(/keep:\s*kept/);
    expect(src).toMatch(/lastPlaceRef\.current\?\.tucked/);
  });

  test("REQ-853 a ResizeObserver watches document.body and a MutationObserver the page, both frame-debounced", () => {
    expect(src).toMatch(/ro\?\.observe\(document\.body\)/);
    expect(src).toMatch(/new MutationObserver\(/);
    expect(src).toMatch(
      /observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true/,
    );
    // the overlay's own changes do not re-place it (no loop)
    expect(src).toMatch(/closest\?\.\(\s*"\[data-demo-overlay\]"\s*\)/);
    expect(src).toMatch(
      /requestAnimationFrame\(\s*\(\)\s*=>\s*\{\s*frame = 0;/,
    );
  });
});
