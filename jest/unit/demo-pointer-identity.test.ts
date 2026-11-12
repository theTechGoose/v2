/**
 * REQ-645 — demo issues M1, M2, m36 and c4-M6 (demo-loop cycle 5): the presenter's pointer is
 * re-found by WHAT IT IS, never by where his still mouse is.
 *
 * Cycle 4's REQ-538 looked a dead anchor (a card swapped, a new page, another tab) up again under
 * his STILL mouse once the replay settled: the arrow then sat on whatever the new content had
 * there ("or a person?" where "Lock it in" was, "Back" instead of "Dashboard", empty space on
 * Linda's tab), and only after a long settle wait (M2). An anchor scrolled out of view was clamped
 * onto the window's edge — over the app's search bar or the empty strip under the footer, with a
 * dashed ring (M1, c4-M6). This file pins the replacement:
 *
 *   - a node's PRINT (`printOf`: its tag, data-cy, role, a link's address, its accessible name) is
 *     kept with the anchor; a dead anchor is re-anchored only onto the ONE laid-out node with the
 *     same print (`pickByPrint`), as soon as the replay is styled and for at most REANCHOR_CAP_MS
 *     (`anchorDead`, `seekPrint`, `reanchored`); nothing matches → no arrow, and the stage keeps
 *     saying his arrow is not on their screen. `lookAgain` never looks a dead anchor up under his
 *     mouse again;
 *   - a fraction made only because the replay could not name a node is never sent as an arrow:
 *     it is `pending` on the wire ("Hans is pointing…" on their screen);
 *   - an anchor whose element is out of view is a chevron at the edge of the element's VISIBLE box
 *     (the page's scroller, under its topbar, above the pill's band — `visibleBox`, `placeView`),
 *     with a cue in words, never an arrow over the app's chrome;
 *   - an arrow whose element moved more than DRIFT_FADE_PX since he pointed is faded (`drifted`);
 *   - another browser tab followed: his anchor is kept for its page load (`keepHeld`, `keptFor`)
 *     and dropped (`tabSwitched`) — it comes back only to that page load;
 *   - nothing held (the demo's start, another tab) counts as absent: the stage tells him to move.
 */
import * as fs from "fs";
import * as path from "path";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import * as protocol from "../../shared/demo-mode/protocol";
import type { Anchor, NodeAnchor } from "../../shared/demo-mode/protocol";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  h,
} from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Print = { t: string; cy?: string; r?: string; h?: string; nm?: string };
type Held = {
  a: Anchor | null;
  load: string | null;
  at: Pt | null;
  provisional: boolean;
  print?: Print | null;
};
type Dir = { dx: number; dy: number };
type Shown = {
  load: string | null;
  settled?: boolean;
  styled?: boolean;
  alive?: boolean;
};

// looked up at run time: a missing export fails its own tests, not the whole file
const pa = () =>
  require("../../shared/demo-mode/presenter-anchor") as {
    PRINT_TEXT_MAX: number;
    printOf(n: unknown): Print | null;
    samePrint(
      a: Print | null | undefined,
      b: Print | null | undefined,
    ): boolean;
    pickByPrint<N>(
      p: Print,
      nodes: Iterable<N>,
      printFn: (n: N) => Print | null,
      laidOut: (n: N) => boolean,
    ): N | null;
    lookAgain(h: Held, shown: Shown): boolean;
    anchorDead(h: Held, shown: Shown): boolean;
    REANCHOR_CAP_MS: number;
    SEEK_RETRY_MS: number;
    seekPrint(h: Held, shown: Shown, deadForMs: number): boolean;
    reanchored(
      h: Held,
      id: number,
      load: string,
      at: { vx: number; vy: number },
    ): Anchor;
    pointerAbsent(h: Held, alive: boolean): boolean;
    DRIFT_FADE_PX: number;
    DRIFT_OPACITY: number;
    drifted(from: Pt | null | undefined, now: Pt): boolean;
    PENDING_MS: number;
    tabSwitched(
      was: string | null | undefined,
      now: string | null | undefined,
    ): boolean;
    KEEP_MAX: number;
    keepHeld(kept: Map<string, Held>, h: Held): void;
    keptFor(kept: Map<string, Held>, load: string | null): Held | null;
    placeView(
      p: Pt,
      box: Box,
    ): { at: Pt; outside: boolean; dir: Dir | null };
    cueKey(dir: Dir): string;
    visibleBox(
      el: unknown,
      screen: Box,
      styleOf: (e: unknown) => {
        overflowX?: string;
        overflowY?: string;
        position?: string;
      } | null,
    ): Box;
  };

const node = (id: number, l?: string, x = 0.5, y = 0.5): NodeAnchor =>
  l === undefined ? { id, x, y } : { id, x, y, l };
const held = (o: Partial<Held>): Held => ({
  a: null,
  load: null,
  at: null,
  provisional: false,
  ...o,
});

// ── the print ─────────────────────────────────────────────────────────────────────────────────

