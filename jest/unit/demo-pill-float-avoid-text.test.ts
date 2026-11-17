/**
 * REQ-874 — demo-loop cycle dm5, issue p9 (amends REQ-781 / REQ-866).
 *
 * On /admin at 1280×800 the customer-ended notice ("Demo mode · Maria Lopez ended the demo ×",
 * the floating pill: `floats`) sat bottom-right over the footer's address line ("45…" cut off).
 * `placePill`'s rule 3 took the first `pillSpots` box with no CONTROL under it (text allowed)
 * before REQ-866's `standing()` ever looked through the rows between for a box with nothing of
 * the page under it. A pill that does not fold now tries, in order: a clear spot, a clear row,
 * a spot with only text (REQ-781), then REQ-866's fewest-controls fallback.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillRows,
  pillSpots,
  placePill,
  pillBands,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };

const view = { w: 1280, h: 800 };
const h = 43;
const home: Rect = {
  left: PILL_MARGIN,
  top: view.h - PILL_BAND_GAP - h,
  width: 444,
  height: h,
};
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;
const spots = pillSpots({ home, view });
const rows = pillRows({ home, view });
const bottomRight = spots[1];
/** the first row (nearest home) at the right edge: nothing of the page under it */
const clearRow = rows.find((r) => r.left === bottomRight.left)!;

/** /admin at 1280×800: home over the footer's links; bottom-right over the address text only;
 *  every other spot over a control; the right-edge row above the footer clear */
const blocked = (r: Rect) => (same(r, clearRow) ? 0 : 2);
const controls = (r: Rect) =>
  same(r, bottomRight) || rows.some((x) => same(x, r)) ? 0 : 2;

describe("REQ-874 (demo-loop cycle dm5, p9) — a pill that does not fold takes a clear row before a spot over text", () => {
  test("REQ-874 p9: the fixture — the row is clear, bottom-right holds text but no control", () => {
    expect(clearRow).toBeDefined();
    expect(blocked(bottomRight)).toBeGreaterThan(0);
    expect(controls(bottomRight)).toBe(0);
  });

  test("REQ-874 p9: the ended notice (floats) on /admin — home blocked, bottom-right only text, a row clear: the row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked,
      controls,
    });
    expect(p.tucked).toBe(false);
    expect(p.box).toEqual(clearRow);
  });

  test("REQ-874 p9: a pill that does not yield (the join grace) — the same: the clear row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      yields: false,
      blocked,
      controls,
    });
    expect(p.tucked).toBe(false);
    expect(p.box).toEqual(clearRow);
  });

  test("REQ-874 p9: no row clear — REQ-781's text-only spot still wins over REQ-866's fewest", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked: () => 2,
      controls,
    });
    expect(same(p.box, bottomRight)).toBe(true);
  });

  test("REQ-874 p9: a clear spot still comes before any row", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      floats: true,
      blocked: (r) => (same(r, spots[2]) || same(r, clearRow) ? 0 : 2),
      controls,
    });
    expect(same(p.box, spots[2])).toBe(true);
  });

  test("REQ-874 p9: a pill that yields still folds to a clear tab before a text spot (REQ-853 unchanged)", () => {
    const p = placePill({
      home,
      view,
      dialog: false,
      blocked: (r) => (r.width < home.width ? 0 : 2),
      controls,
    });
    expect(p.tucked).toBe(true);
  });
});

