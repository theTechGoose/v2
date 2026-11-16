/**
 * REQ-828 — demo-loop cycle dm2, issue p7 (amends REQ-822 / REQ-636): after "Seguir" (Keep going)
 * the stage's ghost showed the whole pill at once (the question going down is overlay state,
 * REQ-822) but then held the customer's re-fold to the tab for a mirror frame (REQ-636) — on a
 * still page up to the next frame, while the customer already showed "Demo | ×".
 *
 * The fix: a face whose only change from the shown face is the tuck shows at once too, when the
 * shown face was itself shown at once and no mirror frame sent after it has been replayed since
 * (`PillSync.atOnce()`): folding back is part of the same overlay gesture, the mirrored page does
 * not change with it. A tuck after a frame still waits for its own frame (REQ-636).
 */
import * as fs from "fs";
import * as path from "path";
import { pillShowsAtOnce } from "../../shared/demo-mode/pill.ts";
import { createPillSync } from "../../shared/demo-mode/pill-sync.ts";
import type { PillFace } from "../../shared/demo-mode/protocol.ts";

const live: PillFace = {
  status: "live",
  label: "Conectado",
  text: "Alex te guía",
  title: "Modo demo",
  end: "Terminar demo",
  tucked: false,
};
const asking: PillFace = {
  ...live,
  asking: true,
  ask: "¿Terminar la demo con Alex?",
  yes: "Sí, terminar",
  no: "Seguir",
};

/** what the stage does with one pill message (DemoStage's `case "pill"`) */
function stage() {
  let now = 0;
  const pills = createPillSync<PillFace>({ now: () => now });
  let shown: PillFace = {};
  return {
    pills,
    tick: (ms: number) => (now = ms),
    get shown() {
      return shown;
    },
    offer(face: PillFace, t: number) {
      const p = pills.offer(
        face,
        t,
        pillShowsAtOnce(shown, face, false, pills.atOnce()),
      );
      if (p) shown = p;
      return p;
    },
    frame(sent: number) {
      const p = pills.frame(sent);
      if (p) shown = p;
      return p;
    },
  };
}

describe("REQ-828 (demo-loop cycle dm2, p7) — Keep going, then the fold, both show at once", () => {
  test("asking → question down → tucked, no frame in between: the tuck shows at once", () => {
    const s = stage();
    // the peeked whole pill on the stage, with its frame
    s.frame(1_000);
    expect(s.offer(live, 1_000)).toEqual(live);
    // End asks: overlay state, at once (REQ-822)
    expect(s.offer(asking, 2_000)).toEqual(asking);
    // "Seguir": the question goes down, the peek still open — at once (REQ-822)
    const whole: PillFace = { ...live };
    expect(s.offer(whole, 3_000)).toEqual(whole);
    // the peek ends, the pill folds back to its tab: no frame came (a still page)
    const folded: PillFace = { ...live, tucked: true };
    expect(s.offer(folded, 3_400)).toEqual(folded);
    expect(s.shown.tucked).toBe(true);
  });

  test("a frame from before the question went down does not break the chain", () => {
    const s = stage();
    s.frame(1_000);
    s.offer(live, 1_000);
    s.offer(asking, 2_000);
    s.offer({ ...live }, 3_000);
    s.frame(2_500); // trailing frame, sent before Keep going
    expect(s.offer({ ...live, tucked: true }, 3_400)).toEqual({
      ...live,
      tucked: true,
    });
  });

  test("REQ-636 still holds: a tuck after a frame sent since waits for its own frame", () => {
    const s = stage();
    s.frame(1_000);
    s.offer(live, 1_000);
    s.offer(asking, 2_000);
    s.offer({ ...live }, 3_000);
    s.frame(3_100); // the page moved on after Keep going
    const folded: PillFace = { ...live, tucked: true };
    expect(s.offer(folded, 5_000)).toBeNull();
    expect(s.frame(5_000)).toEqual(folded);
  });

  test("REQ-636 still holds: a tuck after a face shown with its frame waits", () => {
    const s = stage();
    s.frame(1_000);
    s.offer(live, 1_000);
    expect(s.pills.atOnce()).toBe(false);
    expect(s.offer({ ...live, tucked: true }, 2_000)).toBeNull();
  });

  test("only the tuck rides the chain: new words after an at-once face still wait", () => {
    const s = stage();
    s.frame(1_000);
    s.offer(live, 1_000);
    s.offer(asking, 2_000);
    s.offer({ ...live }, 3_000);
    expect(
      s.offer({ ...live, tucked: true, text: "Sam se unió" }, 3_400),
    ).toBeNull();
    // and an unchanged face (only its rect moved) is not hurried either
    expect(pillShowsAtOnce(live, { ...live }, false, true)).toBe(false);
  });

  test("a follow switch ends the chain", () => {
    const s = stage();
    s.frame(1_000);
    s.offer(live, 1_000);
    s.offer(asking, 2_000);
    s.pills.reset();
    expect(s.pills.atOnce()).toBe(false);
  });

  test("the stage passes the chain to pillShowsAtOnce", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../front-end/islands/DemoStage.tsx"),
      "utf8",
    );
    const s = src.slice(src.indexOf('case "pill":'));
    expect(s.slice(0, s.indexOf("break;"))).toMatch(
      /pillShowsAtOnce\(\s*shownFace,\s*faceOf\(m\),\s*awaiting,\s*pills\.atOnce\(\),?\s*\)/,
    );
  });
});
