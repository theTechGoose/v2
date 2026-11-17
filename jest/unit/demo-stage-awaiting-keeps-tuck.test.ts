/**
 * REQ-854 — demo-loop cycle dm3, issue p6 (REQ-636 AMENDMENT): on every load of the customer's
 * page with their pill folded, the stage's ghost flashed the whole pill's words ("Modo demo | Alex
 * te está guiando | Conectando… | Terminar demo") inside the folded tab's 96x32 box for ~51 ms,
 * a state the customer never shows (since REQ-830 their first frame is already the folded "Demo ×").
 *
 * Cause (RCA at 5fef7e6d): onPeerOnline puts up the stage's own guess, `pillFaceAwaiting`, which
 * dropped `tucked` (REQ-636: "a non-public page starts with the whole pill" — no longer true after
 * REQ-830), and the ghost's whole-pill branch (`pillFace.tucked !== true`) drew it in the unchanged
 * tab box until the new page's own (folded) face replaced it.
 *
 * The fix: the guess keeps the old page's fold (and band); the new page's first face still
 * replaces it at once when it differs only in what the guess made up (GUESSED: status, label,
 * tucked). As a guard, the stage draws the tab, never the whole pill, while it awaits a new page
 * and the box it holds is the tab's (`ghostDrawsTab`).
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostDrawsTab,
  ghostWords,
  PILL_TAB,
  pillFaceAwaiting,
  pillShowsAtOnce,
} from "../../shared/demo-mode/pill.ts";
import { createPillSync } from "../../shared/demo-mode/pill-sync.ts";
import type { PillFace } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const folded: PillFace = {
  status: "live",
  label: "Conectado",
  text: "Alex te está guiando",
  title: "Modo demo",
  end: "Terminar demo",
  connectingLabel: "Conectando…",
  tucked: true,
  band: 0,
  bandBg: "#fff",
};
const tabBox = { left: 1184, top: 680, width: PILL_TAB.w, height: PILL_TAB.h };
const wholeBox = { left: 900, top: 740, width: 368, height: 48 };

describe("REQ-854 (demo-loop cycle dm3, p6) — the stage's guess at a new page keeps the old page's fold", () => {
  test("a folded pill's guess stays folded (and keeps its band), says Connecting… in their words", () => {
    const w = pillFaceAwaiting(folded);
    expect(w.tucked).toBe(true);
    expect(w.band).toBe(0);
    expect(w.bandBg).toBe("#fff");
    expect(w.status).toBe("connecting");
    expect(w.label).toBe("Conectando…");
  });

  test("a whole pill's guess stays whole (the fold is kept, never made up)", () => {
    const { tucked: _t, ...whole } = folded;
    expect(pillFaceAwaiting(whole).tucked).toBeUndefined();
    expect(pillFaceAwaiting({ ...whole, tucked: false }).tucked).not.toBe(true);
  });

  test("the ghost of a folded pill's guess is the tab: never the whole pill's words in the tab box", () => {
    const w = pillFaceAwaiting(folded);
    expect(ghostDrawsTab(w, tabBox, true)).toBe(true);
    // the words the whole-pill ghost would draw are never drawn for it
    expect(ghostWords(w, (k) => k).status).toBe("Conectando…");
  });

  test("guard: while awaiting a new page, a tab-sized box is drawn as the tab even for an untucked face", () => {
    const { tucked: _t, ...untucked } = pillFaceAwaiting(folded);
    expect(ghostDrawsTab(untucked, tabBox, true)).toBe(true);
    // not awaiting: the face decides
    expect(ghostDrawsTab(untucked, tabBox, false)).toBe(false);
    // awaiting with the whole pill's box: the whole pill
    expect(ghostDrawsTab(untucked, wholeBox, true)).toBe(false);
    expect(ghostDrawsTab(folded, wholeBox, false)).toBe(true);
    expect(ghostDrawsTab(untucked, null, true)).toBe(false);
  });

  test("the new page's own face still replaces the guess at once — folded or whole", () => {
    let now = 0;
    const pills = createPillSync<PillFace>({ now: () => now });
    pills.frame(1_000);
    let shown: PillFace = pills.offer(folded, 1_000)!;
    shown = pillFaceAwaiting(shown);
    pills.reset();
    now = 100;
    expect(pillShowsAtOnce(shown, folded, true)).toBe(true);
    expect(pills.offer(folded, 5_000, true)).toEqual(folded);
    const whole: PillFace = { ...folded, tucked: false };
    expect(pillShowsAtOnce(shown, whole, true)).toBe(true);
  });

  test("DemoStage picks the ghost's shape with ghostDrawsTab(pillFace, pillShown, awaiting)", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    // REVISION (demo-loop run 16, by hand): the box judged is pillBoxNow — pillShown drops the tab's
    // ghost once the demo ended (REQ-868 AMENDMENT)
    expect(s).toMatch(/ghostDrawsTab\(pillFace, pillBoxNow, awaiting\)/);
    expect(s).not.toMatch(/pillShown && pillFace\.tucked !== true/);
    expect(s).not.toMatch(/pillShown && pillFace\.tucked === true/);
  });
});
