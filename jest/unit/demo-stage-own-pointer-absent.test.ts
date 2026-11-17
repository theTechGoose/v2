/**
 * REQ-813 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm1 (run r83b6287b), issue m4: after a page load the customer and the stage
 * disagreed about the presenter's pointer. The customer had nothing (or a short "Alex is
 * pointing…" chip), while the stage drew his own "You" arrow at full strength under its own
 * "Your pointer isn't on Maria's screen" banner.
 *
 *   1. The stage's own marker (REQ-642's OwnPointer) now shows what the customer has: `ownLook`
 *      is "absent" while `pointerAbsent` holds (dimmed, hollow, tagged "not shown", data-absent)
 *      and "pending" while the stage's `pending` window (PENDING_MS, set when resendPointer sends
 *      `{k:"pending"}`) runs, the same "pointing…" look the customer's PeerPointer shows.
 *   2. When the stage's look by the print gives up (`seekGaveUp`: REANCHOR_CAP_MS passed with no
 *      match), it sends `{k:"leave"}`, so the customer's chip ends when the stage stops looking.
 *   3. The old spot is never re-sent on the new page (REQ-645 removed that on purpose).
 */
import * as fs from "fs";
import * as path from "path";
import type { Anchor } from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Held = {
  a: Anchor | null;
  load: string | null;
  at: Pt | null;
  provisional: boolean;
  print?: unknown;
};
type Shown = { load: string | null; styled?: boolean; alive?: boolean };

// looked up at run time: a missing export fails its own test, not the whole file
const pa = () =>
  require("../../shared/demo-mode/presenter-anchor") as {
    REANCHOR_CAP_MS: number;
    OWN_ABSENT_OPACITY: number;
    pointerAbsent(h: Held, alive: boolean): boolean;
    ownLook(absent: boolean, pending: boolean): "live" | "absent" | "pending";
    seekGaveUp(h: Held, shown: Shown, deadForMs: number): boolean;
  };

const node = { id: 7, x: 0.5, y: 0.5, l: "L1" };
const A: Anchor = { vx: 0.5, vy: 0.5, n: node };
const PRINT = { t: "button", cy: "send-quote" };
const held = (o: Partial<Held>): Held => ({
  a: null,
  load: null,
  at: null,
  provisional: false,
  ...o,
});

describe("REQ-813 (demo dm1 m4) ownLook: the stage's own marker says what the customer has", () => {
  test("a dead node anchor (her next page) is absent: the marker is dimmed, not live", () => {
    const h = held({ a: A, load: "L1", at: { x: 10, y: 20 } });
    const absent = pa().pointerAbsent(h, false);
    expect(absent).toBe(true);
    expect(pa().ownLook(absent, false)).toBe("absent");
  });
  test("his anchor drawn on her screen is live", () => {
    const h = held({ a: A, load: "L1", at: { x: 10, y: 20 } });
    expect(pa().ownLook(pa().pointerAbsent(h, true), false)).toBe("live");
  });
  test("while the stage's pending window runs: 'pointing…', over absent (her chip shows then)", () => {
    expect(pa().ownLook(true, true)).toBe("pending");
    expect(pa().ownLook(false, true)).toBe("pending");
  });
  test("the dim strength is well below full", () => {
    expect(pa().OWN_ABSENT_OPACITY).toBeGreaterThan(0);
    expect(pa().OWN_ABSENT_OPACITY).toBeLessThanOrEqual(0.5);
  });
});

describe("REQ-813 (demo dm1 m4) seekGaveUp: the look by the print stops at REANCHOR_CAP_MS", () => {
  const h = held({ a: A, load: "L1", at: { x: 1, y: 1 }, print: PRINT });
  const next: Shown = { load: "L2", styled: true, alive: false };
  test("within the cap it is still looking", () => {
    expect(pa().seekGaveUp(h, next, 0)).toBe(false);
    expect(pa().seekGaveUp(h, next, pa().REANCHOR_CAP_MS)).toBe(false);
  });
  test("past the cap on a styled replay with a printable print, it gave up", () => {
    expect(pa().seekGaveUp(h, next, pa().REANCHOR_CAP_MS + 1)).toBe(true);
  });
  test("an unstyled replay, no print, or a live anchor: it never looked, so it never gives up", () => {
    expect(pa().seekGaveUp(h, { ...next, styled: false }, 5_000)).toBe(false);
    expect(pa().seekGaveUp({ ...h, print: null }, next, 5_000)).toBe(false);
    expect(
      pa().seekGaveUp(h, { load: "L1", styled: true, alive: true }, 5_000),
    ).toBe(false);
  });
});

describe("REQ-813 (demo dm1 m4) wiring on the stage", () => {
  const src = () => read("front-end/islands/DemoStage.tsx");
  test("OwnPointer gets the look (absent / pending) and its words", () => {
    const s = src();
    const at = s.indexOf("<OwnPointer");
    expect(at).toBeGreaterThan(-1);
    const tag = s.slice(at, at + 600);
    expect(tag).toMatch(/look=\{ownLook\(absent,\s*pending\)\}/);
    // REQ-848 AMENDMENT (demo dm3 m4): no in-frame "not shown" pill — the chrome-row
    // demo-pointer-absent banner says it, so the stage no longer passes absentLabel
    expect(tag).not.toContain("absentLabel=");
    expect(tag).toContain('"demoMode.pointerOwnPending"');
  });
  test("resendPointer starts the stage's pending window when it sends {k:'pending'}", () => {
    const s = src();
    const at = s.indexOf("const resendPointer = () =>");
    const body = s.slice(at, s.indexOf("const seekAgain = () =>"));
    const sent = body.indexOf('k: "pending"');
    expect(sent).toBeGreaterThan(-1);
    expect(body.slice(sent)).toContain("startPending(");
  });
  test("seekAgain sends {k:'leave'} when the look gives up, and ends the pending window", () => {
    const s = src();
    const at = s.indexOf("const seekAgain = () =>");
    const body = s.slice(at, s.indexOf("const seekRef = useRef(seekAgain)"));
    const gave = body.indexOf("seekGaveUp(");
    expect(gave).toBeGreaterThan(-1);
    const after = body.slice(gave, gave + 500);
    expect(after).toContain('k: "leave"');
    expect(after).toContain("endPending(");
  });
  test("OwnPointer marks itself data-absent / data-pending", () => {
    const own = read("front-end/components/demo-mode/OwnPointer.tsx");
    expect(own).toContain("data-absent=");
    expect(own).toContain("data-pending=");
    expect(own).toContain("OWN_ABSENT_OPACITY");
  });
  test("the words are in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of ["demoMode.pointerOwnAbsent", "demoMode.pointerOwnPending"]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
