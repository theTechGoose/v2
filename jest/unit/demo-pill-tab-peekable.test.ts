/**
 * REQ-890 AMENDMENT 2 + REQ-379 AMENDMENT 2 — demo-loop run 9/10 lane, the REQ-890 story red at
 * HEAD (not a regression: red at 588005ea too), fixed by hand.
 *
 * Surveyed at 700×800 on /customers (EN; whole pill 501×43, compact 282×43), every tab spot:
 *   - the folded chip sat at (0,560) — clear (nothing of the page under it), the FIRST clear spot
 *     in `tabSpots`' order — but its row holds the filter chips ("All 0", "Owe you 0") under the
 *     compact pill's flush box, and a control under the whole's flush box at EVERY spot;
 *   - (604,80) is clear too, and the compact pill flush with it covers no control.
 *   So the hover opened the compact pill flush at (12,549) for a frame, then `peekBox` moved it
 *   to (252,702) — three rows down, 240 px right — the REQ-890 complaint again, from the chip's
 *   choice of spot rather than from the peek's search.
 *
 * Now: (1) `placePill` takes `peek` — the sizes the peek could show (the whole, and the compact
 * once known): among equally clear tab spots it prefers one whose flush peek box (`peekFlushBox`)
 * holds no control for some size, so the hover opens flush with the chip; a kept spot (REQ-853)
 * stays while it is peekable or no clear spot is; the last resort (REQ-897) prefers a peekable
 * control-free spot too. (2) `pillCompactForm` — the pill is compact when the window is narrow
 * (REQ-379's 640 px) OR the whole pill is wider than PILL_WHOLE_MAX_SHARE of the window (501 px in
 * 700: 72 %): then its size is the compact's from the first placement, and the chip's spot is
 * chosen for the form the peek will show.
 */
import * as fs from "fs";
import * as path from "path";
import {
  peekBox,
  peekFlushBox,
  PILL_COMPACT_MAX_W,
  PILL_MARGIN,
  PILL_WHOLE_MAX_SHARE,
  pillCompactForm,
  pillHome,
  placePill,
  tabSpots,
} from "../../shared/demo-mode/pill.ts";

type Rect = { left: number; top: number; width: number; height: number };
type Size = { w: number; h: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 700, h: 800 };
const compact: Size = { w: 282, h: 43 };
const home = pillHome({ view, size: compact });
const tabs = tabSpots(home.box, view);
const same = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.width === b.width &&
  a.height === b.height;
const at = (left: number, top: number) => {
  const t = tabs.find((r) => r.left === left && r.top === top);
  if (!t) throw new Error(`no tab spot at ${left},${top}`);
  return t;
};
const key = (r: Rect) => `${r.left},${r.top}`;

/** the page as surveyed: `under[spot]` pieces under a tab spot (default 1), and the flush
 *  compact box control-free only at `peekable` spots; every whole-pill box blocked */
function counters(o: {
  under: Record<string, number>;
  peekable: string[];
  controlsAt?: string[];
}) {
  const flushes = new Map<string, string>();
  for (const t of tabs) {
    flushes.set(key(peekFlushBox(t, view, compact)), key(t));
  }
  const blocked = (r: Rect) => {
    const i = tabs.findIndex((t) => same(t, r));
    if (i >= 0) return o.under[key(r)] ?? 1;
    return 9;
  };
  const controls = (r: Rect) => {
    const i = tabs.findIndex((t) => same(t, r));
    if (i >= 0) return o.controlsAt?.includes(key(r)) ? 1 : 0;
    const spot = flushes.get(key(r));
    if (spot !== undefined && r.width === compact.w) {
      return o.peekable.includes(spot) ? 0 : 2;
    }
    return 3;
  };
  return { blocked, controls };
}

