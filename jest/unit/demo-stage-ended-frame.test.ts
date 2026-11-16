/**
 * REQ-895 — demo-loop run 6 (dm6), issue m6: the stage's last frame after the customer ended the
 * demo showed a different, clipped ghost pill ("Modo demo · Ter… · La demo terminó") while her
 * pill read "Modo demo · Terminaste la demo · ×", and kept the dashed off-frame outline.
 *
 * Two causes. (1) The overlay's ended-notice face carried `label` ("The demo ended"); `ghostWords`
 * drew it as a status chip beside the text, which squeezed the text to "Ter…" — the notice itself
 * has no chip, only a ×. The face now says `notice: true` (on the wire: parsePillFace keeps it),
 * and a notice face's ghost is title + text + × — no status chip, no End. (2) The frame's dashed
 * outline (`mirrored && off`, REQ-393) had no `ended` gate, unlike the chrome-row badges
 * (REQ-868): it is gone once the demo has ended.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostWords,
  pillFaceOffline,
  pillShowsAtOnce,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const t = (k: string) => `en:${k}`;

const notice = {
  compact: false,
  open: false,
  status: "ended" as const,
  text: "Terminaste la demo",
  label: "La demo terminó",
  title: "Modo demo",
  notice: true,
};

describe("REQ-895 (dm6, m6) the stage's ended frame mirrors the customer's notice and drops the outline", () => {
  test("REQ-895 ghostWords on a notice face: title, the whole text and a × — no status chip, no End", () => {
    const w = ghostWords(notice, t);
    expect(w.title).toBe("Modo demo");
    expect(w.text).toBe("Terminaste la demo");
    expect(w.status).toBeUndefined();
    expect(w.end).toBeUndefined();
    expect(w.ask).toBeUndefined();
    expect(w.dismiss).toBe("×");
    // the compact (phone) notice has no title, as the phone shows it
    expect(ghostWords({ ...notice, compact: true }, t).title).toBeUndefined();
    expect(ghostWords({ ...notice, compact: true }, t).text).toBe(
      "Terminaste la demo",
    );
    // a face that really shows a status is as before: its chip, no ×
    const ended = ghostWords({ ...notice, notice: undefined }, t);
    expect(ended.status).toBe("La demo terminó");
    expect(ended.dismiss).toBeUndefined();
    expect(ghostWords({ status: "live", label: "Conectado" }, t).dismiss)
      .toBeUndefined();
  });

  test("REQ-895 the notice flag rides the pill message and survives the link going", () => {
    const r = { left: 12, top: 790, width: 320, height: 40 };
    expect(parsePeerMessage({ k: "pill", r, ...notice })).toEqual({
      k: "pill",
      r,
      ...notice,
    });
    // junk is dropped
    expect(
      (parsePeerMessage({ k: "pill", r, notice: "yes" }) as {
        notice?: unknown;
      })
        .notice,
    ).toBeUndefined();
    // the customer's page went after the end: still the notice's words
    const off = pillFaceOffline(notice, "ended");
    expect(off.notice).toBe(true);
    expect(ghostWords(off, t).status).toBeUndefined();
    expect(ghostWords(off, t).dismiss).toBe("×");
  });

  test("REQ-895 the notice shows at once: no frame follows an overlay-only change (it waited PILL_HOLD_MAX_MS for one)", () => {
    const live = {
      compact: false,
      open: false,
      status: "live" as const,
      text: "Hans te está guiando",
      label: "Conectado",
      title: "Modo demo",
      end: "Terminar",
    };
    expect(pillShowsAtOnce(live, notice, false, false)).toBe(true);
    expect(pillShowsAtOnce(live, notice, true, false)).toBe(true);
    // a plain new face still waits for its frame; a notice already shown is not "at once" again
    expect(
      pillShowsAtOnce(live, { ...live, text: "Otra línea" }, false, false),
    ).toBe(false);
    expect(
      pillShowsAtOnce(notice, { ...notice, text: "Otra" }, false, false),
    ).toBe(false);
  });

  test("REQ-895 wiring: the overlay's notice face says so; the stage copies and draws it and gates the outline on the demo not ended", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    const face = overlay.slice(
      overlay.indexOf('data-cy="demo-ended"') - 600,
      overlay.indexOf('data-cy="demo-ended"'),
    );
    expect(face).toMatch(/faceRef\.current = noticeFaceOf\(notice\)/);
    const maker = overlay.slice(
      overlay.indexOf("const noticeFaceOf = "),
      overlay.indexOf("const sayEnded = "),
    );
    expect(maker).toMatch(/status: "ended",[\s\S]{0,200}notice: true/);
    // the notice reaches the stage BEFORE this side's end does (the stage's socket closes on
    // the server's ended): said from one source, before link.end() and the server call
    expect(overlay).toMatch(/faceRef\.current = noticeFaceOf\(notice\)/);
    expect(overlay).toMatch(
      /sayEnded\(\{ by: "you" \}\);[^\n]*\n\s*linkRef\.current\?\.end\(\);/,
    );
    expect(overlay).toMatch(
      /sayEnded\(\{ by: "you" \}\);[^\n]*\n\s*setNotice\(\{ by: "you" \}\);/,
    );
    // the sender copies the flag onto the wire (it builds the face field by field)
    expect(overlay).toMatch(/notice: f\.notice,/);
    // and the face goes out at once, before paint (the link may close with the server's answer)
    expect(overlay).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(notice\) placeRef\.current\(\);\s*\}, \[notice\]\);/,
    );
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/notice: m\.notice,/);
    expect(stage).toMatch(
      /\{words\.dismiss && \([\s\S]{0,400}data-cy="demo-pill-ghost-dismiss"/,
    );
    const frame = stage.indexOf('data-cy="demo-frame"');
    const outline = stage.slice(stage.lastIndexOf("outline:", frame), frame);
    expect(outline).toMatch(/!ended && mirrored && off/);
  });
});
