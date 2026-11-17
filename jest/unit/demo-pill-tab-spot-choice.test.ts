/**
 * REQ-897 — demo-loop run 6 (dm6), issues p4 + p5 (amends REQ-853 / REQ-781).
 *
 * p4: at 390×844 the folded "Demo ×" chip sat at (0,644) over the start of the dashboard's
 *     "Termina la configuración — faltan 5 cosas" heading ("Term" hidden). placePill's tab() took
 *     the FIRST tab spot with no control under it when none was clear of the page — never the one
 *     with the least of the page under it, and a heading weighed no more than a line of text.
 * p5: scrolling /settings at 390 px in 400 px steps the chip hopped (0,324) → (294,604) → (294,444)
 *     → (0,764) → … as text came and went under it: a spot was kept only while NOTHING was under it.
 *
 * Now: (1) the last resort picks, among the control-free tab spots, the one with the least of the
 * page under it (tie: spot order); the overlay's counter weighs a heading (h1–h3, role=heading)
 * HEADING_WEIGHT, so a title is never the first thing covered. (2) While the page scrolls
 * (`scrolling`) the kept spot HOLDS — on /settings a field sits in every row, so "move when a
 * control comes under it" hopped on every 40 px step (the first cut of this fix, seen in the e2e);
 * a finger on the page is scrolling, not tapping. What is under it is judged once the scroll has
 * settled (PILL_SCROLL_SETTLE_MS), when the overlay places the pill once more.
 */
import * as fs from "fs";
import * as path from "path";
import {
  HEADING_SELECTOR,
  HEADING_WEIGHT,
  PILL_SCROLL_SETTLE_MS,
  pillHome,
  placePill,
  tabSpots,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

// a 390×844 phone: the compact pill 236×43 at home; the tab spots up the left and right edges
const view = { w: 390, h: 844 };
const h = pillHome({ view, size: { w: 236, h: 43 } });
const tabs = tabSpots(h.box, view);
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;
/** a counter by spot: `weights[i]` under tabs[i]; every whole-pill box blocked (the page is full) */
const by = (weights: Record<number, number>, whole = 9) => (r: Rect) => {
  const i = tabs.findIndex((t) => same(t, r));
  return i < 0 ? whole : weights[i] ?? 0;
};

describe("REQ-897 (dm6, p4) — the folded chip's last resort: the control-free spot with the least of the page under it", () => {
  test("REQ-897 the fixture: the first spots at 390×844 are (0,…) and (294,…) up the edges", () => {
    expect(tabs[0].left).toBe(0);
    expect(tabs[1].left).toBe(294);
    expect(tabs.length).toBeGreaterThan(6);
  });

  test("REQ-897 p4: text under every spot, a heading under the first — the chip takes the least-covered control-free spot, not the heading's", () => {
    // spot 0 holds the heading (weighed HEADING_WEIGHT), spot 1 a card and a line, spot 2 a line,
    // spot 3 a control (excluded), the rest two pieces each
    const weights: Record<number, number> = {
      0: HEADING_WEIGHT,
      1: 2,
      2: 1,
      3: 1,
    };
    for (let i = 4; i < tabs.length; i++) weights[i] = 2;
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: by(weights),
      controls: by({ 3: 1 }),
    });
    expect(p.tucked).toBe(true);
    expect(same(p.box, tabs[2])).toBe(true);
  });

  test("REQ-897 p4: a tie on what is under them keeps the spots' order (REQ-853's first-with-no-control, unchanged)", () => {
    const weights: Record<number, number> = {};
    for (let i = 0; i < tabs.length; i++) weights[i] = 1;
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: by(weights),
      controls: by({ 0: 1 }),
    });
    expect(same(p.box, tabs[1])).toBe(true);
  });

  test("REQ-897 p4: a spot with nothing under it still wins outright (REQ-853 unchanged)", () => {
    const weights: Record<number, number> = {};
    for (let i = 0; i < tabs.length; i++) weights[i] = i === 5 ? 0 : 1;
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      blocked: by(weights),
      controls: () => 0,
    });
    expect(same(p.box, tabs[5])).toBe(true);
  });

  test("REQ-897 p4: the heading weight and selector the overlay counts with", () => {
    expect(HEADING_WEIGHT).toBeGreaterThanOrEqual(3);
    expect(HEADING_SELECTOR).toBe("h1,h2,h3,[role='heading']");
  });
});

