/**
 * REQ-539 AMENDMENT (2026-11-16, the demo-mode e2e lane's m24 story, red since cycle 4): a stage
 * opened from /admin under a still mouse DID get a pointer event — Chromium fires a trusted
 * `pointerover` (and `pointerenter` / `mouseover`) at the mouse's spot some 40 ms after the page
 * loads (measured: headless shell 1208, Playwright 1.58; the stage's handler treated it as "a real
 * event says where the mouse is"), so /admin's hand-off hint became his arrow on her screen —
 * on a desktop customer the Demo button's spot falls on the fitted frame (REQ-539's m24: her mic
 * button). A `pointerover` with no `pointermove` / `pointerdown` before it on this page is not a
 * move of his: it is where the mouse already was — a hint, as /admin's hand-off is. Once he has
 * moved (or pressed) on the stage, `pointerover` counts as before (the frame appearing under his
 * cursor after a fit).
 */
import * as fs from "fs";
import * as path from "path";
import { pointerCounts } from "../../front-end/lib/demo-mode/cursor-handoff";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-539 AMENDMENT — a pointerover before any move on the stage is where the mouse was, not a move", () => {
  test("REQ-539 pointerCounts: pointermove and pointerdown always count; pointerover only once he has moved", () => {
    expect(pointerCounts("pointermove", false)).toBe(true);
    expect(pointerCounts("pointerdown", false)).toBe(true);
    expect(pointerCounts("pointerover", false)).toBe(false);
    expect(pointerCounts("pointerover", true)).toBe(true);
    expect(pointerCounts("pointermove", true)).toBe(true);
  });

  test("REQ-539 wiring: the stage's handler asks pointerCounts and remembers a move", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    const i = stage.indexOf("const at = (e: PointerEvent) => {");
    expect(i).toBeGreaterThan(0);
    const at = stage.slice(i, i + 700);
    expect(at).toMatch(/if \(!pointerCounts\(e\.type, movedRef\.current\)\) return;/);
    expect(at).toMatch(/if \(e\.type !== "pointerover"\) movedRef\.current = true;/);
    // a demo's end / another demo: the stage opens unmoved again
    expect(stage).toMatch(/movedRef\.current = false;/);
  });
});