describe("REQ-890 AMENDMENT 2 — peekFlushBox: the peek's box flush with a tab spot", () => {
  test("REQ-890 AMENDMENT 2 a left-edge spot: at the left margin, its foot on the tab's foot", () => {
    const t = at(0, 560);
    const b = peekFlushBox(t, view, compact);
    expect(b).toEqual({
      left: PILL_MARGIN,
      top: 560 + 32 - 43,
      width: 282,
      height: 43,
    });
  });

  test("REQ-890 AMENDMENT 2 a right-edge spot: at the right margin", () => {
    const t = at(604, 80);
    const b = peekFlushBox(t, view, compact);
    expect(b.left).toBe(700 - PILL_MARGIN - 282);
    expect(b.top).toBe(80 + 32 - 43);
  });

  test("REQ-890 AMENDMENT 2 peekBox opens the whole pill exactly there when that box is clear", () => {
    const t = at(604, 80);
    const b = peekBox({ home: home.box, view, tab: t, controls: () => 0 });
    expect({ left: b.left, top: b.top }).toEqual({
      left: peekFlushBox(t, view, compact).left,
      top: peekFlushBox(t, view, compact).top,
    });
  });
});

describe("REQ-890 AMENDMENT 2 — the folded chip's spot is one its peek can open flush from", () => {
  test("REQ-890 AMENDMENT 2 the fixture: (0,560) comes before (604,80) in the spots' order, both clear", () => {
    expect(tabs.findIndex((t) => key(t) === "0,560")).toBeGreaterThanOrEqual(0);
    expect(tabs.findIndex((t) => key(t) === "0,560")).toBeLessThan(
      tabs.findIndex((t) => key(t) === "604,80"),
    );
  });

  const survey = counters({
    under: { "0,560": 0, "604,80": 0, "604,280": 0 },
    peekable: ["604,80", "604,760", "604,720", "604,480"],
  });

  test("REQ-890 AMENDMENT 2 without `peek` the first clear spot wins, as before (REQ-853)", () => {
    const p = placePill({ home: home.box, view, dialog: false, ...survey });
    expect(p.tucked).toBe(true);
    expect(key(p.box)).toBe("0,560");
  });

  test("REQ-890 AMENDMENT 2 with `peek` the clear spot whose compact peek covers no control wins: (604,80), not (0,560) over the filter chips", () => {
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [compact],
      ...survey,
    });
    expect(p.tucked).toBe(true);
    expect(key(p.box)).toBe("604,80");
  });

  test("REQ-890 AMENDMENT 2 a kept spot (REQ-853) that is clear but not peekable gives way to a clear peekable one", () => {
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [compact],
      keep: at(0, 560),
      ...survey,
    });
    expect(key(p.box)).toBe("604,80");
  });

  test("REQ-890 AMENDMENT 2 a kept spot that is clear and peekable stays (no hop between equals)", () => {
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [compact],
      keep: at(604, 80),
      ...counters({
        under: { "0,560": 0, "604,80": 0, "604,760": 0 },
        peekable: ["604,80", "604,760"],
      }),
    });
    expect(key(p.box)).toBe("604,80");
  });

  test("REQ-890 AMENDMENT 2 no clear spot is peekable: the first clear one, as before", () => {
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [compact],
      ...counters({ under: { "0,560": 0, "604,80": 0 }, peekable: [] }),
    });
    expect(key(p.box)).toBe("0,560");
  });

  test("REQ-890 AMENDMENT 2 any of the sizes may fit: a whole-pill flush box with no control makes the spot peekable", () => {
    const whole: Size = { w: 501, h: 43 };
    const c = counters({ under: { "0,560": 0, "604,80": 0 }, peekable: [] });
    const wholeFlush = key(peekFlushBox(at(604, 80), view, whole));
    const controls = (r: Rect) =>
      r.width === whole.w && key(r) === wholeFlush ? 0 : c.controls(r);
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [whole, compact],
      blocked: c.blocked,
      controls,
    });
    expect(key(p.box)).toBe("604,80");
  });

  test("REQ-890 AMENDMENT 2 the last resort (REQ-897: no clear spot) prefers a peekable control-free spot with the least of the page under it", () => {
    // nothing clear; (0,560) has one piece under it and no flush peek; (604,480) two pieces and a
    // clear compact peek; (604,720) three pieces, peekable
    const p = placePill({
      home: home.box,
      view,
      dialog: false,
      peek: [compact],
      ...counters({
        under: { "0,560": 1, "604,480": 2, "604,720": 3 },
        peekable: ["604,480", "604,720"],
      }),
    });
    expect(key(p.box)).toBe("604,480");
  });
});

