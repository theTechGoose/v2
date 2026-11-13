/**
 * REQ-765 — demo-loop cycle 5v2, issue p18-3d "Send modal dim layer doesn't cover the demo pill",
 * re-opened by the verifier after REQ-643: on a 390×844 customer with the Send dialog open (its
 * `.send-dialog__backdrop` inside `.quote-review__send-split`, fixed, 0 → 780 of 844), the STAGE
 * still showed the bottom 64 px demo-pill band (beige strip + "DocuMonster · Connected · End demo")
 * at full brightness.
 *
 * Why REQ-643 missed it: it dimmed only the customer's own band (`bandDim`, painted in the
 * overlay). The mirror skips the overlay (REQ-242), so the stage draws the band and the pill itself
 * (`demo-band-ghost`, `demo-pill-ghost`, REQ-545/372) from the pill message — which carried only
 * `band` + `bandBg`, never the dim. The ghosts sit over the frame, so they stayed bright over the
 * replayed dimmed page. And the pill itself (REQ-379: z-index above every app dialog) stayed bright
 * on the customer's screen too.
 *
 * Now: the pill message carries the dialog's dim (`dim`); the stage paints its band ghost with it
 * (`bandPaint`) and softens its pill ghost; the customer's pill is softened (still clickable) while
 * a dialog's dim is up.
 */
import * as fs from "fs";
import * as path from "path";
import {
  bandPaint,
  dialogDim,
  PILL_UNDER_DIALOG_OPACITY,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-765 (demo-loop cycle 5v2, p18-3d) — a dialog's dim covers the demo pill and its band on the stage too", () => {
  test("dialogDim: the send dialog's see-through backdrop colour; an opaque sheet or none is no dim", () => {
    expect(dialogDim("rgba(20, 44, 48, 0.45)")).toBe("rgba(20, 44, 48, 0.45)");
    expect(dialogDim("rgb(255, 255, 255)")).toBeNull();
    expect(dialogDim("rgba(0, 0, 0, 0)")).toBeNull();
    expect(dialogDim("transparent")).toBeNull();
    expect(dialogDim("")).toBeNull();
  });

  test("the pill is softened under a dialog, never hidden", () => {
    expect(PILL_UNDER_DIALOG_OPACITY).toBeGreaterThan(0.3);
    expect(PILL_UNDER_DIALOG_OPACITY).toBeLessThan(1);
  });

  test("the pill message carries the dialog's dim to the stage; junk is dropped", () => {
    const r = { left: 12, top: 790, width: 366, height: 40 };
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        band: 64,
        bandBg: "rgb(242, 235, 224)",
        dim: "rgba(20, 44, 48, 0.45)",
      }),
    ).toEqual({
      k: "pill",
      r,
      band: 64,
      bandBg: "rgb(242, 235, 224)",
      dim: "rgba(20, 44, 48, 0.45)",
    });
    expect(
      parsePeerMessage({ k: "pill", r, dim: "url(javascript:x)" }),
    ).toEqual({ k: "pill", r });
  });

  test("the verifier's band: beige under the send dialog's dim is painted dimmed on the stage", () => {
    expect(bandPaint("rgb(242, 235, 224)", dialogDim("rgba(20, 44, 48, 0.45)")))
      .toBe(
        "linear-gradient(rgba(20, 44, 48, 0.45), rgba(20, 44, 48, 0.45)), rgb(242, 235, 224)",
      );
  });

  test("the overlay sends the dim with the pill's face and softens its own pill under it", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(/dialogDim\(/);
    expect(o).toMatch(/dim: bandRef\.current\.dim/);
    expect(o).toMatch(/PILL_UNDER_DIALOG_OPACITY/);
  });

  test("the stage paints the band ghost in the dim and softens the pill ghost", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/dim: m\.dim/);
    expect(s).toMatch(
      /bandPaint\(\s*pillFace\.bandBg \?\? "#fff",\s*pillFace\.dim \?\? null,?\s*\)/,
    );
    expect(s).toMatch(/PILL_UNDER_DIALOG_OPACITY/);
    expect(s).toMatch(/data-dim=\{pillFace\.dim \? "" : undefined\}/);
  });
});
