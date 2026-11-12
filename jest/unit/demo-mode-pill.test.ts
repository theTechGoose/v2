/**
 * REQ-228 — the demo pills never cover the page (demo issue pointer-and-replica-side-effects-m4).
 * The customer's pill stays one line and sits in the corner of the screen that has no control
 * under it (it moves when the page under it changes); the staff stage keeps the frame out of the
 * band its pill measures, not a guessed 76 px, and the long hint is a tooltip, not pill text.
 */
import * as fs from "fs";
import * as path from "path";
import {
  clampRect,
  CONTROL_SELECTOR,
  cornerRect,
  pickPillSlot,
  PILL_COMPACT_MAX_W,
  PILL_CORNERS,
  PILL_MARGIN,
  pillSlots,
  samplePoints,
  STAGE_PILL_BOTTOM,
  STAGE_PILL_GAP,
  stageInsetBottom,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-228 — the customer's pill picks a clear corner", () => {
  const view = { w: 1280, h: 800 };
  const pill = { w: 300, h: 34 };

  test("bottom-left first, then the other corners", () => {
    expect(PILL_CORNERS[0]).toBe("bl");
    expect(new Set(PILL_CORNERS)).toEqual(new Set(["bl", "br", "tl", "tr"]));
  });

  test("each corner's box sits a margin in from its two edges", () => {
    expect(cornerRect("bl", view, pill)).toEqual({
      left: PILL_MARGIN,
      top: 800 - PILL_MARGIN - 34,
      width: 300,
      height: 34,
    });
    expect(cornerRect("br", view, pill)).toEqual({
      left: 1280 - PILL_MARGIN - 300,
      top: 800 - PILL_MARGIN - 34,
      width: 300,
      height: 34,
    });
    expect(cornerRect("tl", view, pill)).toEqual({
      left: PILL_MARGIN,
      top: PILL_MARGIN,
      width: 300,
      height: 34,
    });
    expect(cornerRect("tr", view, pill).left).toBe(1280 - PILL_MARGIN - 300);
  });

  test("the sample points cover the box, inside it", () => {
    const r = { left: 10, top: 20, width: 100, height: 30 };
    const pts = samplePoints(r);
    expect(pts.length).toBeGreaterThanOrEqual(9);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(10);
      expect(p.x).toBeLessThan(110);
      expect(p.y).toBeGreaterThan(20);
      expect(p.y).toBeLessThan(50);
    }
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(20);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });

  test("the slots: the four corners first, then both side edges from the bottom up", () => {
    const slots = pillSlots(view, pill);
    expect(slots.slice(0, 4)).toEqual(
      PILL_CORNERS.map((c) => cornerRect(c, view, pill)),
    );
    const rest = slots.slice(4);
    expect(rest.length).toBeGreaterThan(10);
    for (const r of rest) {
      expect([PILL_MARGIN, 1280 - PILL_MARGIN - 300]).toContain(r.left);
      expect(r.top).toBeGreaterThan(PILL_MARGIN);
      expect(r.top + r.height).toBeLessThan(800 - PILL_MARGIN);
    }
    // bottom up: the first edge slot is lower than the last
    expect(rest[0].top).toBeGreaterThan(rest[rest.length - 1].top);
  });

  const slots = [
    { left: 0, top: 0, width: 10, height: 10 },
    { left: 20, top: 0, width: 10, height: 10 },
    { left: 40, top: 0, width: 10, height: 10 },
  ];

  test("a clear current box stays (no hopping)", () => {
    const cur = { left: 99, top: 99, width: 10, height: 10 };
    expect(pickPillSlot(cur, slots, () => 0)).toBe(cur);
  });

  test("a covered box moves to the first clear slot", () => {
    const cur = { left: 99, top: 99, width: 10, height: 10 };
    const n = (r: { left: number }) => (r.left === 40 ? 0 : 2);
    expect(pickPillSlot(cur, slots, n)).toBe(slots[2]);
    expect(pickPillSlot(null, slots, n)).toBe(slots[2]);
  });

  test("nowhere clear: the fewest, the current box on a tie", () => {
    const cur = { left: 99, top: 99, width: 10, height: 10 };
    const n = (r: { left: number }) =>
      r.left === 20 ? 1 : r.left === 99 ? 1 : 3;
    expect(pickPillSlot(cur, slots, n)).toBe(cur);
    const m = (r: { left: number }) => (r.left === 20 ? 1 : 3);
    expect(pickPillSlot(cur, slots, m)).toBe(slots[1]);
  });

  test("a remembered box is kept on the screen after a resize", () => {
    const r = { left: 1000, top: 700, width: 300, height: 34 };
    expect(clampRect(r, { w: 390, h: 844 })).toEqual({
      left: 390 - PILL_MARGIN - 300,
      top: 700,
      width: 300,
      height: 34,
    });
    expect(clampRect(r, { w: 1280, h: 500 }).top).toBe(500 - PILL_MARGIN - 34);
  });

  test("a phone gets the compact pill", () => {
    expect(PILL_COMPACT_MAX_W).toBeGreaterThanOrEqual(480);
  });

  test("controls are links, buttons, fields and their roles", () => {
    for (
      const s of ["a[href]", "button", "input", "select", "textarea", "label"]
    ) {
      expect(CONTROL_SELECTOR).toContain(s);
    }
    expect(CONTROL_SELECTOR).toContain('[role="button"]');
  });
});