describe("REQ-645 printOf: what an element IS — its tag, data-cy, role, a link's address and its accessible name (never where it is)", () => {
  const doc = new FDocument();
  test("a button: its tag, data-cy and its text with the whitespace collapsed; its class (it changes with its state) is no part of it", () => {
    const b = h(
      doc,
      "button",
      { "data-cy": "lock-in", class: "btn btn--hot" },
      "  Lock\n   it in ",
    );
    expect(pa().printOf(b)).toEqual({
      t: "button",
      cy: "lock-in",
      nm: "Lock it in",
    });
  });

  test("its name: aria-label first, then title (the sidebar's links carry it, their count pill changes), an image's alt, a field's name, its placeholder — else its text", () => {
    const { printOf } = pa();
    expect(
      printOf(h(doc, "button", { "aria-label": "Close", title: "x" }, "✕")),
    ).toEqual({ t: "button", nm: "Close" });
    const link = h(
      doc,
      "a",
      { href: "https://app.test/invoices", title: "Invoices", class: "a" },
      h(doc, "span", {}, "Invoices"),
      h(doc, "span", { class: "nav-item__count" }, "3"),
    );
    expect(printOf(link)).toEqual({
      t: "a",
      h: "https://app.test/invoices",
      nm: "Invoices",
    });
    expect(printOf(h(doc, "img", { alt: "Torres Plumbing logo", src: "/l" })))
      .toEqual({ t: "img", nm: "Torres Plumbing logo" });
    expect(
      printOf(h(doc, "input", { name: "email", placeholder: "you@x.com" })),
    ).toEqual({ t: "input", nm: "email" });
    expect(printOf(h(doc, "textarea", { placeholder: "Ask anything" })))
      .toEqual({ t: "textarea", nm: "Ask anything" });
    expect(printOf(h(doc, "div", { role: "tab" }, "Billing"))).toEqual({
      t: "div",
      r: "tab",
      nm: "Billing",
    });
  });

  test("its text leaves a <style> inside out, and stops at PRINT_TEXT_MAX characters", () => {
    const { printOf, PRINT_TEXT_MAX } = pa();
    expect(PRINT_TEXT_MAX).toBeGreaterThanOrEqual(40);
    expect(PRINT_TEXT_MAX).toBeLessThanOrEqual(200);
    const card = h(
      doc,
      "div",
      {},
      h(doc, "style", {}, ".x{color:red}"),
      h(doc, "p", {}, "Deck rebuild"),
      h(doc, "p", {}, "x".repeat(400)),
    );
    const p = printOf(card)!;
    expect(p.nm!.startsWith("Deck rebuild x")).toBe(true);
    expect(p.nm!.length).toBe(PRINT_TEXT_MAX);
    expect(p.nm).not.toContain("color");
  });

  test("not an element (a text node, nothing): no print", () => {
    expect(pa().printOf(doc.createTextNode("hi"))).toBeNull();
    expect(pa().printOf(null)).toBeNull();
  });

  test("samePrint: every part equal — another text, data-cy, address or tag is another element", () => {
    const { samePrint } = pa();
    const a: Print = { t: "button", cy: "send", nm: "Send" };
    expect(samePrint(a, { t: "button", cy: "send", nm: "Send" })).toBe(true);
    expect(samePrint(a, { t: "button", cy: "send", nm: "Send now" })).toBe(
      false,
    );
    expect(samePrint(a, { t: "button", nm: "Send" })).toBe(false);
    expect(samePrint(a, { t: "a", cy: "send", nm: "Send" })).toBe(false);
    expect(
      samePrint({ t: "a", h: "https://app.test/a", nm: "A" }, {
        t: "a",
        h: "https://app.test/b",
        nm: "A",
      }),
    ).toBe(false);
    expect(samePrint(a, null)).toBe(false);
    expect(samePrint(null, null)).toBe(false);
  });
});

describe("REQ-645 pickByPrint: the ONE laid-out element with that print — none, or two alike, is no match (never a guess)", () => {
  type N = { p: Print; box: boolean; name: string };
  const pick = (p: Print, nodes: N[]) =>
    pa().pickByPrint(p, nodes, (n) => n.p, (n) => n.box)?.name ?? null;
  const send: Print = { t: "button", cy: "send", nm: "Send" };

  test("exactly one: it", () => {
    expect(
      pick(send, [
        { p: { t: "button", cy: "back", nm: "Back" }, box: true, name: "b" },
        { p: send, box: true, name: "s" },
      ]),
    ).toBe("s");
  });

  test("none (the card swapped to another control): null; a twin that is not laid out (a hidden copy) is not counted", () => {
    expect(
      pick(send, [{
        p: { t: "button", cy: "person", nm: "or a person?" },
        box: true,
        name: "x",
      }]),
    ).toBeNull();
    expect(
      pick(send, [
        { p: send, box: false, name: "hidden" },
        { p: send, box: true, name: "shown" },
      ]),
    ).toBe("shown");
  });

  test("two laid out alike (two rows' Send): null — the arrow is never put on one of them by chance", () => {
    expect(
      pick(send, [
        { p: send, box: true, name: "row1" },
        { p: send, box: true, name: "row2" },
      ]),
    ).toBeNull();
  });

  test("a unique data-cy whose words changed (a count, the language): it, by its data-cy; two alike by data-cy: null", () => {
    const toggle: Print = { t: "button", cy: "topbar-lang-es", nm: "ES" };
    expect(
      pick(toggle, [{
        p: { t: "button", cy: "topbar-lang-es", nm: "ES ✓" },
        box: true,
        name: "es",
      }]),
    ).toBe("es");
    expect(
      pick({ t: "button", cy: "row-edit", nm: "Edit" }, [
        {
          p: { t: "button", cy: "row-edit", nm: "Editar" },
          box: true,
          name: "1",
        },
        {
          p: { t: "button", cy: "row-edit", nm: "Editar" },
          box: true,
          name: "2",
        },
      ]),
    ).toBeNull();
  });

  test("a print that names nothing (a bare <div>): never looked for", () => {
    expect(
      pick({ t: "div" }, [{ p: { t: "div" }, box: true, name: "d" }]),
    ).toBeNull();
  });
});

// ── a dead anchor ─────────────────────────────────────────────────────────────────────────────