describe("REQ-379 AMENDMENT 2 — pillCompactForm: compact when narrow, or when the whole pill would eat the window", () => {
  test("REQ-379 AMENDMENT 2 at or under PILL_COMPACT_MAX_W: compact, whatever the whole's size", () => {
    expect(pillCompactForm(PILL_COMPACT_MAX_W, null)).toBe(true);
    expect(pillCompactForm(390, { w: 236, h: 43 })).toBe(true);
  });

  test("REQ-379 AMENDMENT 2 at 700 px a 501 px whole pill (72 %) is compact; unknown or 400 px (57 %) is not", () => {
    expect(PILL_WHOLE_MAX_SHARE).toBeCloseTo(2 / 3, 5);
    expect(pillCompactForm(700, { w: 501, h: 43 })).toBe(true);
    expect(pillCompactForm(700, null)).toBe(false);
    expect(pillCompactForm(700, { w: 400, h: 43 })).toBe(false);
  });

  test("REQ-379 AMENDMENT 2 at 1280 px the same pill is whole", () => {
    expect(pillCompactForm(1280, { w: 501, h: 43 })).toBe(false);
  });
});

describe("REQ-890 AMENDMENT 2 / REQ-379 AMENDMENT 2 — wiring in the overlay", () => {
  const src = read("front-end/islands/DemoModeOverlay.tsx");

  test("REQ-379 AMENDMENT 2 the overlay's compact switch is pillCompactForm over the WHOLE pill's measured size (never the compact's: that would oscillate)", () => {
    expect(src).toMatch(
      /pillCompactForm\(\s*globalThis\.innerWidth,\s*wholeSizeRef\.current,?\s*\)/,
    );
    expect(src).toMatch(/if \(!compactNow\) wholeSizeRef\.current = size;/);
  });

  test("REQ-379 AMENDMENT 2 a pill not yet in the window's form is not placed (nor folded) as it is: the switch renders, and that render places it — so the compact form is measured while still out", () => {
    const i = src.indexOf("const place = () => {");
    const body = src.slice(i, src.indexOf("const p = placePill({", i));
    expect(body).toMatch(
      /const n = isNarrow\(\);\s*if \(n !== compactBaseRef\.current\) \{\s*setCompact\(n\);\s*return;\s*\}/,
    );
    expect(src).toMatch(
      /const compactBaseRef = useRef\(compactBase\);\s*compactBaseRef\.current = compactBase;/,
    );
  });

  test("REQ-379 AMENDMENT 2 the whole's size is carried to the next page (REQ-830's place) and restored before paint, so a reload at 700 px starts compact", () => {
    expect(src).toMatch(/if \(at\.whole\) wholeSizeRef\.current = at\.whole;/);
    expect(src).toMatch(
      /\.\.\.\(wholeSizeRef\.current\s*\?\s*\{ whole: \{ \.\.\.wholeSizeRef\.current \} \}\s*:\s*\{\}\)/,
    );
    const carry = read("front-end/lib/demo-mode/pill-carry.ts");
    expect(carry).toMatch(/whole\?: \{ w: number; h: number \};/);
    expect(carry).toMatch(/out\.whole = \{ w: f\.w, h: f\.h \};/);
  });

  test("REQ-890 AMENDMENT 2 placePill is offered the peek's sizes while the pill is folded (not during a peek: the open pill's tab never hops)", () => {
    const i = src.indexOf("const p = placePill({");
    expect(i).toBeGreaterThan(0);
    const call = src.slice(i, src.indexOf("});", i));
    expect(call).toMatch(
      /peek:\s*peekRef\.current\s*\?\s*undefined\s*:\s*peekSizes\(\)/,
    );
    expect(src).toMatch(
      /const peekSizes = \(\)[^;]*\[fullRef\.current, compactSizeRef\.current\]/s,
    );
  });
});
