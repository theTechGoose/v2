/**
 * REQ-451 — demo issues M1 and M14 (demo-loop cycle 3): the presenter's pointer is WHAT HE POINTED
 * AT. Amends REQ-393, which made it "the spot under his still mouse", looked up again after every
 * layout pass of the replay: the customer's arrow then stayed at one screen spot over whatever
 * scrolled or loaded under it (option 2's ✕ after a page change, empty background on /worker),
 * and with his mouse beside a phone frame the full arrow and name tag sat on the phone's edge,
 * over its controls — from the very start, where the cursor handed over from /admin was beside it.
 *
 *   - pure (shared/demo-mode/presenter-anchor.ts): where an anchor is drawn (`anchorPoint`,
 *     `pointInBox`) — on its node only, never at the old fraction; what is sent again to a page that
 *     joined (`resendable`); when a layout pass may look the resting pointer up again (`lookAgain`
 *     — a fraction made before the replay was SETTLED: its fonts and images in, not only its
 *     stylesheets; and his mouse beside the frame, whose meeting point moves with the frame);
 *     the opening page's mouse counted on the frame only (`seedOn`); the stage's ghost of the arrow
 *     as their screen has it (`ghostAt`); the small marker for a pointer off their screen
 *     (`offEdge`, `offMark`);
 *   - wiring: the stage, the customer's overlay, PeerPointer, DemoPointer and the ghost.
 */
import * as fs from "fs";
import * as path from "path";
import type { Anchor, NodeAnchor } from "../../shared/demo-mode/protocol";

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

// looked up at run time: a missing module or export fails its own tests, not the whole file
const pa = () =>
  require("../../shared/demo-mode/presenter-anchor") as {
    pointInBox(n: { x: number; y: number }, r: Box | null): Pt | null;
    anchorPoint(
      a: Anchor,
      view: Box,
      load: string | null,
      pointOfNode: (n: NodeAnchor) => Pt | null,
    ): Pt | null;
    resendable(h: Held, load: string | null): Anchor | null;
    lookAgain(
      h: Held,
      shown: { load: string | null; settled: boolean },
    ): boolean;
    seedOn(seed: Pt | null, frame: Box): Pt | null;
    GHOST_GAP_PX: number;
    GHOST_OPACITY: number;
    ghostAt(
      h: Held,
      shownLoad: string | null,
      placed: { at: Pt; outside: boolean } | null,
    ): { at: Pt; outside: boolean } | null;
    offEdge(at: Pt, box: Box): { dx: number; dy: number };
    OFF_MARK_PX: number;
    OFF_MARK_OPACITY: number;
    offMark(at: Pt, box: Box): { left: number; top: number; deg: number };
  };

const VIEW: Box = { left: 0, top: 0, width: 400, height: 800 };
const node = (id: number, l?: string, x = 0.5, y = 0.5): NodeAnchor =>
  l === undefined ? { id, x, y } : { id, x, y, l };
const held = (o: Partial<Held>): Held => ({
  a: null,
  load: null,
  at: null,
  provisional: false,
  ...o,
});