describe("REQ-645 a dead anchor is re-found by its print — never looked up under his still mouse (supersedes REQ-538)", () => {
  const lockIn: Print = { t: "button", cy: "lock-in", nm: "Lock it in" };
  const a: Anchor = { vx: 0.5, vy: 0.5, n: node(7, "L1", 0.3, 0.6) };
  const h1 = held({ a, load: "L1", at: { x: 600, y: 400 }, print: lockIn });

  test("lookAgain: a dead node anchor (its node gone, another page load) is NOT looked up again under his mouse; the off edge and a provisional fraction as before", () => {
    const { lookAgain } = pa();
    expect(lookAgain(h1, { load: "L1", settled: true, alive: false })).toBe(
      false,
    );
    expect(lookAgain(h1, { load: "L2", settled: true, alive: false })).toBe(
      false,
    );
    expect(lookAgain(h1, { load: "L2", settled: true })).toBe(false);
    expect(
      lookAgain(held({ a: { vx: 0, vy: 0.4, o: 1 }, load: "L1" }), {
        load: "L2",
        settled: false,
      }),
    ).toBe(true);
    expect(
      lookAgain(
        held({ a: { vx: 0.5, vy: 0.5 }, load: "L1", provisional: true }),
        { load: "L1", settled: true },
      ),
    ).toBe(true);
  });

  test("anchorDead: its node gone on the page shown, or another page load shown; never while drawn, never a fraction or the off edge", () => {
    const { anchorDead } = pa();
    expect(anchorDead(h1, { load: "L1", alive: false })).toBe(true);
    expect(anchorDead(h1, { load: "L2", alive: true })).toBe(true);
    expect(anchorDead(h1, { load: null })).toBe(true);
    expect(anchorDead(h1, { load: "L1", alive: true })).toBe(false);
    expect(anchorDead(h1, { load: "L1" })).toBe(false);
    expect(
      anchorDead(held({ a: { vx: 0.2, vy: 0.2 }, load: "L1" }), {
        load: "L2",
        alive: false,
      }),
    ).toBe(false);
    expect(
      anchorDead(held({ a: { vx: 0, vy: 0.2, o: 1 }, load: "L1" }), {
        load: "L2",
      }),
    ).toBe(false);
    expect(anchorDead(held({}), { load: "L1" })).toBe(false);
  });

  test("seekPrint: looked for once the replay shown is STYLED (no settle wait), for REANCHOR_CAP_MS after it was found dead — never without a print, never for a live anchor", () => {
    const { seekPrint, REANCHOR_CAP_MS, SEEK_RETRY_MS } = pa();
    expect(REANCHOR_CAP_MS).toBeGreaterThanOrEqual(500);
    expect(REANCHOR_CAP_MS).toBeLessThanOrEqual(1_000);
    expect(SEEK_RETRY_MS).toBeGreaterThan(0);
    expect(SEEK_RETRY_MS).toBeLessThan(REANCHOR_CAP_MS);
    const dead = { load: "L2", styled: true, alive: false };
    expect(seekPrint(h1, dead, 0)).toBe(true);
    expect(seekPrint(h1, dead, REANCHOR_CAP_MS)).toBe(true);
    expect(seekPrint(h1, dead, REANCHOR_CAP_MS + 1)).toBe(false);
    expect(seekPrint(h1, { ...dead, styled: false }, 0)).toBe(false);
    expect(seekPrint(h1, { load: null, styled: true }, 0)).toBe(false);
    expect(seekPrint({ ...h1, print: null }, dead, 0)).toBe(false);
    expect(seekPrint({ ...h1, print: { t: "div" } }, dead, 0)).toBe(false);
    expect(seekPrint(h1, { load: "L1", styled: true, alive: true }, 0)).toBe(
      false,
    );
  });

  test("reanchored: the node found on the page load shown, at the same spot of its box he pointed at", () => {
    expect(pa().reanchored(h1, 42, "L2", { vx: 0.25, vy: 0.75 })).toEqual({
      vx: 0.25,
      vy: 0.75,
      n: { id: 42, x: 0.3, y: 0.6, l: "L2" },
    });
  });

  test("pointerAbsent: nothing held (the demo's start, his mouse gone, another tab followed) is absent too — the stage tells him to move onto their screen; a provisional fraction ('pointing…') and the off edge are not", () => {
    const { pointerAbsent } = pa();
    expect(pointerAbsent(held({}), false)).toBe(true);
    expect(pointerAbsent(h1, false)).toBe(true);
    expect(pointerAbsent(h1, true)).toBe(false);
    expect(
      pointerAbsent(
        held({ a: { vx: 0.5, vy: 0.5 }, load: "L1", provisional: true }),
        false,
      ),
    ).toBe(false);
    expect(
      pointerAbsent(held({ a: { vx: 0, vy: 0.5, o: 1 }, load: "L1" }), false),
    ).toBe(false);
  });
});

/** the stage's layout passes over a replay model: nodes with prints and boxes, the page load
 *  shown, whether it is styled, the node under his still mouse; a pass re-finds a dead anchor by
 *  its print (REQ-645) — and the old REQ-538 rule is what the model must never do */
function stageModel() {
  const view: Box = { left: 0, top: 0, width: 400, height: 800 };
  const rep = {
    load: "L1" as string | null,
    styled: true,
    nodes: new Map<number, { p: Print; box: Box | null }>([
      [7, {
        p: { t: "button", cy: "lock-in", nm: "Lock it in" },
        box: { left: 100, top: 380, width: 200, height: 40 },
      }],
    ]),
    clock: 0,
  };
  let h: Held = held({
    a: { vx: 0.5, vy: 0.5, n: node(7, "L1", 0.5, 0.5) },
    load: "L1",
    at: { x: 200, y: 400 },
    print: { t: "button", cy: "lock-in", nm: "Lock it in" },
  });
  const sent: Anchor[] = [];
  let deadAt: number | null = null;
  const alive = () => {
    const n = h.a?.n;
    if (!n || n.l !== rep.load) return false;
    return !!rep.nodes.get(n.id)?.box;
  };
  const pass = () => {
    const P = pa();
    const shown = { load: rep.load, styled: rep.styled, alive: alive() };
    if (!P.anchorDead(h, shown)) {
      deadAt = null;
      return;
    }
    if (!rep.styled || rep.load === null) return;
    deadAt ??= rep.clock;
    if (!P.seekPrint(h, shown, rep.clock - deadAt)) return;
    const hit = P.pickByPrint(
      h.print!,
      [...rep.nodes.entries()],
      ([, n]) => n.p,
      ([, n]) => !!n.box,
    );
    if (!hit) return;
    const b = hit[1].box!;
    const a = P.reanchored(h, hit[0], rep.load, {
      vx: (b.left + b.width / 2) / view.width,
      vy: (b.top + b.height / 2) / view.height,
    });
    h = { ...h, a, load: rep.load };
    sent.push(a);
  };
  return { rep, pass, sent, held: () => h, alive };
}