describe("REQ-228 — the stage reserves the band its pill really takes", () => {
  test("measured height + its bottom offset + a gap", () => {
    expect(stageInsetBottom(40)).toBe(40 + STAGE_PILL_BOTTOM + STAGE_PILL_GAP);
    expect(stageInsetBottom(120)).toBe(
      120 + STAGE_PILL_BOTTOM + STAGE_PILL_GAP,
    );
  });

  test("before the pill is measured, the old band stands", () => {
    expect(stageInsetBottom(0)).toBe(76);
  });
});

describe("REQ-228 — the islands use it", () => {
  test("the customer's pill is one line and placed by pickPillSlot", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(/pickPillSlot\(/);
    expect(o).toMatch(/pillSlots\(/);
    expect(o).toMatch(/elementsFromPoint/);
    expect(o).toMatch(/white-space:nowrap/);
    expect(o).not.toMatch(/pillStyle = `[^`]*flex-wrap:wrap/);
    expect(o).not.toMatch(/left:12px;bottom:12px/);
  });

  test("the stage measures its pill and the hint is a tooltip", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/stageInsetBottom\(/);
    expect(s).toMatch(/ResizeObserver/);
    expect(s).not.toMatch(/bottom: 76/);
    expect(s).toMatch(/title=\{t\("demoMode\.pointOnlyHint"\)\}/);
  });
});

/**
 * REQ-291 — demo issue p14 (cycle 1): the stage pill wrapped onto two lines at 1440 px.
 * A fixed box with `left:50%` and no width gets CSS shrink-to-fit's available width capped at
 * half the viewport (CSS 2.1 §10.3.7), so content wider than 720 px wrapped even though
 * `max-width:calc(100vw - 24px)` allowed far more. Centre with `left:0;right:0;margin:0 auto;
 * width:max-content` instead: the box is as wide as its content, up to the real max-width.
 */
describe("REQ-291 — the stage pill is one line as long as the window holds it", () => {
  const pillStyle = () => {
    const s = read("front-end/islands/DemoStage.tsx");
    const m = s.match(/const pillStyle =\s*`([^`]*)`/);
    if (!m) throw new Error("DemoStage.tsx has no pillStyle template");
    return m[1];
  };

  test("the pill is not centred by left:50% + translate, which halves its available width", () => {
    const o = pillStyle();
    expect(o).not.toMatch(/left:50%/);
    expect(o).not.toMatch(/translateX\(-50%\)/);
  });

  test("the pill is centred by auto margins at max-content width, capped by the viewport", () => {
    const o = pillStyle();
    expect(o).toMatch(/position:fixed/);
    expect(o).toMatch(/left:0;right:0;margin:0 auto/);
    expect(o).toMatch(/width:max-content/);
    expect(o).toMatch(/max-width:calc\(100vw - 24px\)/);
    // genuinely narrow windows still wrap instead of overflowing — and the cap includes the
    // padding, or max-content + content-box pushes the border box past the viewport
    expect(o).toMatch(/flex-wrap:wrap/);
    expect(o).toMatch(/box-sizing:border-box/);
  });

  test("REQ-228's band measurement still drives the frame", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/ref=\{pillRef\}/);
    expect(s).toMatch(/stageInsetBottom\(pillH\)/);
  });
});
