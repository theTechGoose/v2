/**
 * Demo-loop run 13 (2026-11-17), by hand — Raphael: "fix the polish problems personally, until
 * there are none."
 *  m1 — REQ-862 AMENDMENT 7: the stage's tab notice ("Now showing {name}'s other tab (…)") was
 *       gated on his mouse being ON the frame (`!off`): with it resting beside the frame the row
 *       kept the pointer-off hint and he never learnt her screen was another tab. The row's order
 *       (REQ-862 AMENDMENT 6: notice → picker words → pointer-off hint) now holds with his mouse
 *       anywhere: the notice needs no `off`, and the hint waits for the notice too.
 *  p1 + p4 — REQ-820 AMENDMENT: the placement that turns the folded tab into the whole pill (a
 *       join's grace on /welcome; a carried tab's next page on /worker) glided from the tab's
 *       translate: 520 px down the welcome page over its language buttons, the question, an
 *       input and Back; and in from a right-edge tab's x, "Terminar demo" off the 390 px screen.
 *       REQ-820 said the frame out of the tab has no glide — for the peek; now for that placement.
 *  p2 — REQ-298 AMENDMENT: the phone's compact pill's restart line "{name} started a new demo"
 *       with "Connected" and "End demo" did not fit a 366 px row: the line wrapped to two, the pill
 *       grew to 54 px, fit no 53 px band and sat 5 px over "Step 2 of 10". Compact: "{name} · new demo".
 *  p3 — REQ-846 AMENDMENT: the logged-out banner was clipped to the FRAME's width (316 px for a
 *       390 px customer on a 1280 px stage): "Maria Lopez cerró sesión Su última pantalla se…".
 *       It is clipped to the window, like the row's other badges.
 */
// REVISION (demo-loop run 16, by hand): both hints also yield the row to a native dialog's words (REQ-827 AMENDMENT).
import * as fs from "fs";
import * as path from "path";
import { startedText } from "../../shared/demo-mode/restart";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stage = read("front-end/islands/DemoStage.tsx");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** the JSX block of one `{cond && (<div data-cy=…>…)}` */
function block(cy: string): string {
  const at = stage.indexOf(`data-cy="${cy}"`);
  expect(at).toBeGreaterThan(-1);
  const open = stage.lastIndexOf("{", stage.lastIndexOf("&& (", at));
  return stage.slice(open, stage.indexOf("\n            )}", at));
}

describe("REQ-862 AMENDMENT 7 (demo-loop run 13, m1): the tab notice shows with his mouse OFF the frame; the pointer-off hint yields the row to it", () => {
  test("the notice's gate asks nothing of `off`", () => {
    expect(stage).toMatch(
      /\{badges && tabNote !== null && \(\s*<div\s+data-cy="demo-tab-switched"/,
    );
    expect(stage).not.toMatch(/tabNote !== null && !off/);
  });
  test("the pointer-off hint waits for the notice as well as the picker words", () => {
    expect(stage).toMatch(
      /\{badges && off && pickerOut === null && tabNote === null && nativeAsk === null && \(\s*<div\s+data-cy="demo-pointer-off"/,
    );
  });
  test("the picker words still wait for the notice only (REQ-862 AMENDMENT 6)", () => {
    expect(stage).toMatch(
      /\{badges && pickerOut !== null && tabNote === null && nativeAsk === null && \(\s*<div\s+data-cy="demo-picker-outside"/,
    );
  });
});

describe("REQ-820 AMENDMENT (demo-loop run 13, p1 + p4): the placement that turns the tab into the whole pill jumps to its box — no glide from the tab's translate", () => {
  test("the placement commit sets noGlide when the pill goes from tucked to whole", () => {
    expect(overlay).toMatch(
      /if \(tuckedRef\.current && !p\.tucked\) \{\s*setNoGlide\(true\);/,
    );
  });
  test("the whole pill out of its tab with no whole size known is measured hidden, next frame — never painted at a tab-sized spot", () => {
    expect(overlay).toMatch(
      /const tabOnScreen = el\.hasAttribute\("data-tucked"\);\s*const measureAgain = !folded && tabOnScreen && !fullRef\.current;/,
    );
    // the tab's box is never taken for the whole pill's size
    expect(overlay).toMatch(/if \(!folded && !tabOnScreen\) \{\s*const r = el\.getBoundingClientRect\(\);/);
    expect(overlay).toMatch(
      /if \(measureAgain\) \{\s*setMeasuring\(true\);\s*requestAnimationFrame\(\(\) => placeRef\.current\(\)\);\s*\}/,
    );
    expect(overlay).toMatch(/if \(!measureAgain\) setMeasuring\(false\);/);
    expect(overlay).toMatch(/measuring \? ";visibility:hidden" : ""/);
  });
  test("noGlide still paints the whole pill with no transition (REQ-820)", () => {
    expect(overlay).toMatch(/noGlide\s*\?\s*"transition:none"/);
  });
});

describe("REQ-298 AMENDMENT (demo-loop run 13, p2): the compact pill's restart line is '{name} · new demo'", () => {
  const hans = { userId: "u1", name: "Hans", color: "#000" } as never;
  test("startedText: compact → demoMode.startedByCompact with the names; the desktop line unchanged", () => {
    expect(startedText([hans], "", true)).toEqual({
      key: "demoMode.startedByCompact",
      vars: { name: "Hans" },
    });
    expect(startedText([hans], "")).toEqual({
      key: "demoMode.startedBy",
      vars: { name: "Hans" },
    });
    expect(startedText([hans], "", false)).toEqual({
      key: "demoMode.startedBy",
      vars: { name: "Hans" },
    });
    // nobody named: the plain line, compact or not
    expect(startedText([], "", true)).toEqual({ key: "demoMode.started" });
  });
  test("both dictionaries carry the compact line, shorter than the full one", () => {
    expect(en["demoMode.startedByCompact"]).toBe("{name} · new demo");
    expect(es["demoMode.startedByCompact"]).toBe("{name} · nueva demo");
    expect(en["demoMode.startedByCompact"].length).toBeLessThan(
      en["demoMode.startedBy"].length,
    );
    expect(es["demoMode.startedByCompact"].length).toBeLessThan(
      es["demoMode.startedBy"].length,
    );
  });
  test("the overlay asks for the form it shows (compact)", () => {
    expect(overlay).toMatch(
      /startedText\(demo\.presenters, demo\.presenterName, compact\)/,
    );
  });
});

describe("REQ-846 AMENDMENT (demo-loop run 13, p3): the waiting / signed-out banner is clipped to the window, never to a phone-sized frame", () => {
  test("demo-waiting's max-width is the window's, like the row's other badges", () => {
    const b = block("demo-waiting");
    expect(b).toContain("max-width:calc(100vw - 16px)");
    expect(b).not.toMatch(/max-width:\$\{\s*fit\.width\s*\}px/);
    // still one line in the chrome row (REQ-846), its whole text in title + aria-label
    expect(b).toContain("height:${STAGE_BADGE_H}px");
    expect(b).toContain("white-space:nowrap");
    expect(b).toContain("title={waitingNote}");
  });
  test("the other chrome-row badges are clipped the same way", () => {
    for (const cy of ["demo-pointer-off", "demo-tab-switched", "demo-picker-outside"]) {
      expect(block(cy)).toContain("max-width:calc(100vw - 16px)");
    }
  });
});