describe("REQ-451 anchorPoint: a presenter's anchor is drawn on the element he pointed at, or nowhere — never at its old fraction (M1)", () => {
  // the element's box on this screen now (its page scrolled it 250 px up since he pointed at it)
  const boxes = new Map<number, Box>([[7, {
    left: 100,
    top: 170,
    width: 200,
    height: 40,
  }]]);
  const pointOfNode = (n: NodeAnchor) =>
    pa().pointInBox(n, boxes.get(n.id) ?? null);

  test("a node of the page load shown: on that node, where in its box he pointed — wherever the page moved it", () => {
    const a: Anchor = { vx: 0.5, vy: 0.525, n: node(7, "L1", 0.25, 0.5) };
    expect(pa().anchorPoint(a, VIEW, "L1", pointOfNode)).toEqual({
      x: 150,
      y: 190,
    });
  });

  test("a node of another page load (the customer's page changed, another tab), or one naming no load: nowhere — the old fraction is over something else now", () => {
    const a: Anchor = { vx: 0.5, vy: 0.525, n: node(7, "L1") };
    expect(pa().anchorPoint(a, VIEW, "L2", pointOfNode)).toBeNull();
    expect(pa().anchorPoint(a, VIEW, null, pointOfNode)).toBeNull();
    const noLoad: Anchor = { vx: 0.5, vy: 0.525, n: node(7) };
    expect(pa().anchorPoint(noLoad, VIEW, "L1", pointOfNode)).toBeNull();
  });

  test("the element left the page, or is not laid out (a closed menu): nowhere", () => {
    const gone: Anchor = { vx: 0.1, vy: 0.1, n: node(99, "L1") };
    expect(pa().anchorPoint(gone, VIEW, "L1", pointOfNode)).toBeNull();
    expect(pa().pointInBox({ x: 0.5, y: 0.5 }, null)).toBeNull();
    expect(
      pa().pointInBox({ x: 0.5, y: 0.5 }, {
        left: 10,
        top: 10,
        width: 0,
        height: 20,
      }),
    ).toBeNull();
    expect(
      pa().pointInBox({ x: 0.5, y: 0.5 }, {
        left: 10,
        top: 10,
        width: 20,
        height: 0,
      }),
    ).toBeNull();
  });

  test("an anchor naming no element is a fraction of the view; one off the screen (o: 1) is its edge's point", () => {
    expect(pa().anchorPoint({ vx: 0.25, vy: 0.5 }, VIEW, "L1", pointOfNode))
      .toEqual({ x: 100, y: 400 });
    expect(
      pa().anchorPoint({ vx: 1, vy: 0.4, o: 1 }, VIEW, null, pointOfNode),
    ).toEqual({ x: 400, y: 320 });
  });
});

describe("REQ-451 resendable: a page that joins (or is mirrored afresh) is sent his anchor only when it was made on that very page load — or when it is his mouse beside the frame", () => {
  const a: Anchor = { vx: 0.5, vy: 0.5, n: node(7, "L1") };
  const off: Anchor = { vx: 0, vy: 0.4, o: 1 };

  test("the same page load (a tab followed again, its page unchanged; the stage's socket back): the anchor again", () => {
    expect(pa().resendable(held({ a, load: "L1" }), "L1")).toBe(a);
    expect(pa().resendable(held({ a: off, load: "L1" }), "L1")).toBe(off);
  });

  test("a new page, another tab, a reload: nothing until he moves — never the fraction under his still mouse", () => {
    expect(pa().resendable(held({ a, load: "L1" }), "L2")).toBeNull();
    const frac: Anchor = { vx: 0.12, vy: 0.25 };
    expect(pa().resendable(held({ a: frac, load: "L1" }), "L2")).toBeNull();
    expect(pa().resendable(held({ a, load: "L1" }), null)).toBeNull();
    expect(pa().resendable(held({ a: frac, load: null }), null)).toBeNull();
    expect(pa().resendable(held({}), "L1")).toBeNull();
  });

  test("M8/M14: his mouse beside the frame names no element of any page — a new page gets the small marker on its edge at once (never gone while his mouse is beside the frame)", () => {
    expect(pa().resendable(held({ a: off, load: "L1" }), "L2")).toBe(off);
    expect(pa().resendable(held({ a: off, load: null }), "L2")).toBe(off);
    expect(pa().resendable(held({ a: off, load: "L1" }), null)).toBeNull();
  });
});

describe("REQ-451 lookAgain: his still mouse is looked up again only for a fraction made before the replay could name a node there (until it SETTLED: stylesheets, fonts and images in), and while it is beside the frame", () => {
  test("a node anchor stays on its node however the page moves under his still mouse (their scroll, a change, a settle, the stage resized)", () => {
    const a: Anchor = { vx: 0.5, vy: 0.5, n: node(7, "L1") };
    expect(
      pa().lookAgain(held({ a, load: "L1" }), { load: "L1", settled: true }),
    ).toBe(false);
    expect(
      pa().lookAgain(held({ a, load: "L1" }), { load: "L1", settled: false }),
    ).toBe(false);
  });

  test("a fraction made while the replay was not settled is looked up once the same page has settled — never on another page, never before", () => {
    const h = held({ a: { vx: 0.5, vy: 0.5 }, load: "L1", provisional: true });
    expect(pa().lookAgain(h, { load: "L1", settled: true })).toBe(true);
    expect(pa().lookAgain(h, { load: "L1", settled: false })).toBe(false);
    expect(pa().lookAgain(h, { load: "L2", settled: true })).toBe(false);
    expect(
      pa().lookAgain(held({ ...h, load: null }), {
        load: "L1",
        settled: true,
      }),
    ).toBe(false);
  });

  test("M8/M14: his mouse beside the frame is looked up on every layout pass — where it meets the frame's edge moves when the frame does (the banner, the pill), on any page, settled or not", () => {
    const off = held({ a: { vx: 0, vy: 0.5, o: 1 }, load: "L1" });
    expect(pa().lookAgain(off, { load: "L1", settled: true })).toBe(true);
    expect(pa().lookAgain(off, { load: "L1", settled: false })).toBe(true);
    expect(pa().lookAgain(off, { load: "L2", settled: true })).toBe(true);
    expect(pa().lookAgain(held({}), { load: "L1", settled: true })).toBe(false);
  });
});