describe("REQ-645 the stage model: a card swap, a re-render, a page change", () => {
  test("M1 card swap: 'Lock it in' is replaced by 'or a person?' at the same spot under his still mouse — no re-anchor, ever (REQ-538 put the arrow on 'or a person?')", () => {
    const s = stageModel();
    s.pass();
    expect(s.sent).toHaveLength(0);
    s.rep.nodes.delete(7);
    s.rep.nodes.set(9, {
      p: { t: "button", cy: "person", nm: "or a person?" },
      box: { left: 100, top: 380, width: 200, height: 40 },
    });
    for (let t = 0; t <= 3_000; t += 100) {
      s.rep.clock = t;
      s.pass();
    }
    expect(s.sent).toHaveLength(0);
    expect(pa().pointerAbsent(s.held(), s.alive())).toBe(true);
  });

  test("the same button re-rendered (a new node, the same print), 120 px lower: re-anchored onto it once, at the same spot of its box", () => {
    const s = stageModel();
    s.rep.nodes.delete(7);
    s.rep.nodes.set(11, {
      p: { t: "button", cy: "lock-in", nm: "Lock it in" },
      box: { left: 100, top: 500, width: 200, height: 40 },
    });
    s.pass();
    s.pass();
    expect(s.sent).toEqual([{
      vx: 0.5,
      vy: 0.65,
      n: { id: 11, x: 0.5, y: 0.5, l: "L1" },
    }]);
    expect(s.alive()).toBe(true);
  });

  test("M2 page change: the link he pointed at is on the new page — re-anchored as soon as that replay is styled (before it has settled); not while it is unstyled", () => {
    const s = stageModel();
    s.rep.load = "L2";
    s.rep.styled = false;
    s.rep.nodes = new Map([[3, {
      p: { t: "button", cy: "lock-in", nm: "Lock it in" },
      box: { left: 0, top: 0, width: 100, height: 40 },
    }]]);
    s.pass();
    expect(s.sent).toHaveLength(0);
    s.rep.clock = 50;
    s.rep.styled = true;
    s.pass();
    expect(s.sent).toEqual([{
      vx: 0.125,
      vy: 0.025,
      n: { id: 3, x: 0.5, y: 0.5, l: "L2" },
    }]);
  });

  test("a new page without it: no arrow; it coming only after REANCHOR_CAP_MS is not re-anchored (he has moved on, or will)", () => {
    const s = stageModel();
    const cap = pa().REANCHOR_CAP_MS;
    s.rep.load = "L2";
    s.rep.nodes = new Map([[3, {
      p: { t: "a", h: "https://app.test/back", nm: "Back" },
      box: { left: 0, top: 0, width: 100, height: 40 },
    }]]);
    for (let t = 0; t <= cap; t += 100) {
      s.rep.clock = t;
      s.pass();
    }
    expect(s.sent).toHaveLength(0);
    s.rep.nodes.set(4, {
      p: { t: "button", cy: "lock-in", nm: "Lock it in" },
      box: { left: 0, top: 100, width: 100, height: 40 },
    });
    s.rep.clock = cap + 200;
    s.pass();
    expect(s.sent).toHaveLength(0);
  });
});

// ── on their screen ───────────────────────────────────────────────────────────────────────────

describe("REQ-645 drifted: an arrow whose element moved more than DRIFT_FADE_PX since he pointed (his mouse still) is faded", () => {
  test("within DRIFT_FADE_PX of where it was: not faded; further: faded; no origin (out of view when he pointed): never", () => {
    const { drifted, DRIFT_FADE_PX, DRIFT_OPACITY } = pa();
    expect(DRIFT_FADE_PX).toBeGreaterThanOrEqual(30);
    expect(DRIFT_FADE_PX).toBeLessThanOrEqual(60);
    expect(DRIFT_OPACITY).toBeGreaterThan(0.2);
    expect(DRIFT_OPACITY).toBeLessThan(0.7);
    const at = { x: 300, y: 200 };
    expect(drifted(at, { x: 300, y: 230 })).toBe(false);
    expect(drifted(at, { x: 300, y: 200 + DRIFT_FADE_PX + 1 })).toBe(true);
    expect(drifted(at, { x: 380, y: 200 })).toBe(true);
    expect(drifted(null, { x: 900, y: 900 })).toBe(false);
    expect(drifted(undefined, { x: 900, y: 900 })).toBe(false);
  });
});

