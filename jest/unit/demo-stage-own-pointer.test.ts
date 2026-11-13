/**
 * REQ-642 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issues m10 and setup-14d: the stage's marker for the
 * presenter's own pointer was wrong, missing, or covered the replica.
 *
 *   1. The ghost was a GUESS: the stage drew it where its own replay put his anchor
 *      (`presenterOnStage`), not where the customer's screen had it — pair 1 saw it "at the top
 *      edge while she saw the arrow at ~1125,485". Now the customer's overlay REPORTS where it
 *      placed each presenter's arrow (`{k:"placed", pid, a, p, o}`: the anchor it placed, the
 *      tip as a fraction of their viewport, outside), rate-limited per presenter
 *      (`placedReporter`), and the stage draws the ghost from that report (`reportedGhost`) —
 *      only for the anchor he holds now.
 *   2. His own pointer was often not drawn at all (the ghost only showed when apart), so pair 6
 *      took the customer's arrow for his own. The stage now always draws a small own-arrow marker
 *      (`demo-pointer-own`) at the anchor he sent, in his colour, tagged "You" — never the
 *      customer's orange or name.
 *   3. The "off" and "absent" badges sat on the frame's top edge, translated -50% up: half of the
 *      pill covered the mirrored app's header. They now sit in a chrome row ABOVE the frame
 *      (`stageBadgeTop`, `STAGE_TOP_INSET`), no vertical translate.
 *   4. The ghost's tag ("Your pointer on {name}'s screen") was long and placed with no element
 *      and no covers check: now "You", placed outside the anchored element and off other controls.
 */
import * as fs from "fs";
import * as path from "path";
import type { Anchor } from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Held = {
  a: Anchor | null;
  load: string | null;
  at: Pt | null;
  provisional: boolean;
};
type Placed = {
  k: "placed";
  pid: string;
  a: Anchor;
  p: { vx: number; vy: number } | null;
  o?: 1;
};

// looked up at run time: a missing export fails its own test, not the whole file
const pa = () =>
  require("../../shared/demo-mode/presenter-anchor") as {
    GHOST_GAP_PX: number;
    PLACED_GAP_MS: number;
    placedReport(
      pid: string,
      a: Anchor,
      placed: { at: Pt; outside: boolean } | null,
      view: Box,
    ): Placed;
    reportedGhost(
      h: Held,
      r: Placed | null,
      frame: Box,
    ): { at: Pt; outside: boolean } | null;
    ownAt(h: Held): Pt | null;
    placedReporter(o: {
      send(m: Placed): void;
      gap?: number;
      now?: () => number;
      setTimer?: (fn: () => void, ms: number) => unknown;
      clearTimer?: (h: unknown) => void;
    }): { report(m: Placed): void; forget(pid: string): void; cancel(): void };
  };
const proto = () =>
  require("../../shared/demo-mode/protocol") as {
    parsePeerMessage(x: unknown): unknown;
    parseClientMessage(raw: string): unknown;
    fitScale(
      stage: { w: number; h: number },
      view: { w: number; h: number },
      inset: { top: number; right: number; bottom: number; left: number },
    ): Box & { s: number };
  };
const chrome = () =>
  require("../../shared/demo-mode/stage-chrome") as {
    STAGE_TOP_INSET: number;
    STAGE_BADGE_H: number;
    STAGE_BADGE_GAP: number;
    stageBadgeTop(frameTop: number): number;
  };

const node = { id: 7, x: 0.5, y: 0.5, l: "L1" };
const A: Anchor = { vx: 0.5, vy: 0.5, n: node };
const B: Anchor = { vx: 0.2, vy: 0.2, n: { ...node, id: 9 } };
const VIEW: Box = { left: 0, top: 0, width: 400, height: 800 };
// the frame on the stage: their 400 × 800 at scale 0.75
const FRAME: Box = { left: 500, top: 42, width: 300, height: 600 };
const held = (o: Partial<Held>): Held => ({
  a: null,
  load: null,
  at: null,
  provisional: false,
  ...o,
});