describe("REQ-451 seedOn: the mouse handed over by the page that opened the stage counts only on the frame (M14)", () => {
  // a phone frame in the middle of a 1280 px stage
  const frame: Box = { left: 472, top: 16, width: 337, height: 729 };
  test("on the frame (its edges included): where he points from the start", () => {
    expect(pa().seedOn({ x: 640, y: 400 }, frame)).toEqual({ x: 640, y: 400 });
    expect(pa().seedOn({ x: 472, y: 16 }, frame)).toEqual({ x: 472, y: 16 });
  });
  test("beside it (the Demo button at the right of /admin's row), above or below it, or nothing handed over: nothing — unknown until he moves", () => {
    expect(pa().seedOn({ x: 1024, y: 479 }, frame)).toBeNull();
    expect(pa().seedOn({ x: 100, y: 400 }, frame)).toBeNull();
    expect(pa().seedOn({ x: 640, y: 5 }, frame)).toBeNull();
    expect(pa().seedOn({ x: 640, y: 800 }, frame)).toBeNull();
    expect(pa().seedOn(null, frame)).toBeNull();
  });
});

describe("REQ-451 ghostAt: the stage draws his arrow as their screen has it, faint, when it is apart from where he put it", () => {
  const a: Anchor = { vx: 0.5, vy: 0.5, n: node(7, "L1") };
  const at = { x: 640, y: 420 };
  test("where he put it (under his own cursor): not drawn", () => {
    expect(pa().GHOST_GAP_PX).toBeGreaterThan(0);
    expect(
      pa().ghostAt(held({ a, load: "L1", at }), "L1", {
        at: { x: 641, y: 421 },
        outside: false,
      }),
    ).toBeNull();
  });
  test("their page moved it with its element (a scroll of 250 px): drawn there", () => {
    const placed = { at: { x: 640, y: 170 }, outside: false };
    expect(pa().ghostAt(held({ a, load: "L1", at }), "L1", placed)).toEqual(
      placed,
    );
  });
  test("its element scrolled out of their screen: drawn on the frame's edge, marked outside", () => {
    const placed = { at: { x: 640, y: 16 }, outside: true };
    expect(pa().ghostAt(held({ a, load: "L1", at }), "L1", placed)).toEqual(
      placed,
    );
  });
  test("nothing held, an off anchor (the stage outlines the frame and says so instead), not on their screen, or made on another page than the one shown: not drawn", () => {
    const placed = { at: { x: 640, y: 170 }, outside: false };
    expect(pa().ghostAt(held({}), "L1", placed)).toBeNull();
    expect(
      pa().ghostAt(
        held({ a: { vx: 0, vy: 0.4, o: 1 }, load: "L1", at }),
        "L1",
        placed,
      ),
    ).toBeNull();
    expect(pa().ghostAt(held({ a, load: "L1", at }), "L1", null)).toBeNull();
    expect(
      pa().ghostAt(held({ a: { vx: 0.5, vy: 0.2 }, load: "L1", at }), "L2", {
        at: { x: 640, y: 170 },
        outside: false,
      }),
    ).toBeNull();
  });
  test("the ghost is faint: translucent, never the live arrow's full opacity", () => {
    expect(pa().GHOST_OPACITY).toBeGreaterThan(0.2);
    expect(pa().GHOST_OPACITY).toBeLessThan(0.8);
  });
});