describe("REQ-645 placeView, visibleBox, cueKey: an element out of view is a chevron at the edge of where it can be seen — never an arrow over the topbar's search bar or the strip under the footer", () => {
  // the app shell: a 60 px topbar, the scroller `.content` under it, the pill's band below
  const screen: Box = { left: 0, top: 0, width: 1280, height: 720 };
  const content: Box = { left: 240, top: 60, width: 1040, height: 600 };

  test("placeView: inside its box — the point itself; above it — on its top edge pointing up; below — on its bottom edge (the whole arrow box inside) pointing down; beside — left / right", () => {
    const { placeView } = pa();
    expect(placeView({ x: 500, y: 300 }, content)).toEqual({
      at: { x: 500, y: 300 },
      outside: false,
      dir: null,
    });
    expect(placeView({ x: 1100, y: 20 }, content)).toEqual({
      at: { x: 1100, y: 60 },
      outside: true,
      dir: { dx: 0, dy: -1 },
    });
    expect(placeView({ x: 1230, y: 1400 }, content)).toEqual({
      at: { x: 1230, y: 630 },
      outside: true,
      dir: { dx: 0, dy: 1 },
    });
    expect(placeView({ x: 100, y: 300 }, content).dir).toEqual({
      dx: -1,
      dy: 0,
    });
    expect(placeView({ x: 1300, y: 300 }, content).dir).toEqual({
      dx: 1,
      dy: 0,
    });
  });

  test("cueKey: the words for the way to it — below, above, right, left (up/down first)", () => {
    const { cueKey } = pa();
    expect(cueKey({ dx: 0, dy: 1 })).toBe("demoMode.pointerBelow");
    expect(cueKey({ dx: 0, dy: -1 })).toBe("demoMode.pointerAbove");
    expect(cueKey({ dx: 1, dy: 0 })).toBe("demoMode.pointerRight");
    expect(cueKey({ dx: -1, dy: 0 })).toBe("demoMode.pointerLeft");
    expect(cueKey({ dx: 1, dy: 1 })).toBe("demoMode.pointerBelow");
  });

  /** a chain of boxes with styles, as visibleBox reads them */
  type C = {
    parentElement: C | null;
    box: Box;
    style: { overflowX?: string; overflowY?: string; position?: string };
    getBoundingClientRect(): Box;
  };
  const chain = (...links: [Box, C["style"]][]) => {
    let parent: C | null = null;
    for (const [box, style] of links) {
      const c: C = {
        parentElement: parent,
        box,
        style,
        getBoundingClientRect: () => box,
      };
      parent = c;
    }
    return parent!;
  };
  const styleOf = (e: unknown) => (e as C).style;

  test("visibleBox: a row in the app's `.content` scroller can be seen only there — never under the topbar above it; a page scrolled by the window, the screen; a fixed element, the screen", () => {
    const { visibleBox } = pa();
    const app = { left: 0, top: 0, width: 1280, height: 660 };
    const row = chain(
      [app, { overflowX: "hidden", overflowY: "hidden" }], // .app
      [{ left: 240, top: 0, width: 1040, height: 660 }, {
        overflowX: "hidden",
        overflowY: "hidden",
      }], // .main
      [content, { overflowX: "hidden", overflowY: "auto" }], // .content
      [{ left: 262, top: -240, width: 996, height: 300 }, {}], // a card scrolled up
      [{ left: 280, top: -200, width: 200, height: 40 }, {}], // the row
    );
    expect(visibleBox(row, screen, styleOf)).toEqual(content);
    const onWindow = chain(
      [{ left: 0, top: -900, width: 1280, height: 3000 }, {}],
      [{ left: 20, top: 400, width: 200, height: 40 }, {}],
    );
    expect(visibleBox(onWindow, screen, styleOf)).toEqual(screen);
    const fab = chain(
      [content, { overflowX: "hidden", overflowY: "auto" }],
      [{ left: 1200, top: 20, width: 48, height: 48 }, { position: "fixed" }],
    );
    expect(visibleBox(fab, screen, styleOf)).toEqual(screen);
    const wide = chain(
      [{ left: 0, top: 100, width: 600, height: 2000 }, {
        overflowX: "auto",
        overflowY: "visible",
      }],
      [{ left: 700, top: 200, width: 40, height: 40 }, {}],
    );
    expect(visibleBox(wide, screen, styleOf)).toEqual({
      left: 0,
      top: 0,
      width: 600,
      height: 720,
    });
  });

  /** a tree of boxes with styles: a node and its element children */
  type T = C & { children: T[] };
  const tree = (box: Box, style: C["style"], children: T[] = []): T => {
    const n: T = {
      parentElement: null,
      children,
      box,
      style,
      getBoundingClientRect: () => box,
    };
    for (const k of children) k.parentElement = n;
    return n;
  };

  test("visibleBox (a phone: the window scrolls, the topbar is sticky): a row scrolled up under a bar pinned at the top of where it can be seen — or over a bar pinned at its bottom — is out of view; a full-screen layer, a floating button, a bar in the flow are no bar", () => {
    const { visibleBox } = pa();
    const phone = { left: 0, top: 0, width: 420, height: 740 };
    const row = tree({ left: 22, top: 30, width: 376, height: 40 }, {});
    const flowing = tree({ left: 0, top: 300, width: 420, height: 40 }, {
      position: "sticky",
    }); // a sticky section header, in its place mid-page: no bar
    const content = tree({ left: 0, top: -400, width: 420, height: 2000 }, {
      overflowX: "visible",
      overflowY: "visible",
    }, [flowing, row]);
    const topbar = tree({ left: 0, top: 0, width: 420, height: 60 }, {
      position: "sticky",
    });
    const main = tree({ left: 0, top: -400, width: 420, height: 2060 }, {
      overflowX: "clip",
      overflowY: "visible",
    }, [topbar, content]);
    const fab = tree({ left: 340, top: 600, width: 56, height: 56 }, {
      position: "fixed",
    });
    const layer = tree({ left: 0, top: 0, width: 420, height: 800 }, {
      position: "fixed",
    });
    tree({ left: 0, top: -400, width: 420, height: 2060 }, {}, [
      main,
      fab,
      layer,
    ]);
    expect(visibleBox(row, phone, styleOf)).toEqual({
      left: 0,
      top: 60,
      width: 420,
      height: 680,
    });
    // a bar pinned at the bottom of the screen (a fixed tab bar) cuts it there too
    const tabs = tree({ left: 0, top: 684, width: 420, height: 56 }, {
      position: "fixed",
    });
    const row2 = tree({ left: 22, top: 700, width: 376, height: 40 }, {});
    const content2 = tree({ left: 0, top: 0, width: 420, height: 2000 }, {}, [
      row2,
    ]);
    tree({ left: 0, top: 0, width: 420, height: 2000 }, {}, [content2, tabs]);
    expect(visibleBox(row2, phone, styleOf)).toEqual({
      left: 0,
      top: 0,
      width: 420,
      height: 684,
    });
    // a node inside the topbar is not cut by its own bar
    const toggle = tree({ left: 300, top: 14, width: 60, height: 32 }, {});
    const bar = tree({ left: 0, top: 0, width: 420, height: 60 }, {
      position: "sticky",
    }, [toggle]);
    const page2 = tree({ left: 0, top: 0, width: 420, height: 2000 }, {}, [
      tree({ left: 0, top: 60, width: 420, height: 1940 }, {}),
    ]);
    tree({ left: 0, top: 0, width: 420, height: 2060 }, {}, [bar, page2]);
    expect(visibleBox(toggle, phone, styleOf)).toEqual(phone);
  });
});