describe("REQ-866 AMENDMENT (demo-loop run 11, m2) — a pill that may not fold takes a clear band the page's blocks leave, not only a row a whole pill-height apart from home: /welcome step 2 at 390×844 during the join grace", () => {
  // the page as the probe mapped it (x,y,w,h; * = a control)
  const pieces: { r: Rect; control: boolean }[] = [
    { r: { left: 117, top: 28, width: 156, height: 34 }, control: true }, // logo link
    { r: { left: 293, top: 86, width: 73, height: 25 }, control: true }, // EN | ES
    { r: { left: 20, top: 143, width: 350, height: 20 }, control: false }, // Paso 2 de 10
    { r: { left: 45, top: 212, width: 300, height: 28 }, control: false }, // h1
    { r: { left: 45, top: 246, width: 300, height: 43 }, control: false }, // hint
    { r: { left: 45, top: 306, width: 300, height: 56 }, control: true }, // input
    { r: { left: 45, top: 392, width: 125, height: 20 }, control: false }, // legend
    { r: { left: 45, top: 420, width: 197, height: 39 }, control: true }, // labels
    { r: { left: 45, top: 479, width: 309, height: 49 }, control: true }, // Atrás Omitir Continuar
    { r: { left: 91, top: 581, width: 209, height: 36 }, control: true }, // Omitir configuración
    { r: { left: 16, top: 690, width: 358, height: 48 }, control: true }, // footer links
    { r: { left: 16, top: 746, width: 358, height: 24 }, control: true }, // more links
    { r: { left: 148, top: 778, width: 94, height: 24 }, control: true }, // phone link
    { r: { left: 62, top: 802, width: 265, height: 24 }, control: false }, // address
  ];
  const hits = (a: Rect, b: Rect) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;
  const blocked390 = (r: Rect) => pieces.filter((p) => hits(r, p.r)).length;
  const controls390 = (r: Rect) =>
    pieces.filter((p) => p.control && hits(r, p.r)).length;
  const view390 = { w: 390, h: 844 };
  const home390: Rect = {
    left: PILL_MARGIN,
    top: view390.h - PILL_MARGIN - 54,
    width: 366,
    height: 54,
  };

  test("the fixture: no pillSpot and no whole-step row is clear; the band between 'Omitir configuración' (617) and the footer links (690) is 73 px tall", () => {
    expect(
      pillSpots({ home: home390, view: view390 }).every((r) =>
        blocked390(r) > 0
      ),
    ).toBe(true);
    const step = 54 + PILL_BAND_GAP;
    for (let t = home390.top - step; t > PILL_MARGIN; t -= step) {
      expect([t, blocked390({ ...home390, top: t })]).not.toEqual([t, 0]);
    }
    expect(blocked390({ ...home390, top: 623 })).toBe(0);
  });

  test("REQ-866 AMENDMENT: pillRows comes every half step (a pill height + gap over two), nearest home first, so the band shows up", () => {
    const rows = pillRows({ home: home390, view: view390 });
    const tops = [...new Set(rows.map((r) => r.top))];
    const half = (54 + PILL_BAND_GAP) / 2;
    expect(tops[0]).toBe(home390.top - half);
    expect(tops[1]).toBe(home390.top - 2 * half);
    expect(tops).toContain(623);
    // descending from home, all above the top margin
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]).toBeLessThan(tops[i - 1]);
    }
    expect(tops[tops.length - 1]).toBeGreaterThan(PILL_MARGIN);
  });

  test("the join grace's whole pill on /welcome at 390: in the clear band, never over the question and its hint", () => {
    const p = placePill({
      home: home390,
      view: view390,
      dialog: false,
      yields: false,
      blocked: blocked390,
      controls: controls390,
    });
    expect(p.tucked).toBe(false);
    expect(blocked390(p.box)).toBe(0);
    expect(p.box.top).toBeGreaterThanOrEqual(617);
    expect(p.box.top + p.box.height).toBeLessThanOrEqual(690);
  });

  test("the ended notice (floats) on the same page: the same band", () => {
    const p = placePill({
      home: home390,
      view: view390,
      dialog: false,
      floats: true,
      blocked: blocked390,
      controls: controls390,
    });
    expect(blocked390(p.box)).toBe(0);
  });
});

