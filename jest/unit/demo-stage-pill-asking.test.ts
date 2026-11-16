/**
 * REQ-822 — demo-loop cycle dm1, issue m1: the stage's copy of the customer's pill did not show
 * the pill's state. While the customer's pill asked "End the demo with Alex? Yes, end it / Keep
 * going", the stage's ghost (demo-pill-ghost) still read "Demo mode · Alex is guiding you ·
 * Connected · End demo …" — only the "…" hinted something was open — and the presenter never
 * learned the customer was about to end the demo. On a second demo the ghost showed the whole
 * pill while the customer had the folded mini-pill.
 *
 * Cause (RCA at cbcae62d): `PillFace` had no field for "End is asking" (the overlay's `asking`
 * state never reached faceRef / sendPill), so `ghostWords` always drew the End chip; and a face
 * change rode the REQ-636 hold — the stage's awaiting guess (untucked, "Connecting…") stayed up
 * while the new page's real (folded) pill waited for its frame.
 *
 * The fix: the face carries `asking` and the question with both answers in the customer's words
 * (`ask`, `yes`, `no`); the ghost draws the question with two disabled chips in End's place, and
 * the stage's own pill says "{name} is deciding whether to end the demo". A face whose only
 * change is overlay state (the question) — or the first face after a follow switch, which
 * replaces the stage's own guess — shows at once (`pillShowsAtOnce`); a tuck alone still waits for
 * its frame (REQ-636).
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostWords,
  pillFaceAwaiting,
  pillShowsAtOnce,
} from "../../shared/demo-mode/pill.ts";
import { createPillSync } from "../../shared/demo-mode/pill-sync.ts";
import {
  parsePeerMessage,
  PILL_LABEL_MAX,
  PILL_TEXT_MAX,
  type PillFace,
} from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const t = (k: string) => `en:${k}`;
/** the slice of `src` from `from` up to `to` */
const between = (src: string, from: string, to: string) => {
  const s = src.slice(src.indexOf(from));
  return s.slice(0, s.indexOf(to));
};

const live: PillFace = {
  status: "live",
  label: "Connected",
  text: "Alex is guiding you",
  title: "Demo mode",
  end: "End demo",
};

describe("REQ-822 (demo-loop cycle dm1, m1) — the pill face says End is asking", () => {
  const r = { left: 10, top: 700, width: 420, height: 44 };

  test("asking and the question with both answers ride the wire", () => {
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        status: "live",
        asking: true,
        ask: "End the demo with Alex?",
        yes: "Yes, end it",
        no: "Keep going",
      }),
    ).toEqual({
      k: "pill",
      r,
      status: "live",
      asking: true,
      ask: "End the demo with Alex?",
      yes: "Yes, end it",
      no: "Keep going",
    });
  });

  test("junk is dropped and long words are cut", () => {
    const m = parsePeerMessage({
      k: "pill",
      r,
      asking: "yes",
      ask: "x".repeat(500),
      yes: 1,
      no: "n".repeat(500),
    }) as PillFace;
    expect(m.asking).toBeUndefined();
    expect(m.yes).toBeUndefined();
    expect(m.ask).toHaveLength(PILL_TEXT_MAX);
    expect(m.no).toHaveLength(PILL_LABEL_MAX);
  });
});

describe("REQ-822 (demo-loop cycle dm1, m1) — the ghost draws the question", () => {
  test("asking: the question and both answers in End's place, in the customer's words", () => {
    const w = ghostWords(
      {
        ...live,
        asking: true,
        ask: "¿Terminar la demo con Alex?",
        yes: "Sí, terminar",
        no: "Seguir",
      },
      t,
    );
    expect(w.end).toBeUndefined();
    expect(w.ask).toBe("¿Terminar la demo con Alex?");
    expect(w.yes).toBe("Sí, terminar");
    expect(w.no).toBe("Seguir");
    // the rest of the pill is still there, as on the customer's screen
    expect(w.title).toBe("Demo mode");
    expect(w.status).toBe("Connected");
  });

  test("asking without the words (an older page): the stage words it", () => {
    const w = ghostWords({ ...live, asking: true }, t);
    expect(w.end).toBeUndefined();
    expect(w.ask).toBe("en:demoMode.pillGhostAsking");
    expect(w.yes).toBe("en:demoMode.endYes");
    expect(w.no).toBe("en:demoMode.endNo");
  });

  test("not asking: End, no question; an ended demo asks nothing", () => {
    const w = ghostWords(live, t);
    expect(w.end).toBe("End demo");
    expect(w.ask).toBeUndefined();
    const ended = ghostWords({ status: "ended", asking: true }, t);
    expect(ended.ask).toBeUndefined();
    expect(ended.end).toBeUndefined();
  });

  test("a new page is not asking (its pill decides)", () => {
    const w = pillFaceAwaiting({
      ...live,
      asking: true,
      ask: "End the demo with Alex?",
      yes: "Yes, end it",
      no: "Keep going",
    });
    expect(w.asking).toBeUndefined();
    expect(w.ask).toBeUndefined();
  });
});