describe("REQ-897 (dm6, p5) — scrolling: the kept chip holds its spot until the scroll has settled", () => {
  const weights: Record<number, number> = {};
  for (let i = 0; i < tabs.length; i++) weights[i] = i === 4 ? 0 : 1;
  const kept = tabs[0];

  test("REQ-897 p5: settled — text under the kept spot and another spot clear: it moves there (REQ-853)", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      keep: kept,
      blocked: by(weights),
      controls: () => 0,
    });
    expect(same(p.box, tabs[4])).toBe(true);
  });

  test("REQ-897 p5: scrolling — the same page: the kept spot stays (text may pass under it)", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      keep: kept,
      scrolling: true,
      blocked: by(weights),
      controls: () => 0,
    });
    expect(p.tucked).toBe(true);
    expect(same(p.box, kept)).toBe(true);
  });

  test("REQ-897 p5: scrolling — even a control under the kept spot: it holds (judged once settled)", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      keep: kept,
      scrolling: true,
      blocked: by(weights),
      controls: by({ 0: 1 }),
    });
    expect(same(p.box, kept)).toBe(true);
    // settled: off the control at once
    const q = placePill({
      home: h.box,
      view,
      dialog: false,
      keep: kept,
      blocked: by(weights),
      controls: by({ 0: 1 }),
    });
    expect(same(q.box, tabs[4])).toBe(true);
  });

  test("REQ-897 p5: scrolling with no kept spot: placed as when settled", () => {
    const p = placePill({
      home: h.box,
      view,
      dialog: false,
      scrolling: true,
      blocked: by(weights),
      controls: () => 0,
    });
    expect(same(p.box, tabs[4])).toBe(true);
  });

  test("REQ-897 wiring: the overlay weighs headings, flags the scroll and places once more when it settles", () => {
    expect(PILL_SCROLL_SETTLE_MS).toBeGreaterThanOrEqual(300);
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    // pageUnder sums weights: a heading piece counts HEADING_WEIGHT
    const under = overlay.slice(
      overlay.indexOf("function pageUnder("),
      overlay.indexOf("function countControls("),
    );
    expect(under).toMatch(
      /closest\(HEADING_SELECTOR\)\s*\?\s*HEADING_WEIGHT\s*:\s*1/,
    );
    // the scroll handler: scrolling while events come, a final place() once settled
    expect(overlay).toMatch(/scrollingRef\.current = true;/);
    expect(overlay).toMatch(
      /setTimeout\(\(\) => \{\s*scrollingRef\.current = false;\s*place\(\);\s*\}, PILL_SCROLL_SETTLE_MS\)/,
    );
    expect(overlay).toMatch(
      /addEventListener\("scroll", onScroll, \{ capture: true, passive: true \}\)/,
    );
    // REQ-897 AMENDMENT (dm7, m3) — the hold is only for a spot placed on THIS page
    expect(overlay).toMatch(
      /scrolling: scrollingRef\.current && placedHereRef\.current,/,
    );
    expect(overlay).toMatch(/const placedHereRef = useRef\(false\);/);
    expect(overlay).toMatch(
      /lastPlaceRef\.current = next;\s*placedHereRef\.current = true;/,
    );
  });

  test("REQ-897 AMENDMENT (dm7, m3) wiring: a new page starts with no spot placed here — the kept spot is judged on arrival", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    // reset wherever the page's own kept-spot bookkeeping resets (the path change)
    expect(overlay).toMatch(/placedHereRef\.current = false;/);
  });
});