describe("REQ-451 the pointer off their screen (o: 1) is a small translucent marker on the edge, pointing the way to it (M14)", () => {
  // the customer's 390 × 844 phone; placeIn(…, off) put the 24 × 30 arrow box against an edge
  const phone: Box = { left: 0, top: 0, width: 390, height: 844 };
  test("offEdge: which edge the placed box sits on — left, right, top, bottom, a corner", () => {
    expect(pa().offEdge({ x: 0, y: 338 }, phone)).toEqual({ dx: -1, dy: 0 });
    expect(pa().offEdge({ x: 366, y: 372 }, phone)).toEqual({ dx: 1, dy: 0 });
    expect(pa().offEdge({ x: 180, y: 0 }, phone)).toEqual({ dx: 0, dy: -1 });
    expect(pa().offEdge({ x: 180, y: 814 }, phone)).toEqual({ dx: 0, dy: 1 });
    expect(pa().offEdge({ x: 366, y: 814 }, phone)).toEqual({ dx: 1, dy: 1 });
  });
  test("offMark: smaller than the arrow, translucent, inside the arrow's box against that edge, turned to point out", () => {
    const { OFF_MARK_PX, OFF_MARK_OPACITY } = pa();
    expect(OFF_MARK_PX).toBeLessThan(24);
    expect(OFF_MARK_PX).toBeGreaterThanOrEqual(10);
    expect(OFF_MARK_OPACITY).toBeLessThan(1);
    expect(OFF_MARK_OPACITY).toBeGreaterThanOrEqual(0.5);
    const right = pa().offMark({ x: 366, y: 372 }, phone);
    expect(right.deg).toBe(0);
    // against the right edge, 2 px in; centred on the point's height
    expect(right.left + OFF_MARK_PX).toBe(22);
    expect(right.top).toBe(-OFF_MARK_PX / 2);
    const left = pa().offMark({ x: 0, y: 338 }, phone);
    expect(left).toEqual({ left: 2, top: -OFF_MARK_PX / 2, deg: 180 });
    expect(pa().offMark({ x: 180, y: 0 }, phone)).toEqual({
      left: -OFF_MARK_PX / 2,
      top: 2,
      deg: -90,
    });
    const down = pa().offMark({ x: 180, y: 814 }, phone);
    expect(down.deg).toBe(90);
    expect(down.top + OFF_MARK_PX).toBe(28);
    expect(pa().offMark({ x: 366, y: 814 }, phone).deg).toBe(45);
  });
  test("offMark: at the very top of the left edge the marker is not pushed off the screen", () => {
    const m = pa().offMark({ x: 0, y: 0 }, phone);
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.deg).toBe(-135);
    const high = pa().offMark({ x: 0, y: 3 }, phone);
    expect(3 + high.top).toBeGreaterThanOrEqual(0);
  });
});

// ── the islands' wiring ───────────────────────────────────────────────────────────────────────