describe("REQ-645 tabSwitched, keepHeld, keptFor: another browser tab followed drops his anchor; it is kept for its page load only", () => {
  test("tabSwitched: two known browser-tab keys that differ; the same tab's next page, or a key not known, is no switch", () => {
    const { tabSwitched } = pa();
    expect(tabSwitched("tab-a", "tab-b")).toBe(true);
    expect(tabSwitched("tab-a", "tab-a")).toBe(false);
    expect(tabSwitched(undefined, "tab-b")).toBe(false);
    expect(tabSwitched("tab-a", undefined)).toBe(false);
    expect(tabSwitched(null, null)).toBe(false);
  });

  test("keepHeld keeps a node anchor by the page load it was made on (the newest KEEP_MAX); keptFor gives it back for that load only; a fraction, the off edge or nothing is not kept", () => {
    const { keepHeld, keptFor, KEEP_MAX } = pa();
    expect(KEEP_MAX).toBeGreaterThanOrEqual(2);
    const kept = new Map<string, Held>();
    const hA = held({
      a: { vx: 0.9, vy: 0.05, n: node(5, "LA") },
      load: "LA",
      print: { t: "button", cy: "lang-es", nm: "ES" },
    });
    keepHeld(kept, hA);
    keepHeld(kept, held({ a: { vx: 0.1, vy: 0.1 }, load: "LB" }));
    keepHeld(kept, held({ a: { vx: 0, vy: 0.1, o: 1 }, load: "LC" }));
    keepHeld(kept, held({}));
    expect(keptFor(kept, "LA")).toEqual(hA);
    expect(keptFor(kept, "LB")).toBeNull();
    expect(keptFor(kept, "LC")).toBeNull();
    expect(keptFor(kept, null)).toBeNull();
    for (let i = 0; i < KEEP_MAX + 3; i++) {
      keepHeld(
        kept,
        held({
          a: { vx: 0.5, vy: 0.5, n: node(i + 1, `L${i}`) },
          load: `L${i}`,
        }),
      );
    }
    expect(kept.size).toBe(KEEP_MAX);
    expect(keptFor(kept, "LA")).toBeNull();
    expect(keptFor(kept, `L${KEEP_MAX + 2}`)).not.toBeNull();
  });

  test("PENDING_MS: the 'pointing…' placeholder goes on its own after a few seconds when nothing follows", () => {
    expect(pa().PENDING_MS).toBeGreaterThanOrEqual(1_500);
    expect(pa().PENDING_MS).toBeLessThanOrEqual(5_000);
  });
});

// ── the wire ──────────────────────────────────────────────────────────────────────────────────

describe("REQ-645 the wire: `pending` — his pointer is being found again ('pointing…'), a fraction of the screen and never an element", () => {
  test("a pending message parses with its fraction only (a node or the off mark is dropped); junk is dropped; it rides a relay", () => {
    const P = protocol as unknown as {
      parsePeerMessage(x: unknown): unknown;
      parseClientMessage(raw: string): unknown;
    };
    expect(
      P.parsePeerMessage({
        k: "pending",
        a: { vx: 0.25, vy: 0.5, n: { id: 3, x: 0.5, y: 0.5, l: "L1" } },
      }),
    ).toEqual({ k: "pending", a: { vx: 0.25, vy: 0.5 } });
    expect(P.parsePeerMessage({ k: "pending", a: { vx: 2, vy: -1, o: 1 } }))
      .toEqual({ k: "pending", a: { vx: 1, vy: 0 } });
    expect(P.parsePeerMessage({ k: "pending" })).toBeNull();
    expect(P.parsePeerMessage({ k: "pending", a: { vx: "x", vy: 0 } }))
      .toBeNull();
    expect(
      P.parseClientMessage(
        '{"t":"relay","data":{"k":"pending","a":{"vx":0.1,"vy":0.2}},"tab":"c1"}',
      ),
    ).toEqual({
      t: "relay",
      data: { k: "pending", a: { vx: 0.1, vy: 0.2 } },
      tab: "c1",
    });
  });
});

// ── the replay ────────────────────────────────────────────────────────────────────────────────

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}
function snapshotOf(doc: FDocument): MirrorFrame[] {
  const frames: MirrorFrame[] = [];
  const rec = createRecorder(doc as unknown as Document, {
    emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
  rec.snapshot();
  rec.stop();
  return frames;
}
type Rep = ReturnType<typeof createReplayer> & {
  printOf?(id: number): Print | null;
  findPrint?(p: Print): number | null;
  clipOf?(a: NodeAnchor): Box | null;
};

describe("REQ-645 the replay: a node's print, and the one laid-out node with a print", () => {
  /** the customer's page: a sidebar link, a card with Lock it in, a hidden copy of the link */
  const page = (lockText: string) =>
    docWith((d) =>
      h(
        d,
        "html",
        {},
        h(d, "head"),
        h(
          d,
          "body",
          {},
          h(
            d,
            "a",
            { href: "https://app.test/invoices", title: "Invoices" },
            "Invoices",
          ),
          h(
            d,
            "a",
            {
              href: "https://app.test/invoices",
              title: "Invoices",
              class: "mobile-copy",
            },
            "Invoices",
          ),
          h(
            d,
            "div",
            { class: "card" },
            h(d, "button", { "data-cy": "lock-in" }, lockText),
          ),
        ),
      )
    );
  const laidOut = (stage: FDocument) => {
    // the first link and the button have boxes; the mobile copy is display:none (no box)
    const links = [] as FElement[];
    const walk = (n: FElement) => {
      if (n.localName === "a") links.push(n);
      for (const c of n.childNodes) if (c.nodeType === 1) walk(c as FElement);
    };
    walk(stage.documentElement!);
    links[0].rect = { left: 10, top: 100, width: 180, height: 36 };
    find(stage, (e) => e.localName === "button")!.rect = {
      left: 400,
      top: 300,
      width: 160,
      height: 40,
    };
  };

  test("printOf(id) is the print of the mirrored node; findPrint finds the one LAID-OUT node with it (a hidden copy is not counted); none: null", () => {
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document, {
      schedule: () => {},
      Resize: null,
    }) as Rep;
    expect(rep.apply(snapshotOf(page("Lock it in"))[0])).toBe(true);
    laidOut(stage);
    const at = rep.anchorAt(420, 320)!;
    expect(at).not.toBeNull();
    expect(typeof rep.printOf).toBe("function");
    expect(rep.printOf!(at.id)).toEqual({
      t: "button",
      cy: "lock-in",
      nm: "Lock it in",
    });
    const link = rep.anchorAt(20, 110)!;
    const linkPrint = rep.printOf!(link.id)!;
    expect(rep.findPrint!(linkPrint)).toBe(link.id);
    expect(rep.findPrint!({ t: "button", nm: "or a person?" })).toBeNull();

    // the customer's next page load: the same link (new ids) — found by its print
    const before = link.id;
    expect(rep.apply(snapshotOf(page("Locked"))[0])).toBe(true);
    laidOut(stage);
    const again = rep.findPrint!(linkPrint);
    expect(again).not.toBeNull();
    expect(rep.anchorAt(20, 110)!.id).toBe(again);
    void before;
    // the button's words changed; its data-cy is unique: found by it
    expect(rep.findPrint!({ t: "button", cy: "lock-in", nm: "Lock it in" }))
      .toBe(rep.anchorAt(420, 320)!.id);
  });

  test("clipOf: with no computed styles (this fake DOM) the whole view; a node it does not have: null", () => {
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document, {
      schedule: () => {},
      Resize: null,
    }) as Rep;
    rep.apply(snapshotOf(page("Lock it in"))[0]);
    laidOut(stage);
    const at = rep.anchorAt(420, 320)!;
    expect(typeof rep.clipOf).toBe("function");
    expect(rep.clipOf!(at)).toEqual({
      left: 0,
      top: 0,
      width: 420,
      height: 800,
    });
    expect(rep.clipOf!({ id: 99_999, x: 0.5, y: 0.5 })).toBeNull();
  });
});