describe("REQ-822 (demo-loop cycle dm1, m1) — overlay state is not held for a frame", () => {
  test("the question going up or down shows at once", () => {
    expect(pillShowsAtOnce(live, { ...live, asking: true }, false)).toBe(true);
    expect(pillShowsAtOnce({ ...live, asking: true }, live, false)).toBe(true);
    // the question widened the pill past the window (clipped) — still overlay state
    expect(
      pillShowsAtOnce(live, { ...live, asking: true, clipped: true }, false),
    ).toBe(true);
  });

  test("REQ-636 still holds: a tuck, or new words, wait for their frame", () => {
    expect(pillShowsAtOnce(live, { ...live, tucked: true }, false)).toBe(false);
    expect(pillShowsAtOnce(live, { ...live, text: "Sam joined" }, false)).toBe(
      false,
    );
    expect(pillShowsAtOnce(live, { ...live, asking: true, open: true }, false))
      .toBe(false);
  });

  test("the second demo: after a follow switch, the new page's folded pill replaces the stage's guess at once", () => {
    let now = 0;
    const pills = createPillSync<PillFace>({ now: () => now });
    // the first page: whole pill, shown with its frame
    pills.frame(1_000);
    let shown: PillFace = pills.offer(live, 1_000)!;
    expect(shown.tucked).toBeUndefined();
    // the stage follows the customer's new page: its guess (as the old page was — whole here —
    // Connecting…; REQ-854 keeps a folded page's fold), nothing held
    shown = pillFaceAwaiting(shown);
    pills.reset();
    // the new page's pill: folded to its mini-pill — before its frame has been replayed
    const folded: PillFace = { ...live, tucked: true };
    now = 200;
    const at = pills.offer(folded, 5_000, pillShowsAtOnce(shown, folded, true));
    expect(at).toEqual(folded); // the stage shows the mini-pill too, not the whole pill
    // a later tuck change on that page waits for its frame again (REQ-636)
    const whole: PillFace = { ...live, tucked: false };
    expect(
      pills.offer(whole, 6_000, pillShowsAtOnce(folded, whole, false)),
    ).toBeNull();
    expect(pills.frame(6_000)).toEqual(whole);
  });

  test("an instant pill supersedes what was held", () => {
    const pills = createPillSync<string>({ now: () => 0 });
    pills.frame(0);
    expect(pills.offer("tuck", 5_000)).toBeNull();
    expect(pills.offer("ask", 5_100, true)).toBe("ask");
    expect(pills.frame(6_000)).toBeNull();
  });
});

describe("REQ-822 (demo-loop cycle dm1, m1) — the islands are wired", () => {
  const o = read("front-end/islands/DemoModeOverlay.tsx");
  const s = read("front-end/islands/DemoStage.tsx");

  test("the customer's face carries asking and the question in its own words", () => {
    const face = between(o, "faceRef.current = {\n    compact,", "};");
    expect(face).toMatch(/\basking\b/);
    expect(face).toMatch(/endDemoWords\(/);
    const send = between(
      o,
      "const sendPill = () => {",
      "sendPillRef.current = sendPill;",
    );
    expect(send).toMatch(/asking: f\.asking/);
    expect(send).toMatch(/ask: f\.ask/);
    expect(send).toMatch(/yes: f\.yes/);
    expect(send).toMatch(/no: f\.no/);
  });

  test("place() still tells the stage while the question is up", () => {
    const place = between(o, "const place = () => {", "setCompact(narrow());");
    expect(place).toMatch(
      // REQ-835 (dm2, M2) — after keeping the asking pill inside the window
      /querySelector\('\[data-cy="demo-end-ask"\]'\)\) \{\s*(clampAsk\(\);\s*)?sendPill\(\);\s*return;/,
    );
  });

  test("the stage copies the question, draws it, says it on its pill, and does not hold it", () => {
    const show = between(s, "const faceOf = (m: PillMsg)", "const showPill");
    for (const k of ["asking", "ask", "yes", "no"]) {
      expect(show).toMatch(new RegExp(`\\b${k}: m\\.${k}\\b`));
    }
    expect(s).toMatch(/data-cy="demo-pill-ghost-ask"/);
    expect(s).toMatch(/data-cy="demo-pill-ghost-yes"/);
    expect(s).toMatch(/data-cy="demo-pill-ghost-no"/);
    expect(s).toMatch(/data-cy="demo-customer-asking-end"/);
    const pill = between(s, 'case "pill":', "break;");
    expect(pill).toMatch(/pillShowsAtOnce\(/);
  });

  test("every new word is in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of ["demoMode.pillGhostAsking", "demoMode.customerAskingEnd"]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["demoMode.customerAskingEnd"]).toMatch(/\{name\}/);
    expect(es["demoMode.customerAskingEnd"]).toMatch(/\{name\}/);
  });
});
