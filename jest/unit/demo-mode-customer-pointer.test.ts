/**
 * REQ-371 — demo issue m10 (demo-loop cycle 2): the customer's pointer and click ripple land on
 * what the customer really pointed at, follow it on the stage, and a last touch does not stay
 * drawn as a hover.
 *
 *   - the customer's anchor is taken from the hit-test STACK (`elementsFromPoint`), skipping the
 *     demo's own chrome (`[data-demo-overlay]`, never mirrored): a point under the customer's pill
 *     names the page's element under the pill, never an ancestor's box (`anchorAt`);
 *   - the stage's click wave keeps the anchor it was sent with and is placed again on every layout
 *     pass of the replay, like the pointer (`placeWavesAgain`);
 *   - a touch pointer has no pointerleave: TOUCH_REST_MS after the last touch the customer's side
 *     sends `leave` (`createTouchFade`); a mouse or pen pointer is never faded.
 */
import * as fs from "fs";
import * as path from "path";
import * as mod from "../../front-end/lib/demo-mode/pointer-anchor";
import type { Anchor } from "../../shared/demo-mode/protocol";
import { docWith, FElement, find, h } from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Rec = {
  idOf(n: unknown): number | null;
  nodeOf(id: number): FElement | null;
};
type W = { id: number; x: number; y: number; a: Anchor };
type WaveFrame = {
  box: { left: number; top: number; width: number; height: number };
  load: string | null;
  nodeAt(a: Anchor): Pt | null;
};
// looked up at run time: a missing export fails its own tests, not the whole file
const m = mod as unknown as {
  anchorAt(
    p: Pt,
    view: { left: number; top: number; width: number; height: number },
    stack: readonly FElement[],
    recorder: Rec | null,
    load: string | null,
  ): Anchor;
  pageTopAt(stack: readonly FElement[]): FElement | null;
  newStageWave(id: number, a: Anchor, f: WaveFrame): W;
  placeWavesAgain(waves: W[], f: WaveFrame): W[];
  createTouchFade(o: { ms: number; fade: () => void }): {
    seen(pointerType: string): void;
    cancel(): void;
  };
  TOUCH_REST_MS: number;
};

/** the customer's page: two option rows, and the demo's pill over the second one */
function page() {
  const doc = docWith((d) =>
    h(
      d,
      "html",
      {},
      h(
        d,
        "body",
        {},
        h(
          d,
          "div",
          { id: "list" },
          h(d, "button", { id: "one" }, "1 week"),
          h(d, "button", { id: "two" }, "2 weeks"),
        ),
        h(
          d,
          "div",
          { "data-demo-overlay": "" },
          h(d, "div", { id: "pill" }, h(d, "span", { id: "pilltext" }, "Demo")),
        ),
      ),
    )
  );
  const el = (id: string) => find(doc, (e) => e.id === id)!;
  el("list").rect = { left: 0, top: 100, width: 400, height: 200 };
  el("one").rect = { left: 0, top: 100, width: 400, height: 100 };
  el("two").rect = { left: 0, top: 200, width: 400, height: 100 };
  // a recorder: ids for the page's elements, none for the overlay (it never crosses); idOf walks
  // up to the nearest mirrored ancestor, like mirror-record.ts
  const ids = new Map<FElement, number>();
  let next = 1;
  const body = find(doc, (e) => e.localName === "body")!;
  ids.set(body, next++);
  for (const id of ["list", "one", "two"]) ids.set(el(id), next++);
  const rec: Rec = {
    idOf(n) {
      for (let a = n as FElement | null; a; a = a.parentNode as FElement) {
        if (ids.has(a)) return ids.get(a)!;
      }
      return null;
    },
    nodeOf(id) {
      for (const [e, i] of ids) if (i === id) return e;
      return null;
    },
  };
  body.rect = { left: 0, top: 0, width: 400, height: 800 };
  return { doc, el, body, rec, ids };
}

const VIEW = { left: 0, top: 0, width: 400, height: 800 };