describe("REQ-642 (demo m10, cycle 5) the wire: the customer's report of where it placed a presenter's arrow", () => {
  test("a placed report parses — the anchor it placed, the tip as a viewport fraction, outside", () => {
    expect(
      proto().parsePeerMessage({
        k: "placed",
        pid: "u1",
        a: A,
        p: { vx: 0.25, vy: 0.5 },
        o: 1,
      }),
    ).toEqual({ k: "placed", pid: "u1", a: A, p: { vx: 0.25, vy: 0.5 }, o: 1 });
    expect(
      proto().parsePeerMessage({ k: "placed", pid: "u1", a: A, p: null }),
    ).toEqual({ k: "placed", pid: "u1", a: A, p: null });
  });
  test("junk is dropped: no pid, no anchor, a bad point; fractions are clamped", () => {
    const P = proto();
    expect(P.parsePeerMessage({ k: "placed", a: A, p: null })).toBeNull();
    expect(P.parsePeerMessage({ k: "placed", pid: "", a: A, p: null }))
      .toBeNull();
    expect(P.parsePeerMessage({ k: "placed", pid: "u1", p: null })).toBeNull();
    expect(
      P.parsePeerMessage({ k: "placed", pid: "u1", a: A, p: { vx: "x" } }),
    ).toBeNull();
    expect(
      P.parsePeerMessage({
        k: "placed",
        pid: "u1",
        a: A,
        p: { vx: 1.4, vy: -2 },
      }),
    ).toEqual({ k: "placed", pid: "u1", a: A, p: { vx: 1, vy: 0 } });
  });
  test("the server's gate lets the customer's relay of it through", () => {
    expect(
      proto().parseClientMessage(
        JSON.stringify({
          t: "relay",
          data: { k: "placed", pid: "u1", a: A, p: { vx: 0.1, vy: 0.2 } },
        }),
      ),
    ).toEqual({
      t: "relay",
      data: { k: "placed", pid: "u1", a: A, p: { vx: 0.1, vy: 0.2 } },
    });
  });
  test("placedReport: the arrow's tip on their screen as a fraction of their viewport; nowhere is null", () => {
    expect(
      pa().placedReport(
        "u1",
        A,
        { at: { x: 100, y: 600 }, outside: false },
        VIEW,
      ),
    ).toEqual({ k: "placed", pid: "u1", a: A, p: { vx: 0.25, vy: 0.75 } });
    expect(
      pa().placedReport("u1", A, { at: { x: 376, y: 0 }, outside: true }, VIEW),
    ).toEqual({ k: "placed", pid: "u1", a: A, p: { vx: 0.94, vy: 0 }, o: 1 });
    expect(pa().placedReport("u1", A, null, VIEW)).toEqual({
      k: "placed",
      pid: "u1",
      a: A,
      p: null,
    });
  });
});

