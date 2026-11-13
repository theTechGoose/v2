/**
 * REQ-637 — demo-loop cycle 5, issue m5: the customer's demo pill shrank to a tiny green tab
 * (16×40, an 8 px dot, no words, no End) on public pages and under dialogs; End was hidden.
 *
 * RCA (CONFIRMED, skeptic UPHELD, at demo-fixes 2444608a): REQ-545's `placePill` returned the
 * tucked tab (`tabBox`, `PILL_TAB` 16×40) always on /q /i /co (`minimal`), under a dialog when
 * `dockPill` found home, top-left and top-right covered, and whenever page content was under the
 * home. The folded render (`data-cy="demo-pill-tab"`) held only a status dot; End showed only
 * after a hover or tap.
 *
 * Now the yield stays, but the folded pill is a labelled mini-pill ("● Demo" plus an × that is
 * End: one tap asks "End for everyone?"); on a public document page the whole pill sits home on
 * its bottom strip (the band) instead of folding; under a dialog it docks above the dialog's own
 * box first. The stage's ghost draws the mini-pill with its word.
 */
import * as fs from "fs";
import * as path from "path";
import {
  dockPill,
  PILL_BAND_GAP,
  PILL_MARGIN,
  PILL_TAB,
  pillHome,
  placePill,
  tabBox,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const view = { w: 1280, h: 720 };
const homeBox = () => pillHome({ view, size: { w: 700, h: 43 } }).box;

describe("REQ-637 (demo-loop cycle 5, m5) — the folded pill is a labelled mini-pill, not a 16 px sliver", () => {
  test("REQ-637 PILL_TAB is a mini-pill: 80–110 px wide (room for 'Demo' and its ×), a tap target tall", () => {
    expect(PILL_TAB.w).toBeGreaterThanOrEqual(80);
    expect(PILL_TAB.w).toBeLessThanOrEqual(110);
    expect(PILL_TAB.h).toBeGreaterThanOrEqual(28);
    expect(PILL_TAB.h).toBeLessThanOrEqual(40);
  });

  test("REQ-637 tabBox: flush with the left edge, its foot on the home's foot, the mini-pill's size", () => {
    const home = homeBox();
    const t = tabBox(home);
    expect(t.left).toBe(0);
    expect(t.width).toBe(PILL_TAB.w);
    expect(t.height).toBe(PILL_TAB.h);
    expect(t.top + t.height).toBe(home.top + home.height);
  });
});

describe("REQ-637 — a public /q /i /co page: the whole pill on its bottom strip, never folded", () => {
  // REQ-781 (demo-loop cycle dv1, d7) AMENDMENT — no band any more: the whole pill floats home
  // while nothing is under it, else to a spot with no control under it; only a page with a
  // control under every spot folds it (see jest/unit/demo-pill-no-gap.test.ts)
  test("REQ-637 minimal with page content under the home: whole where no control is (REQ-781: never on a band)", () => {
    const home = homeBox();
    expect(
      placePill({
        home,
        view,
        dialog: false,
        minimal: true,
        blocked: () => 3,
        controls: () => 0,
      }),
    ).toEqual({ box: home, tucked: false, band: false });
    expect(
      placePill({ home, view, dialog: false, minimal: true, blocked: () => 0 }),
    ).toEqual({ box: home, tucked: false, band: false });
  });

  test("REQ-637 minimal under a dialog: it still docks, and with nowhere free it folds to the mini-pill", () => {
    const home = homeBox();
    const docked = placePill({
      home,
      view,
      dialog: true,
      minimal: true,
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(docked.tucked).toBe(false);
    expect(docked.box.top).toBe(PILL_MARGIN);
    const all = placePill({
      home,
      view,
      dialog: true,
      minimal: true,
      blocked: () => 1,
    });
    expect(all.tucked).toBe(true);
    expect(all.box).toEqual(tabBox(home));
  });
});

describe("REQ-637 — under a dialog the pill docks above the dialog's own box first", () => {
  const dialogBox = { left: 400, top: 300, width: 480, height: 360 };

  test("REQ-637 home covered, room above the dialog: just above its box, at its left", () => {
    const home = homeBox();
    const box = dockPill({
      home,
      view,
      top: 0,
      dialog: dialogBox,
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(box).toEqual({
      ...home,
      left: dialogBox.left,
      top: dialogBox.top - PILL_BAND_GAP - home.height,
    });
  });

  test("REQ-637 above the dialog is preferred over the top-left when both are clear", () => {
    const home = homeBox();
    const p = placePill({
      home,
      view,
      dialog: true,
      dialogBox,
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(p.tucked).toBe(false);
    expect(p.box.top).toBe(dialogBox.top - PILL_BAND_GAP - home.height);
    expect(p.box.top).not.toBe(PILL_MARGIN);
  });

  test("REQ-637 a dialog reaching the top (no room above it, or under the banner): the top-left as before", () => {
    const home = homeBox();
    const tall = { left: 400, top: 30, width: 480, height: 640 };
    const box = dockPill({
      home,
      view,
      top: 0,
      dialog: tall,
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(box).toEqual({ ...home, left: PILL_MARGIN, top: PILL_MARGIN });
    // with a 40 px banner, the spot above a dialog at 90 would run under it
    const under = dockPill({
      home,
      view,
      top: 40,
      dialog: { ...tall, top: 90 },
      blocked: (r) => (r.top === home.top ? 1 : 0),
    });
    expect(under?.top).toBe(40 + PILL_MARGIN);
  });

  test("REQ-637 the spot above the dialog is never kept when something of the page is there", () => {
    const home = homeBox();
    const above = dialogBox.top - PILL_BAND_GAP - home.height;
    const box = dockPill({
      home,
      view,
      top: 0,
      dialog: dialogBox,
      blocked: (r) => (r.top === home.top || r.top === above ? 1 : 0),
    });
    expect(box?.top).toBe(PILL_MARGIN);
  });
});

describe("REQ-637 — the overlay draws the mini-pill: its word, its End (×), the whole pill on public pages", () => {
  const o = () => read("front-end/islands/DemoModeOverlay.tsx");
  const folded = () => {
    const src = o();
    const at = src.indexOf('data-cy="demo-pill-tab"');
    expect(at).toBeGreaterThan(0);
    return src.slice(at - 400, at + 3000);
  };

  test("REQ-637 the folded pill says 'Demo' (demoMode.tabLabel) beside its status dot", () => {
    expect(folded()).toMatch(/t\("demoMode\.tabLabel"\)/);
  });

  test("REQ-637 the folded pill keeps End: an × (demo-pill-tab-end) named End demo that asks at once", () => {
    const f = folded();
    expect(f).toMatch(/data-cy="demo-pill-tab-end"/);
    expect(f).toMatch(/aria-label=\{t\("demoMode\.end"\)\}/);
    expect(f).toMatch(/setAskEnd\(true\)/);
    // the whole pill comes out with End's question already up
    expect(o()).toMatch(/<EndDemo[\s\S]{0,300}askAtOnce=\{askEnd\}/);
  });

  test("REQ-637 EndDemo can open with its question already asked", () => {
    const end = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(end).toMatch(/askAtOnce\?:\s*boolean/);
    expect(end).toMatch(/if \(askAtOnce\) ask\.ask\(\)/);
  });

  test("REQ-637 a public document page no longer starts folded; the dialog's own box is handed to placePill", () => {
    const src = o();
    expect(src).not.toMatch(
      /useState\(\(\) =>\s*typeof globalThis\.location !== "undefined" &&\s*isPublicDocPath/,
    );
    expect(src).toMatch(/dialogBox:\s*dialog \? dialogPanel\(\) : undefined/);
  });

  test("REQ-637 the mini-pill style: its own width and height, rounded, a pill's font", () => {
    const src = o();
    const at = src.indexOf("const tabStyle");
    const s = src.slice(at, at + 900);
    expect(s).toMatch(/width:\$\{PILL_TAB\.w\}px/);
    expect(s).toMatch(/height:\$\{PILL_TAB\.h\}px/);
    expect(s).toMatch(/font-family:\$\{PILL_FONT\}/);
  });
});

describe("REQ-637 — the stage's ghost of the folded pill shows the same word", () => {
  test("REQ-637 the tucked ghost carries the 'Demo' label and the ×", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    const at = s.indexOf('data-tucked=""');
    expect(at).toBeGreaterThan(0);
    const ghost = s.slice(at - 600, at + 1800);
    expect(ghost).toMatch(/data-cy="demo-pill-ghost-tab-label"/);
    expect(ghost).toMatch(/t\("demoMode\.tabLabel"\)/);
  });

  test("REQ-637 the word in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["demoMode.tabLabel"]).toBe("Demo");
    expect(typeof es["demoMode.tabLabel"]).toBe("string");
    expect(es["demoMode.tabLabel"].length).toBeGreaterThan(0);
  });
});
