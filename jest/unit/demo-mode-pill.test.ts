/**
 * REQ-228 — the demo pills never cover the page (demo issue pointer-and-replica-side-effects-m4).
 * The customer's pill stays one line and sits in the corner of the screen that has no control
 * under it (it moves when the page under it changes); the staff stage keeps the frame out of the
 * band its pill measures, not a guessed 76 px, and the long hint is a tooltip, not pill text.
 *
 * REQ-379 (demo-loop cycle 2, M1 + M6 + M28) replaced the customer pill's corner / slot picking
 * (REQ-228, REQ-295) with one home in a band the page leaves for it: its tests are in
 * demo-pill-home.test.ts; what still holds of REQ-228 and REQ-295 is tested here.
 */
import * as fs from "fs";
import * as path from "path";
import {
  clampRect,
  clearPillRoom,
  CONTROL_SELECTOR,
  countsAsPage,
  PAGE_MEDIA_SELECTOR,
  PILL_BOX_STEP,
  PILL_COMPACT_MAX_W,
  PILL_MARGIN,
  PILL_MOVE_MS,
  PILL_ROOM_VAR,
  pillGhostBox,
  pillStore,
  rectsOverlap,
  reservedBox,
  samplePoints,
  setPillRoom,
  STAGE_PILL_BOTTOM,
  STAGE_PILL_GAP,
  stageInsetBottom,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-228 — the pill's geometry (REQ-379: one home, no corner picking)", () => {
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
  test("the customer's pill is one line, at its one home (pillHome, REQ-379)", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(/pillHome\(/);
    expect(o).toMatch(/elementsFromPoint/);
    expect(o).toMatch(/white-space:nowrap/);
    expect(o).not.toMatch(/pillStyle = `[^`]*flex-wrap:wrap/);
  });

  test("the stage measures its pill and the hint is a tooltip", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/stageInsetBottom\(/);
    expect(s).toMatch(/ResizeObserver/);
    expect(s).not.toMatch(/bottom: 76/);
    expect(s).toMatch(/title=\{t\("demoMode\.pointOnlyHint"\)\}/);
  });
});

describe("REQ-295 — the pill holds one clear spot over nothing of the page (demo-loop cycle 1, M1)", () => {
  const view = { w: 390, h: 844 };
  const none = {
    root: false,
    control: false,
    media: false,
    text: false,
    painted: false,
    areaFrac: 0,
  };

  test("what counts as the page under the pill: controls, media, dialogs, text, a painted box — not the root", () => {
    expect(countsAsPage({ ...none, root: true })).toBe(false);
    expect(countsAsPage(none)).toBe(false);
    expect(countsAsPage({ ...none, control: true })).toBe(true);
    expect(countsAsPage({ ...none, media: true })).toBe(true);
    expect(countsAsPage({ ...none, text: true })).toBe(true);
    // a card or a bar is page; a page-wide background is not
    expect(countsAsPage({ ...none, painted: true, areaFrac: 0.2 })).toBe(true);
    expect(countsAsPage({ ...none, painted: true, areaFrac: 0.9 })).toBe(false);
    // the root painted is still the root
    expect(countsAsPage({ ...none, root: true, painted: true, areaFrac: 0.1 }))
      .toBe(false);
    for (const s of ["img", "canvas", "svg", "video", "dialog"]) {
      expect(PAGE_MEDIA_SELECTOR).toContain(s);
    }
    expect(PAGE_MEDIA_SELECTOR).toContain('[role="dialog"]');
    expect(PAGE_MEDIA_SELECTOR).toContain('[aria-modal="true"]');
  });

  test("boxes overlap when they share area, not when they only touch", () => {
    const a = { left: 10, top: 10, width: 100, height: 40 };
    expect(rectsOverlap(a, { left: 100, top: 40, width: 50, height: 50 })).toBe(
      true,
    );
    expect(rectsOverlap(a, { left: 110, top: 10, width: 50, height: 50 })).toBe(
      false,
    );
    expect(rectsOverlap(a, { left: 0, top: 50, width: 500, height: 5 })).toBe(
      false,
    );
    expect(rectsOverlap(a, { left: 0, top: 0, width: 500, height: 500 })).toBe(
      true,
    );
  });

  test("the reserved box: the pill's size rounded up to steps (REQ-379: the band's height), so a status change does not move the page", () => {
    expect(PILL_BOX_STEP).toEqual({ w: 40, h: 8 });
    expect(reservedBox({ w: 290, h: 34 })).toEqual({ w: 320, h: 40 });
    expect(reservedBox({ w: 300, h: 34 })).toEqual({ w: 320, h: 40 });
    expect(reservedBox({ w: 320, h: 40 })).toEqual({ w: 320, h: 40 });
    expect(reservedBox({ w: 305, h: 36 })).toEqual(
      reservedBox({ w: 290, h: 34 }),
    );
  });

  test("the pill's room: --demo-pill-h on html and body padding, cleared when there is none", () => {
    const calls: string[] = [];
    const style = (tag: string) => ({
      setProperty: (n: string, v: string) =>
        void calls.push(`${tag} set ${n}=${v}`),
      removeProperty: (n: string) => void calls.push(`${tag} rm ${n}`),
    });
    setPillRoom(style("html"), style("body"), 64.4);
    expect(calls).toEqual([
      `html set ${PILL_ROOM_VAR}=64px`,
      `body set padding-bottom=var(${PILL_ROOM_VAR}, 0px)`,
    ]);
    calls.length = 0;
    clearPillRoom(style("html"), style("body"));
    expect(calls).toEqual([
      `html rm ${PILL_ROOM_VAR}`,
      "body rm padding-bottom",
    ]);
    calls.length = 0;
    setPillRoom(style("html"), style("body"), 0);
    expect(calls).toEqual([
      `html rm ${PILL_ROOM_VAR}`,
      "body rm padding-bottom",
    ]);
  });

  test("the stage draws the pill's box where the frame puts it", () => {
    const fit = { left: 100, top: 50, width: 195, height: 422, s: 0.5 };
    expect(
      pillGhostBox({ left: 12, top: 800, width: 320, height: 40 }, fit),
    ).toEqual({ left: 106, top: 450, width: 160, height: 20 });
  });

  test("the store is the tab's sessionStorage, none in node", () => {
    expect(pillStore()).toBeNull();
    const g = globalThis as { sessionStorage?: unknown };
    g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    expect(pillStore()).toBe(g.sessionStorage);
    delete g.sessionStorage;
  });

  test("a move glides", () => {
    expect(PILL_MOVE_MS).toBeGreaterThanOrEqual(150);
    expect(PILL_MOVE_MS).toBeLessThanOrEqual(400);
  });

  test("the overlay is wired to it: the room, page-aware dialog checks, the glide, the message to the stage", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(/setPillRoom\(/);
    expect(o).toMatch(/clearPillRoom\(/);
    // REQ-379: what is under the home while a dialog is up (the dock), by the same rule
    expect(o).toMatch(/countsAsPage\(/);
    // REQ-379: a dock glides
    expect(o).toMatch(/transition:transform \$\{PILL_MOVE_MS\}ms ease/);
    expect(o).toMatch(/k: "pill"/);
    expect(o).not.toMatch(/controlsUnder/);
  });

  test("the stage draws the ghost, in both languages", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/pillGhostBox\(/);
    expect(s).toMatch(/data-cy="demo-pill-ghost"/);
    expect(s).toMatch(/case "pill":/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["demoMode.pillGhost"]).toMatch(/\{name\}/);
    expect(es["demoMode.pillGhost"]).toMatch(/\{name\}/);
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
