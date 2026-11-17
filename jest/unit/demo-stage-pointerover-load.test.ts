/**
 * REQ-539 AMENDMENT (2026-11-16, the demo-mode e2e lane's m24 story, red since cycle 4): a stage
 * opened from /admin under a still mouse DID get a pointer event — Chromium fires a trusted
 * `pointerover` (and `pointerenter` / `mouseover`) at the mouse's spot some 40 ms after the page
 * loads (measured: headless shell 1208, Playwright 1.58; the stage's handler treated it as "a real
 * event says where the mouse is"), so /admin's hand-off hint became his arrow on her screen —
 * on a desktop customer the Demo button's spot falls on the fitted frame (REQ-539's m24: her mic
 * button). A `pointerover` with no `pointermove` / `pointerdown` before it on this page is not a
 * move of his: it is where the mouse already was — a hint, as /admin's hand-off is. Once he has
 * moved (or pressed) on the stage, `pointerover` counted as before — until REQ-539 AMENDMENT 2
 * (demo-loop run 8, m4): Chromium also fires a trusted `pointerover` when the element under a STILL
 * mouse changes (the customer narrowed her window; the fitted frame shrank out from under his
 * cursor), and that counted as his move: his arrow left "Mailing address" for the frame's edge with
 * the off marker. A `pointerover` is never a move of his; a real move always brings `pointermove`.
 */
import * as fs from "fs";
import * as path from "path";
import { pointerCounts } from "../../front-end/lib/demo-mode/cursor-handoff";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-539 AMENDMENT — a pointerover before any move on the stage is where the mouse was, not a move", () => {
  test("REQ-539 pointerCounts: pointermove and pointerdown count; pointerover never (AMENDMENT 2: not even after a move — a layout change under a still mouse fires one)", () => {
    expect(pointerCounts("pointermove")).toBe(true);
    expect(pointerCounts("pointerdown")).toBe(true);
    expect(pointerCounts("pointerover")).toBe(false);
    expect(pointerCounts("pointerenter")).toBe(false);
    expect(pointerCounts("mouseover")).toBe(false);
  });

  test("REQ-539 wiring: the stage's handler asks pointerCounts (AMENDMENT 2: no 'moved' memory — pointerover never counts)", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    const i = stage.indexOf("const at = (e: PointerEvent) => {");
    expect(i).toBeGreaterThan(0);
    const at = stage.slice(i, i + 700);
    expect(at).toMatch(/if \(!pointerCounts\(e\.type\)\) return;/);
    expect(stage).not.toMatch(/movedRef/);
  });
});