describe("REQ-451 the stage: his anchor stays on what he pointed at; a new page gets nothing until he moves; the hand-off counts on the frame only; a ghost shows where their screen has his arrow", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const fn = (name: string) => {
    const at = stage.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return stage.slice(at, stage.indexOf("\n  };\n", at));
  };

  test("M1 scroll: a layout pass never looks the resting pointer up again unconditionally — only a provisional fraction, once the same page has settled, or his mouse beside the frame (lookAgain)", () => {
    const replace = fn("replace");
    // REQ-538 AMENDMENT (cycle 4 M1) — the held anchor is read once (`held`) and lookAgain is also
    // told whether it is still drawn (`alive`): a dead anchor is looked up again once settled
    expect(replace).toMatch(
      /lookAgain\(held, \{\s*load: loadRef\.current,\s*settled: !!replayerRef\.current\?\.settled\(\),\s*alive,?\s*\}\)/,
    );
    expect(replace).not.toMatch(
      /if \(lastMoveRef\.current\) rest\.push\(null\)/,
    );
    // REQ-538 AMENDMENT — a dead node anchor goes through reanchorSoon; the rest as before
    expect(replace).toMatch(
      /if \(\s*lookAgain\([\s\S]{0,260}\)\s*\)\s*\{\s*if \(held\.a\?\.n\) reanchorSoon\(\);\s*else rest\.push\(null\);/,
    );
    expect(stage).toMatch(
      /from "\.\.\/\.\.\/shared\/demo-mode\/presenter-anchor\.ts"/,
    );
  });

  test("M1 page change: the anchor is kept with the page load it was made on; resendPointer sends only what resendable() gives — never a fraction of the frame under his still mouse", () => {
    const anchorOf = fn("anchorOf");
    expect(anchorOf).toMatch(/hold\(/);
    expect(fn("hold")).toMatch(/sentRef\.current = a;/);
    expect(fn("hold")).toMatch(/sentLoadRef\.current = load;/);
    expect(fn("hold")).toMatch(/sentAtRef\.current = at;/);
    expect(fn("hold")).toMatch(/provisionalRef\.current = provisional;/);
    const resend = fn("resendPointer");
    expect(resend).toMatch(/resendable\(/);
    expect(resend).not.toMatch(/pointToFrac|offFrame|anchorOf\(/);
    // a snapshot of a new page load still asks resendPointer (a tab followed again gets its own)
    const snap = stage.slice(stage.indexOf('if (f.t === "snap")'));
    expect(snap.slice(0, snap.indexOf("SETTLE_MS"))).toMatch(
      /if \(newLoad\)[\s\S]{0,700}resendPointer\(\)/,
    );
  });

  test("M1 + M2 (start, reload): no node is taken from a replay that has not settled — its fonts and images still coming in put another element under his still mouse (the Continue button under the middle of the phone): the anchor is a provisional fraction until it has", () => {
    const anchorOf = fn("anchorOf");
    expect(anchorOf).toMatch(
      /const settled = !!load && rep\?\.settled\(\) === true;/,
    );
    expect(anchorOf).toMatch(/const n = settled\s*\?\s*rep\.anchorAt\(/);
    expect(anchorOf).toMatch(/hold\(out, p, load, !n && !settled\)/);
    expect(anchorOf).not.toMatch(/styled\(\)/);
  });

  test("M14 start: the cursor handed over is held as a seed (never put where the mouse is at once); once the frame is fitted it counts only on the frame (seedOn), and a real pointer event drops it", () => {
    expect(stage).toMatch(/seedRef\.current = takeCursor\(sessionStore\(\)\)/);
    expect(stage).not.toMatch(/lastMoveRef\.current = seeded/);
    const take = fn("takeSeed");
    expect(take).toMatch(/if \(!s \|\| !fitted\(\)\) return;/);
    expect(take).toMatch(/seedOn\(s, fitBox\(\)\)/);
    expect(take).toMatch(/throttle\.push\(p\)/);
    expect(fn("replace")).toMatch(/takeSeed\(\);/);
    const at = stage.slice(stage.indexOf("const at = (e: PointerEvent) => {"));
    expect(at.slice(0, at.indexOf("\n    };"))).toMatch(
      /seedRef\.current = null;[\s\S]*lastMoveRef\.current = p;/,
    );
  });

  test("the ghost: where their screen has his arrow (ghostAt over presenterOnStage), placed again on every layout pass and hidden whenever he points afresh; drawn faint with its label", () => {
    expect(fn("showGhost")).toMatch(/ghostAt\(/);
    expect(fn("showGhost")).toMatch(/presenterOnStage\(/);
    expect(fn("replace")).toMatch(/showGhost\(\);/);
    expect(fn("hold")).toMatch(/setGhost\(null\)/);
    expect(stage).toMatch(/<PointerGhost/);
    const ghost = read("front-end/components/demo-mode/PointerGhost.tsx");
    expect(ghost).toMatch(/data-cy="demo-pointer-ghost"/);
    expect(ghost).toMatch(/GHOST_OPACITY/);
    expect(stage).toContain('t("demoMode.pointerGhost", { name })');
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.pointerGhost"]).toBe("Your pointer on {name}'s screen");
    expect(es["demoMode.pointerGhost"]).toBe(
      "Tu puntero en la pantalla de {name}",
    );
  });

  test("a colleague's pointer on this stage follows the same rule: on its node or hidden (presenterOnStage → anchorPoint), the off mark passed on", () => {
    const on = fn("presenterOnStage");
    expect(on).toMatch(/anchorPoint\(/);
    expect(on).toMatch(/loadRef\.current/);
    expect(on).toMatch(/placeIn\(p, f, ARROW_BOX, a\.o === 1\)/);
    const peer = fn("placePeer");
    expect(peer).toMatch(/presenterOnStage\(a\)/);
    expect(peer).toMatch(/if \(!p\)[\s\S]{0,200}kind: "leave"/);
    expect(peer).toMatch(/off: a\.o === 1/);
  });
});

describe("REQ-451 the customer's overlay: a presenter's arrow is on the element he pointed at, or hidden — never at the fraction it had", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const fn = (name: string) => {
    const at = overlay.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return overlay.slice(at, overlay.indexOf("\n  };\n", at));
  };

  test("toScreen: anchorPoint against this page's load, the node only while it is in the page (isConnected); no fracToPoint fallback", () => {
    const toScreen = fn("toScreen");
    expect(toScreen).toMatch(/anchorPoint\(/);
    expect(toScreen).toMatch(/sender\?\.load/);
    expect(toScreen).toMatch(/isConnected/);
    expect(toScreen).toMatch(/recorder\.nodeOf\(n\.id\)/);
    expect(toScreen).not.toMatch(/fracToPoint\(/);
    expect(overlay).toMatch(
      /const p = toScreen\(a\);\s*return p \? placeIn\(p, viewportBox\(\), ARROW_BOX, a\.o === 1\) : null;/,
    );
  });

  test("place hides the arrow (a leave to its pointer) when its anchor cannot be placed, and passes the off mark; replace re-places or hides on every move of the page", () => {
    const body = overlay.slice(overlay.indexOf("const place = (pid: string"));
    const place = body.slice(0, body.indexOf("\n    };\n"));
    expect(place).toMatch(/if \(!p\) \{[\s\S]{0,160}kind: "leave"/);
    expect(place).toMatch(/off: a\.o === 1/);
  });
});

describe("REQ-451 PeerPointer and DemoPointer: an off pointer is a small translucent edge marker with no name tag (M14)", () => {
  test("PeerPointer keeps the latest command's off mark and passes it on", () => {
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/off\?: boolean/);
    expect(peer).toMatch(/setOff\(cmd\.off === true\)/);
    expect(peer).toMatch(/off=\{off\}/);
  });
  test("DemoPointer: off draws the marker (data-off) from offMark — no arrow, no dashed ring, no tag", () => {
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/data-off=\{off \? "" : undefined\}/);
    expect(pointer).toMatch(/offMark\(/);
    expect(pointer).toMatch(/OFF_MARK_OPACITY/);
    // one or the other: the marker when off; else the ring (outside), the arrow and the name tag
    expect(pointer).toMatch(
      /\{off(?: && mark)?\s*\?\s*\(\s*<svg\s+data-cy="demo-pointer-off-mark"/,
    );
    const mark = pointer.indexOf('data-cy="demo-pointer-off-mark"');
    for (
      const later of [
        "{outside && (",
        "d={ARROW_PATH}",
        'data-cy="demo-pointer-tag"',
      ]
    ) {
      expect([later, pointer.indexOf(later) > mark]).toEqual([later, true]);
    }
  });
});

/**
 * REQ-538 (REQ-451 AMENDMENT, demo-loop cycle 4, M1) — "Presenter pointer disappears on customer
 * screen after every page/card change and when idle". REQ-451 kept a node anchor on its node and
 * drew nothing once that node was gone (a card swapped or flipped, a button replaced, a new page),
 * and nothing ever re-anchored it: the arrow came back only on his next move. A DEAD anchor (its
 * node no longer resolves in the replay, or another page load is shown) is now looked up again
 * ONCE under his still mouse, after that replay has settled; a live one never is (REQ-451 kept).
 */
type Shown = { load: string | null; settled: boolean; alive?: boolean };
const pa2 = () =>
  pa() as ReturnType<typeof pa> & {
    lookAgain(h: Held, shown: Shown): boolean;
    pointerAbsent(h: Held, alive: boolean): boolean;
  };

/** a model of the stage's replay and its layout passes: nodes with boxes, the page load shown,
 *  whether it has settled, and the node under his still mouse */
function stageModel() {
  const rep = {
    load: "L1" as string,
    settled: true,
    nodes: new Map<number, Box>([[7, {
      left: 0,
      top: 100,
      width: 400,
      height: 200,
    }]]),
    under: 7 as number | null,
  };
  let h: Held = held({
    a: { vx: 0.5, vy: 0.25, n: node(7, "L1") },
    load: "L1",
    at: { x: 200, y: 200 },
  });
  const sent: Anchor[] = [];
  const alive = () =>
    !!h.a &&
    pa().anchorPoint(
        h.a,
        VIEW,
        rep.load,
        (n) => pa().pointInBox(n, rep.nodes.get(n.id) ?? null),
      ) !== null;
  /** one layout pass of the stage: look his still mouse up again when lookAgain says so */
  const pass = () => {
    if (
      !pa2().lookAgain(h, {
        load: rep.load,
        settled: rep.settled,
        alive: alive(),
      })
    ) return;
    const a: Anchor = rep.under !== null && rep.settled
      ? { vx: 0.5, vy: 0.25, n: node(rep.under, rep.load) }
      : { vx: 0.5, vy: 0.25 };
    h = held({ a, load: rep.load, at: { x: 200, y: 200 } });
    sent.push(a);
  };
  return { rep, pass, sent, alive, held: () => h };
}

describe("REQ-538 lookAgain (REQ-451 AMENDMENT, cycle 4 M1): a dead node anchor is looked up again under his still mouse once the replay has settled — a live one never", () => {
  const a: Anchor = { vx: 0.5, vy: 0.5, n: node(7, "L1") };

  test("its node gone on the page shown (a card swapped, flipped, a button replaced): looked up once settled, not before", () => {
    const h = held({ a, load: "L1" });
    expect(pa2().lookAgain(h, { load: "L1", settled: true, alive: false }))
      .toBe(true);
    expect(pa2().lookAgain(h, { load: "L1", settled: false, alive: false }))
      .toBe(false);
  });

  test("a new page load shown: looked up once that replay has settled, not before", () => {
    const h = held({ a, load: "L1" });
    expect(pa2().lookAgain(h, { load: "L2", settled: true, alive: false }))
      .toBe(true);
    expect(pa2().lookAgain(h, { load: "L2", settled: true })).toBe(true);
    expect(pa2().lookAgain(h, { load: "L2", settled: false, alive: false }))
      .toBe(false);
    expect(pa2().lookAgain(h, { load: null, settled: true, alive: false }))
      .toBe(false);
  });

  test("REQ-451 kept: its node still there on the page shown — never, settled or not", () => {
    const h = held({ a, load: "L1" });
    expect(pa2().lookAgain(h, { load: "L1", settled: true, alive: true }))
      .toBe(false);
    expect(pa2().lookAgain(h, { load: "L1", settled: false, alive: true }))
      .toBe(false);
    expect(pa2().lookAgain(h, { load: "L1", settled: true })).toBe(false);
  });

  test("a card swap: exactly one re-anchor once the replay settles, onto the node now under his still mouse — and none after", () => {
    const s = stageModel();
    s.pass();
    s.pass();
    expect(s.sent).toHaveLength(0); // the node is there: none
    // the card is swapped by Preact: node 7 leaves, node 9 takes its place
    s.rep.nodes.delete(7);
    s.rep.nodes.set(9, { left: 0, top: 100, width: 400, height: 200 });
    s.rep.under = 9;
    s.rep.settled = false; // its image still coming in
    s.pass();
    expect(s.sent).toHaveLength(0);
    s.rep.settled = true;
    s.pass();
    s.pass();
    s.pass();
    expect(s.sent).toEqual([{ vx: 0.5, vy: 0.25, n: node(9, "L1") }]);
    expect(s.alive()).toBe(true);
  });

  test("a page change: exactly one re-anchor once the new page's replay settles — and none after", () => {
    const s = stageModel();
    s.rep.load = "L2";
    s.rep.settled = false;
    s.rep.nodes = new Map([[3, { left: 0, top: 0, width: 400, height: 400 }]]);
    s.rep.under = 3;
    s.pass();
    s.pass();
    expect(s.sent).toHaveLength(0);
    s.rep.settled = true;
    s.pass();
    s.pass();
    expect(s.sent).toEqual([{ vx: 0.5, vy: 0.25, n: node(3, "L2") }]);
    expect(s.held().load).toBe("L2");
  });

  test("never while the node exists: their scroll moves it, a settle, the stage resized — no re-anchor", () => {
    const s = stageModel();
    for (let top = 100; top > -150; top -= 50) {
      s.rep.nodes.set(7, { left: 0, top, width: 400, height: 200 });
      s.rep.under = top > 0 ? 7 : null;
      s.pass();
    }
    expect(s.sent).toHaveLength(0);
  });

  test("reanchorDelay: at least REANCHOR_QUIET_MS; after a snapshot, not before its last settle pass", () => {
    const { reanchorDelay, REANCHOR_QUIET_MS } = pa() as unknown as {
      reanchorDelay(
        now: number,
        snapAt: number | null,
        settleEnd: number,
      ): number;
      REANCHOR_QUIET_MS: number;
    };
    expect(REANCHOR_QUIET_MS).toBeGreaterThan(0);
    expect(REANCHOR_QUIET_MS).toBeLessThanOrEqual(500);
    // a card swap long after the page's snapshot: just the quiet wait
    expect(reanchorDelay(10_000, 1_000, 1_500)).toBe(REANCHOR_QUIET_MS);
    expect(reanchorDelay(10_000, null, 1_500)).toBe(REANCHOR_QUIET_MS);
    // a new page 100 ms ago: until its last settle pass (1.5 s after it)
    expect(reanchorDelay(10_100, 10_000, 1_500)).toBe(1_400);
  });

  test("pointerAbsent: his node anchor not drawn on their screen — the stage says so; drawn, a fraction, the off marker or nothing held — not", () => {
    expect(pa2().pointerAbsent(held({ a, load: "L1" }), false)).toBe(true);
    expect(pa2().pointerAbsent(held({ a, load: "L1" }), true)).toBe(false);
    expect(
      pa2().pointerAbsent(held({ a: { vx: 0.5, vy: 0.5 }, load: "L1" }), false),
    ).toBe(false);
    expect(
      pa2().pointerAbsent(
        held({ a: { vx: 0, vy: 0.5, o: 1 }, load: "L1" }),
        false,
      ),
    ).toBe(false);
    expect(pa2().pointerAbsent(held({}), false)).toBe(false);
  });
});

describe("REQ-538 the stage (REQ-451 AMENDMENT, cycle 4 M1): a dead anchor is looked up again once settled; the stage tells him when his arrow is not on their screen", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const fn = (name: string) => {
    const at = stage.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return stage.slice(at, stage.indexOf("\n  };\n", at));
  };

  test("replace(): lookAgain is told whether his anchor is still drawn there (presenterOnStage), settled or not", () => {
    const replace = fn("replace");
    expect(replace).toMatch(
      /const alive = [^\n]*presenterOnStage\([\s\S]{0,300}lookAgain\(held, \{[\s\S]{0,200}alive,?\s*\}\)\s*\)\s*\{\s*if \(held\.a\?\.n\) reanchorSoon\(\);/,
    );
    expect(replace).toMatch(/setAbsent\(pointerAbsent\(held, alive\)\)/);
    expect(fn("hold")).toMatch(/setAbsent\(false\)/);
  });

  test("resendPointer: a new page that gets nothing from resendable looks his still mouse up again through lookAgain (once settled)", () => {
    const resend = fn("resendPointer");
    expect(resend).toMatch(/resendable\(/);
    expect(resend).toMatch(/lookAgain\(/);
    expect(resend).toMatch(/reanchorSoon\(\)/);
  });

  test("the look-up of a dead anchor waits for a still replay and its snapshot's settle passes (reanchorDelay), restarts on every layout pass, and checks again that it is still dead", () => {
    const soon = fn("reanchorSoon");
    expect(soon).toMatch(/clearTimeout\(reanchorTimerRef\.current\)/);
    expect(soon).toMatch(
      /reanchorDelay\(\s*Date\.now\(\),\s*snapAtRef\.current,\s*SETTLE_MS\[SETTLE_MS\.length - 1\],?\s*\)/,
    );
    const again = fn("reanchor");
    expect(again).toMatch(/if \(!held\.a\?\.n\) return;/);
    expect(again).toMatch(
      /lookAgain\(held, \{[\s\S]{0,200}alive: !!presenterOnStage\(held\.a\),?\s*\}\)\s*\)\s*rest\.push\(null\)/,
    );
    expect(stage).toMatch(/snapAtRef\.current = Date\.now\(\);/);
  });

  test("the hint: while his arrow is absent there the stage says \"Your pointer isn't on {name}'s screen — move to show it\", in en and es", () => {
    expect(stage).toMatch(/pointerAbsent\(/);
    expect(stage).toMatch(/data-cy="demo-pointer-absent"/);
    expect(stage).toContain('t("demoMode.pointerAbsent", { name })');
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.pointerAbsent"]).toBe(
      "Your pointer isn't on {name}'s screen — move to show it",
    );
    expect(es["demoMode.pointerAbsent"]).toBe(
      "Tu puntero no está en la pantalla de {name} — muévelo para mostrarlo",
    );
  });
});