// ── the islands' wiring ───────────────────────────────────────────────────────────────────────

describe("REQ-645 the stage: the print rides with his anchor; a dead one is re-found by it; a provisional fraction is `pending`; another tab drops it", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const fn = (name: string) => {
    const at = stage.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return stage.slice(at, stage.indexOf("\n  };\n", at));
  };

  test("anchorOf takes the print of the node it names (rep.printOf) and holds it with the anchor", () => {
    const anchorOf = fn("anchorOf");
    expect(anchorOf).toMatch(/rep\??\.printOf\(/);
    expect(anchorOf).toMatch(/hold\(out, p, load, !n && !settled, print\)/);
    expect(fn("hold")).toMatch(/printRef\.current = print;/);
    expect(fn("drop")).toMatch(/printRef\.current = null;/);
  });

  test("replace(): REQ-538's look-up under his still mouse is gone — a dead anchor goes to seekAgain; lookAgain still drives the off edge and a provisional fraction", () => {
    const replace = fn("replace");
    expect(replace).toMatch(/seekAgain\(\)/);
    expect(stage).not.toMatch(/reanchorSoon|reanchorDelay|REANCHOR_QUIET_MS/);
    expect(replace).toMatch(
      /if \(\s*lookAgain\(held, \{\s*load: loadRef\.current,\s*settled: !!replayerRef\.current\?\.settled\(\),?\s*\}\)\s*\) rest\.push\(null\);/,
    );
  });

  test("seekAgain: dead (anchorDead), the replay styled, within the cap (seekPrint from deadAtRef) — findPrint, then reanchored + hold + a move; not found: tried again after SEEK_RETRY_MS", () => {
    const seek = fn("seekAgain");
    expect(seek).toMatch(/anchorDead\(/);
    expect(seek).toMatch(/rep\.styled\(\)/);
    expect(seek).toMatch(/seekPrint\(/);
    expect(seek).toMatch(/deadAtRef\.current/);
    expect(seek).toMatch(/rep\.findPrint\(/);
    expect(seek).toMatch(/reanchored\(/);
    expect(seek).toMatch(/hold\(/);
    expect(seek).toMatch(/k: "move"/);
    expect(seek).toMatch(/SEEK_RETRY_MS/);
    expect(seek).not.toMatch(/lastMoveRef|anchorOf\(/);
  });

  test("the wire: every anchor of his goes out through `wire` — a provisional fraction as `pending`, never as a move or a click at that fraction", () => {
    const wire = fn("wire");
    expect(wire).toMatch(/provisionalRef\.current/);
    expect(wire).toMatch(/k: "pending"/);
    const throttle = stage.slice(stage.indexOf("const throttle = useMemo("));
    expect(throttle.slice(0, throttle.indexOf("}), []);"))).toMatch(
      /wire\(\{\s*k: "move",\s*a: anchorOf\(\{ x, y \}\),/,
    );
    expect(fn("restAgain")).toMatch(/wire\(\{ k: "move", a, /);
    expect(fn("resendPointer")).toMatch(/wire\(\{ k: "move", a, /);
    expect(fn("sendClick")).toMatch(/k: "pending"/);
  });

  test("resendPointer: his anchor of another page load is `pending` there, then looked for by its print (seekAgain)", () => {
    const resend = fn("resendPointer");
    expect(resend).toMatch(/resendable\(/);
    expect(resend).toMatch(/k: "pending"/);
    expect(resend).toMatch(/seekAgain\(\)/);
  });

  test("m36: onPeerOnline hears the followed browser tab's key; another tab keeps his anchor for its page load and drops it (no look-up on the new tab), and says so", () => {
    const online = stage.slice(stage.indexOf("onPeerOnline: (cid"));
    const body = online.slice(0, online.indexOf("\n      },\n"));
    expect(body).toMatch(/onPeerOnline: \(cid, tab\)/);
    expect(body).toMatch(/tabSwitched\(followedTab, tab\)/);
    expect(body).toMatch(/keepHeld\(keptRef\.current, heldNow\(\)\)/);
    expect(body).toMatch(/drop\(\)/);
    expect(body).toMatch(/switchedRef\.current = true/);
  });

  test("a new page load: a kept anchor of that very load is given back (keptFor) — else resendPointer; the search's clock starts over on it", () => {
    const snap = stage.slice(stage.indexOf('if (f.t === "snap")'));
    const newLoad = snap.slice(0, snap.indexOf("SETTLE_MS"));
    expect(newLoad).toMatch(
      /if \(!restoreKept\(load, path\)\) resendPointer\(\);/,
    );
    const restore = fn("restoreKept");
    expect(restore).toMatch(/keptFor\(keptRef\.current, load\)/);
    expect(restore).toMatch(/noteTab\(path, back\)/);
    // the dead anchor's clock belongs to a page load: another load starts it over
    expect(fn("seekAgain")).toMatch(
      /if \(deadAtRef\.current\?\.load !== load\) deadAtRef\.current = \{ at: now, load \};/,
    );
  });

  test("the stage says it: the tab notice (demo-tab-switched) and the absent hint, in en and es", () => {
    expect(stage).toMatch(/data-cy="demo-tab-switched"/);
    expect(stage).toContain(
      't("demoMode.tabSwitched", { name, path: tabNote })',
    );
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.tabSwitched"]).toBe(
      "Now showing {name}'s other tab ({path}) — move to point there",
    );
    expect(es["demoMode.tabSwitched"]).toBe(
      "Ahora ves la otra pestaña de {name} ({path}) — mueve el puntero para señalar ahí",
    );
  });

  test("the ghost and the colleagues' pointers: an element out of view is a chevron at the edge of where the replay shows it (placeView over clipOf)", () => {
    const on = fn("presenterOnStage");
    expect(on).toMatch(
      /if \(a\.n && a\.o !== 1\) return placeView\(p, visOnStage\(a\)\);/,
    );
    expect(fn("visOnStage")).toMatch(/clipOf\(/);
    const ghost = read("front-end/components/demo-mode/PointerGhost.tsx");
    expect(ghost).toMatch(/data-cue=/);
  });
});

describe("REQ-645 the customer's overlay: out of view is a chevron with a cue, a drifted arrow fades, `pending` is 'pointing…'", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const fn = (name: string) => {
    const at = overlay.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return overlay.slice(at, overlay.indexOf("\n  };\n", at));
  };

  test("placeOnScreen: the off edge and a bare fraction as before; an element anchor against its visible box (visibleBox, within the screen without the pill's band) through placeView", () => {
    const place = fn("placeOnScreen");
    expect(place).toMatch(
      /visibleBox\(el as unknown as ClipNode, screenBox\(\), styleOf\)/,
    );
    expect(place).toMatch(/placeView\(p, box\)/);
    expect(place).toMatch(
      /placeIn\(p, viewportBox\(\), ARROW_BOX, a\.o === 1\)/,
    );
    expect(fn("screenBox")).toMatch(/bandRef\.current\.h/);
  });

  test("place: a cue in the presenter's name when out of view (cueKey), faded when drifted from where it was when he pointed", () => {
    const body = overlay.slice(overlay.indexOf("const place = (pid: string"));
    const place = body.slice(0, body.indexOf("\n    };\n"));
    expect(place).toMatch(/cueKey\(p\.dir\)/);
    expect(place).toMatch(/drifted\(/);
    expect(place).toMatch(/faded/);
  });

  test("onPeer: `pending` hides his last anchor and shows 'pointing…' at its fraction", () => {
    const pend = overlay.slice(overlay.indexOf('case "pending":'));
    expect(pend.slice(0, pend.indexOf("break;"))).toMatch(
      /anchorsRef\.current\.delete\(pid\)[\s\S]*kind: "pending"[\s\S]*demoMode\.pointerPending/,
    );
  });

  test("the words, in en and es", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.pointerPending"]).toBe("{name} is pointing…");
    expect(es["demoMode.pointerPending"]).toBe("{name} está señalando…");
    expect(en["demoMode.pointerBelow"]).toBe(
      "{name} is pointing below — scroll ↓",
    );
    expect(es["demoMode.pointerBelow"]).toBe(
      "{name} señala más abajo — desplázate ↓",
    );
    expect(en["demoMode.pointerAbove"]).toBe(
      "{name} is pointing above — scroll ↑",
    );
    expect(es["demoMode.pointerAbove"]).toBe(
      "{name} señala más arriba — desplázate ↑",
    );
    expect(en["demoMode.pointerRight"]).toBe(
      "{name} is pointing to the right — scroll →",
    );
    expect(es["demoMode.pointerRight"]).toBe(
      "{name} señala a la derecha — desplázate →",
    );
    expect(en["demoMode.pointerLeft"]).toBe(
      "{name} is pointing to the left — scroll ←",
    );
    expect(es["demoMode.pointerLeft"]).toBe(
      "{name} señala a la izquierda — desplázate ←",
    );
  });
});

describe("REQ-645 PeerPointer, DemoPointer and the transport", () => {
  test("PeerPointer: `pending` shows the placeholder for PENDING_MS at most; a cue and a fade ride a move", () => {
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/case "pending":/);
    expect(peer).toMatch(/PENDING_MS/);
    expect(peer).toMatch(/setCue\(cmd\.cue \?\? null\)/);
    expect(peer).toMatch(/setFaded\(cmd\.faded === true\)/);
  });

  test("DemoPointer: the placeholder (demo-pointer-pending, no arrow), the cue (a chevron and its words, demo-pointer-cue, no arrow, no ring) and the fade (data-faded, DRIFT_OPACITY)", () => {
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/data-cy="demo-pointer-pending"/);
    expect(pointer).toMatch(/data-cy="demo-pointer-cue"/);
    expect(pointer).toMatch(/data-cue=\{cue \? "" : undefined\}/);
    expect(pointer).toMatch(/data-faded=\{faded \? "" : undefined\}/);
    expect(pointer).toMatch(/DRIFT_OPACITY/);
  });

  test("the transport tells a stage which browser tab it follows now (its key)", () => {
    const tr = read("front-end/lib/demo-mode/transport.ts");
    expect(tr).toMatch(/onPeerOnline\(cid\?: string, tab\?: string\): void;/);
    expect(tr).toMatch(/o\.onPeerOnline\(best, tabs\.get\(best\)\?\.key\)/);
  });
});