describe("REQ-642 (demo m10) placedReporter: rate-limited per presenter, the last one always goes out, repeats never", () => {
  const rig = () => {
    let t = 1000;
    const timers: { fn: () => void; at: number }[] = [];
    const sent: Placed[] = [];
    const r = pa().placedReporter({
      send: (m) => sent.push(m),
      gap: 100,
      now: () => t,
      setTimer: (fn, ms) => {
        const h = { fn, at: t + ms };
        timers.push(h);
        return h;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as never);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const tick = (ms: number) => {
      t += ms;
      for (const h of [...timers]) {
        if (h.at <= t) {
          timers.splice(timers.indexOf(h), 1);
          h.fn();
        }
      }
    };
    return { r, sent, tick };
  };
  const rep = (pid: string, vx: number, a = A): Placed => ({
    k: "placed",
    pid,
    a,
    p: { vx, vy: 0.5 },
  });

  test("the first goes at once; a burst within the gap sends only its last, after the gap", () => {
    const { r, sent, tick } = rig();
    r.report(rep("u1", 0.1));
    expect(sent.map((m) => m.p?.vx)).toEqual([0.1]);
    r.report(rep("u1", 0.2));
    r.report(rep("u1", 0.3));
    expect(sent).toHaveLength(1);
    tick(100);
    expect(sent.map((m) => m.p?.vx)).toEqual([0.1, 0.3]);
  });
  test("the same report again is not sent; each presenter has his own rate", () => {
    const { r, sent, tick } = rig();
    r.report(rep("u1", 0.1));
    tick(500);
    r.report(rep("u1", 0.1));
    expect(sent).toHaveLength(1);
    r.report(rep("u2", 0.1));
    expect(sent.map((m) => m.pid)).toEqual(["u1", "u2"]);
  });
  test("a presenter forgotten (he left) is reported afresh", () => {
    const { r, sent, tick } = rig();
    r.report(rep("u1", 0.1));
    tick(500);
    r.forget("u1");
    r.report(rep("u1", 0.1));
    expect(sent).toHaveLength(2);
  });
});

describe("REQ-642 (demo m10) reportedGhost: the stage draws his arrow where the customer's screen REPORTED it", () => {
  const h = held({ a: A, load: "L1", at: { x: 650, y: 342 } });
  test("a report for the anchor he holds, apart from his cursor: drawn at that fraction of the frame", () => {
    const g = pa().reportedGhost(
      h,
      { k: "placed", pid: "u1", a: A, p: { vx: 0.5, vy: 0.75 } },
      FRAME,
    );
    expect(g).toEqual({ at: { x: 650, y: 492 }, outside: false });
  });
  test("an outside report sits inside the frame, on its edge, marked outside", () => {
    const g = pa().reportedGhost(
      h,
      { k: "placed", pid: "u1", a: A, p: { vx: 1, vy: 0 }, o: 1 },
      FRAME,
    )!;
    expect(g.outside).toBe(true);
    expect(g.at.x).toBeLessThanOrEqual(FRAME.left + FRAME.width - 24);
    expect(g.at.y).toBeGreaterThanOrEqual(FRAME.top);
  });
  test("a stale report (another anchor than the one he holds), a report of nowhere, none: no ghost", () => {
    expect(
      pa().reportedGhost(
        h,
        { k: "placed", pid: "u1", a: B, p: { vx: 0.1, vy: 0.1 } },
        FRAME,
      ),
    ).toBeNull();
    expect(
      pa().reportedGhost(h, { k: "placed", pid: "u1", a: A, p: null }, FRAME),
    ).toBeNull();
    expect(pa().reportedGhost(h, null, FRAME)).toBeNull();
    expect(
      pa().reportedGhost(
        held({}),
        { k: "placed", pid: "u1", a: A, p: { vx: 0.5, vy: 0.75 } },
        FRAME,
      ),
    ).toBeNull();
  });
  test("where he put it (within GHOST_GAP_PX): no ghost — the own marker is there", () => {
    expect(
      pa().reportedGhost(
        h,
        { k: "placed", pid: "u1", a: A, p: { vx: 0.5, vy: 0.5 } },
        FRAME,
      ),
    ).toBeNull();
  });
  test("ownAt: the own marker is drawn at the anchor he sent, whenever he holds one", () => {
    expect(pa().ownAt(h)).toEqual({ x: 650, y: 342 });
    expect(pa().ownAt(held({ at: { x: 1, y: 2 } }))).toBeNull();
  });
});

describe("REQ-642 (demo m10) the off / absent badges sit ABOVE the frame, never over the replica", () => {
  test("the stage's top inset leaves a chrome row; the badge's box ends a gap above the frame", () => {
    const C = chrome();
    expect(C.STAGE_TOP_INSET).toBeGreaterThanOrEqual(
      C.STAGE_BADGE_H + 2 * C.STAGE_BADGE_GAP,
    );
    for (
      const [stage, view] of [
        [{ w: 1440, h: 900 }, { w: 390, h: 844 }],
        [{ w: 1440, h: 900 }, { w: 1280, h: 720 }],
        [{ w: 1024, h: 700 }, { w: 1920, h: 1080 }],
      ]
    ) {
      const f = proto().fitScale(stage, view, {
        top: C.STAGE_TOP_INSET,
        right: 16,
        bottom: 70,
        left: 16,
      });
      const top = C.stageBadgeTop(f.top);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + C.STAGE_BADGE_H).toBeLessThanOrEqual(f.top);
    }
  });
  test("DemoStage: the stage is inset by STAGE_TOP_INSET; both badges use stageBadgeTop with no -50% vertical translate", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(/top:\s*STAGE_TOP_INSET/);
    for (const cy of ["demo-pointer-off", "demo-pointer-absent"]) {
      const at = src.indexOf(`data-cy="${cy}"`);
      expect(at).toBeGreaterThan(-1);
      const style = src.slice(at, at + 700);
      expect(style).toContain("stageBadgeTop(");
      expect(style).not.toContain("translate(-50%,-50%)");
    }
  });
});

describe("REQ-642 (demo m10 + setup-14d) wiring: report, ghost from the report, own marker, short tag", () => {
  test("the customer's overlay reports every placing of a presenter's arrow (and its removal), rate-limited", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toContain("placedReporter(");
    const at = src.indexOf("const place = (pid: string, a: Anchor");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1400);
    expect(body).toContain("placedReport(");
    expect(body.match(/reporter\.report\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });
  test("the stage takes the report for its own pid and draws the ghost from it — not from its replay", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(/case "placed":/);
    const at = src.indexOf("const showGhost = () =>");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 700);
    expect(body).toContain("reportedGhost(");
    expect(body).not.toContain("presenterOnStage(");
  });
  test("the stage always draws his own marker, in his colour, never the customer's", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toContain("<OwnPointer");
    const own = read("front-end/components/demo-mode/OwnPointer.tsx");
    expect(own).toContain('data-cy="demo-pointer-own"');
    expect(own).not.toContain("CUSTOMER_COLOR");
  });
  test("the ghost's tag is placed outside its element and off other controls", () => {
    const src = read("front-end/components/demo-mode/PointerGhost.tsx");
    expect(src).not.toMatch(/tagPlacement\([\s\S]{0,120}null,\s*\)/);
    expect(src).toContain("coversControl(");
  });
  test("the own pointer's tag says 'You' (short), en and es in sync", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["demoMode.pointerGhost"]).toBe("You");
    expect(es["demoMode.pointerGhost"]).toBe("Tú");
  });
});