describe("REQ-371 (demo m10, cycle 2) — the customer's anchor skips the demo's own chrome", () => {
  test("a point under the pill names the page's row under it, not an ancestor's box", () => {
    const { el, body, rec, ids } = page();
    // what elementsFromPoint gives at (200, 250): the pill on top, then the row, the list, body
    const stack = [el("pilltext"), el("pill"), el("two"), el("list"), body];
    const a = m.anchorAt({ x: 200, y: 250 }, VIEW, stack, rec, "L1");
    expect(a.n?.id).toBe(ids.get(el("two")));
    expect(a.n?.x).toBeCloseTo(0.5);
    expect(a.n?.y).toBeCloseTo(0.5);
    expect(a.n?.l).toBe("L1");
    expect(a.vx).toBeCloseTo(0.5);
    expect(a.vy).toBeCloseTo(250 / 800);
  });

  test("nothing of the page under the point: the fraction of the viewport only", () => {
    const { el, rec } = page();
    const a = m.anchorAt(
      { x: 40, y: 80 },
      VIEW,
      [el("pilltext"), el("pill")],
      rec,
      "L1",
    );
    expect(a.n).toBeUndefined();
    expect(a.vx).toBeCloseTo(0.1);
    expect(a.vy).toBeCloseTo(0.1);
  });

  test("no recorder yet: the fraction only", () => {
    const { el } = page();
    const a = m.anchorAt({ x: 200, y: 150 }, VIEW, [el("one")], null, null);
    expect(a.n).toBeUndefined();
  });

  test("pageTopAt: the first element of the stack outside every [data-demo-overlay]", () => {
    const { el, body } = page();
    expect(m.pageTopAt([el("pilltext"), el("pill"), el("one"), body])).toBe(
      el("one"),
    );
    expect(m.pageTopAt([el("pilltext"), el("pill")])).toBeNull();
    expect(m.pageTopAt([])).toBeNull();
  });
});

describe("REQ-371 (demo m10, cycle 2) — the stage's click wave follows its node (REQ-546: while it is there)", () => {
  test("a wave whose frame was refitted is placed again; one whose frame did not move keeps its array", () => {
    const a: Anchor = {
      vx: 0.5,
      vy: 0.5,
      n: { id: 3, x: 0.5, y: 0.5, l: "L" },
    };
    const box = { left: 0, top: 0, width: 100, height: 100 };
    const at = { x: 10, y: 20 };
    const f = { box, load: "L", nodeAt: () => at };
    const waves = [m.newStageWave(1, a, f)];
    expect(m.placeWavesAgain(waves, f)).toBe(waves);
    // the stage resized: the frame (and the node in it) moved 100 px down
    const moved = m.placeWavesAgain(waves, {
      box: { ...box, top: 100 },
      load: "L",
      nodeAt: () => ({ x: 10, y: 120 }),
    });
    expect(moved).not.toBe(waves);
    expect(moved[0]).toMatchObject({ id: 1, x: 10, y: 120, a });
  });
});

describe("REQ-371 (demo m10, cycle 2) — a last touch fades instead of reading as a hover", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("TOUCH_REST_MS is a few seconds", () => {
    expect(m.TOUCH_REST_MS).toBeGreaterThanOrEqual(1_500);
    expect(m.TOUCH_REST_MS).toBeLessThanOrEqual(6_000);
  });

  test("a touch fades after TOUCH_REST_MS; another touch restarts the wait", () => {
    const fade = jest.fn();
    const f = m.createTouchFade({ ms: 3_000, fade });
    f.seen("touch");
    jest.advanceTimersByTime(2_000);
    f.seen("touch");
    jest.advanceTimersByTime(2_000);
    expect(fade).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(fade).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10_000);
    expect(fade).toHaveBeenCalledTimes(1);
  });

  test("a mouse or pen pointer is never faded, and cancels a pending touch fade", () => {
    const fade = jest.fn();
    const f = m.createTouchFade({ ms: 3_000, fade });
    f.seen("mouse");
    f.seen("pen");
    jest.advanceTimersByTime(10_000);
    expect(fade).not.toHaveBeenCalled();
    f.seen("touch");
    f.seen("mouse");
    jest.advanceTimersByTime(10_000);
    expect(fade).not.toHaveBeenCalled();
    f.seen("touch");
    f.cancel();
    jest.advanceTimersByTime(10_000);
    expect(fade).not.toHaveBeenCalled();
  });
});

describe("REQ-371 (demo m10, cycle 2) — the islands are wired to it", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stage = read("front-end/islands/DemoStage.tsx");

  test("the customer's overlay anchors from the hit-test stack through anchorAt", () => {
    expect(overlay).toMatch(/anchorAt\(/);
    expect(overlay).toMatch(/document\.elementsFromPoint\(p\.x, p\.y\)/);
    expect(overlay).not.toMatch(/recorder\.idOf\(document\.elementFromPoint/);
  });

  test("the customer's overlay fades a touch pointer: leave after the last touch", () => {
    expect(overlay).toMatch(/createTouchFade\(/);
    expect(overlay).toMatch(/TOUCH_REST_MS/);
    expect(overlay).toMatch(/\.seen\(e\.pointerType\)/);
  });

  test("the stage keeps each click wave's anchor and places it again on a layout pass", () => {
    // REQ-546 — made by newStageWave, which keeps the anchor (and freezes where it was placed)
    expect(stage).toMatch(/newStageWave\(id, m\.a, waveFrame\(\)\)/);
    const replace = stage.slice(stage.indexOf("const replace = () => {"));
    expect(replace.slice(0, replace.indexOf("\n  };"))).toMatch(
      /placeWavesAgain\(/,
    );
  });
});