describe("REQ-866 AMENDMENT 2 (demo-loop run 12, m1) — the clear bands the page's blocks leave, off the rows' grid: the ENGLISH /welcome step 2 at 390×844 during the join grace", () => {
  // the page as the probe mapped it (x,y,w,h; * = a control) — the English layout has a
  // language-hint row the Spanish one does not, and a 43 px compact pill
  const pieces: { r: Rect; control: boolean; card?: true }[] = [
    // the card: painted (a background, a shadow), counted by `blocked`, not by `hit` — its
    // padding under Continue (600–628) is part of the band
    { r: { left: 20, top: 182, width: 350, height: 446 }, control: false, card: true },
    { r: { left: 117, top: 28, width: 156, height: 34 }, control: true }, // brand link
    { r: { left: 331, top: 86, width: 35, height: 25 }, control: true }, // ES
    { r: { left: 20, top: 143, width: 350, height: 20 }, control: false }, // Step 2 of 10
    { r: { left: 45, top: 212, width: 300, height: 56 }, control: false }, // h1
    { r: { left: 45, top: 274, width: 300, height: 43 }, control: false }, // why
    { r: { left: 45, top: 334, width: 300, height: 56 }, control: true }, // input
    { r: { left: 45, top: 420, width: 146, height: 20 }, control: false }, // legend
    { r: { left: 79, top: 457, width: 48, height: 21 }, control: false }, // English
    { r: { left: 184, top: 457, width: 53, height: 21 }, control: false }, // Spanish
    { r: { left: 45, top: 487, width: 300, height: 43 }, control: false }, // the hint
    { r: { left: 45, top: 550, width: 300, height: 50 }, control: true }, // Back Skip Continue
    { r: { left: 128, top: 653, width: 133, height: 36 }, control: true }, // Skip setup for now
    { r: { left: 50, top: 715, width: 290, height: 24 }, control: true }, // links
    { r: { left: 50, top: 747, width: 290, height: 24 }, control: true }, // links
    { r: { left: 148, top: 779, width: 94, height: 24 }, control: true }, // phone
    { r: { left: 62, top: 803, width: 265, height: 24 }, control: false }, // address
  ];
  const hits = (a: Rect, b: Rect) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;
  const at = (x: number, y: number) =>
    pieces.some((p) =>
      !p.card &&
      x >= p.r.left && x < p.r.left + p.r.width && y >= p.r.top &&
      y < p.r.top + p.r.height
    );
  const hint = pieces.find((p) => p.r.top === 487)!.r;
  const blockedEn = (r: Rect) => pieces.filter((p) => hits(r, p.r)).length;
  const controlsEn = (r: Rect) =>
    pieces.filter((p) => p.control && hits(r, p.r)).length;
  const view390 = { w: 390, h: 844 };
  const homeEn: Rect = {
    left: PILL_MARGIN,
    top: view390.h - PILL_MARGIN - 43,
    width: 335,
    height: 43,
  };
  const bands = () => pillBands({ home: homeEn, view: view390, hit: at });

  test("the fixture: no pillSpot and no half-step row is clear, while the 53 px band between Continue (600) and 'Skip setup for now' (653) holds the pill over the card's padding alone", () => {
    expect(
      pillSpots({ home: homeEn, view: view390 }).every((r) => blockedEn(r) > 0),
    ).toBe(true);
    expect(
      pillRows({ home: homeEn, view: view390 }).every((r) => blockedEn(r) > 0),
    ).toBe(true);
    expect(blockedEn({ ...homeEn, top: 605 })).toBe(1);
    expect(controlsEn({ ...homeEn, top: 605 })).toBe(0);
  });

  test("pillBands reads the page: a box centred in the Continue/Skip band (605) comes first, the one under the step count (~165) after; each inside its band, nearest home first", () => {
    const b = bands();
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b[0].top).toBeCloseTo(605, 0);
    expect(b[0].left).toBe(homeEn.left);
    expect(b.some((r) => Math.abs(r.top - 167.5) <= 4)).toBe(true);
    // the scan's columns can step over a small control (the 35 px ES button between the brand
    // and the step count, for the right-hand placement): the caller judges each box with
    // `blocked` — the first band has only the card under it
    expect(blockedEn(b[0])).toBe(1);
    expect(controlsEn(b[0])).toBe(0);
    for (let i = 1; i < b.length; i++) {
      expect(Math.abs(homeEn.top - b[i].top)).toBeGreaterThanOrEqual(
        Math.abs(homeEn.top - b[i - 1].top),
      );
    }
  });

  test("the join grace's whole pill on the English step 2: in the Continue/Skip band (the card's padding, the least of the page), never on the hint", () => {
    const p = placePill({
      home: homeEn,
      view: view390,
      dialog: false,
      yields: false,
      blocked: blockedEn,
      controls: controlsEn,
      bands,
    });
    expect(p.tucked).toBe(false);
    expect(hits(p.box, hint)).toBe(false);
    expect(controlsEn(p.box)).toBe(0);
    expect(p.box.top).toBeGreaterThanOrEqual(600);
    expect(p.box.top + p.box.height).toBeLessThanOrEqual(653);
  });

  test("without the bands (the page unread) the Continue/Skip band is never found — the rows' grid misses it; the pill rests on some text instead", () => {
    const p = placePill({
      home: homeEn,
      view: view390,
      dialog: false,
      yields: false,
      blocked: blockedEn,
      controls: controlsEn,
    });
    expect(p.tucked).toBe(false);
    expect(p.box.top >= 600 && p.box.top + p.box.height <= 653).toBe(false);
    expect(blockedEn(p.box)).toBeGreaterThan(0);
  });

  test("the ended notice (floats) takes the band too; a pill that may fold never reads the bands", () => {
    const f = placePill({
      home: homeEn,
      view: view390,
      dialog: false,
      floats: true,
      blocked: blockedEn,
      controls: controlsEn,
      bands,
    });
    expect(f.tucked).toBe(false);
    expect(hits(f.box, hint)).toBe(false);
    expect(f.box.top).toBeGreaterThanOrEqual(600);
    expect(f.box.top + f.box.height).toBeLessThanOrEqual(653);
    let read = 0;
    const y = placePill({
      home: homeEn,
      view: view390,
      dialog: false,
      blocked: blockedEn,
      controls: controlsEn,
      bands: () => {
        read++;
        return bands();
      },
    });
    expect(y.tucked).toBe(true);
    expect(read).toBe(0);
  });

  test("wiring: the overlay hands placePill the page's bands (text, a control or media as the hit — a painted card alone is not)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../front-end/islands/DemoModeOverlay.tsx"),
      "utf8",
    );
    expect(src).toMatch(/pillBands\(\{\s*home: home\.box,\s*view,\s*top: bannerH\(\),\s*hit: \(x, y\) => textOrControlAt\(x, y, backdrop\),/);
    expect(src).toMatch(/function textOrControlAt\([\s\S]*?return !!el\.closest\(CONTROL_SELECTOR\) \|\| !!el\.closest\(PAGE_MEDIA_SELECTOR\) \|\|\s*ownText\(el\);/);
  });
});
