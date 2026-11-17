/**
 * REQ-749 — demo-loop cycle 5v1, issue m57 re-opened by the verifier
 * ("Activity toast link doesn't scroll to Activity and catches clicks").
 *
 * REQ-726 scrolled to #activity once when the panel mounted and once when the
 * lists landed. The verifier's first /dashboard#activity load right after
 * login (1280x720) ended at `.content` scrollTop 410 of max 664, with #activity
 * at top 762: when the island scrolled, the page below the panel was still
 * short (the notifications feed had not filled the Activity panel yet), so
 * scrollIntoView clamped at the then-bottom (410). The feed then grew the page
 * to max 664 and nothing scrolled again. Later loads (warm caches, feed first)
 * reached 664 / top 508 — the same document position, so nothing above moved.
 *
 * Fix: `holdHashTarget` keeps the panel pinned while the layout settles —
 * it re-scrolls on every size change of the scroller's content, until the
 * user takes over (wheel / touch / key / pointer) or a settle window passes.
 */
import * as fs from "fs";
import * as path from "path";
import { holdHashTarget } from "../../front-end/lib/dash-anchor";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Cb = () => void;
class FakeRO {
  static last: FakeRO | null = null;
  observed: unknown[] = [];
  disconnected = false;
  constructor(public cb: Cb) {
    FakeRO.last = this;
  }
  observe(t: unknown) {
    this.observed.push(t);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    if (!this.disconnected) this.cb();
  }
}

function setup() {
  const listeners = new Map<string, Set<Cb>>();
  const child1 = { id: "child1" };
  const child2 = { id: "child2" };
  const scroller = {
    children: [child1, child2],
    addEventListener: jest.fn((t: string, f: Cb) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(f);
    }),
    removeEventListener: jest.fn((t: string, f: Cb) => {
      listeners.get(t)?.delete(f);
    }),
  };
  const el = {
    scrollIntoView: jest.fn(),
    closest: jest.fn((_sel: string) => scroller),
  };
  const doc = { getElementById: jest.fn((_id: string) => el) };
  const emit = (t: string) => listeners.get(t)?.forEach((f) => f());
  return { doc, el, scroller, child1, child2, emit, listeners };
}

describe("REQ-749 m57 (cycle 5v1): /dashboard#activity stays on the Activity panel while the page settles", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeRO.last = null;
  });
  afterEach(() => jest.useRealTimers());

  test("the verifier's race: the page grows after the first scroll (the feed fills the panel) → it scrolls again", () => {
    const f = setup();
    const stop = holdHashTarget(f.doc, "#activity", {
      ResizeObserver: FakeRO,
    });
    expect(stop).not.toBeNull();
    expect(f.el.scrollIntoView).toHaveBeenCalledTimes(1);
    // the scroller's content is watched (every child + the panel itself)
    expect(FakeRO.last!.observed).toEqual(
      expect.arrayContaining([f.child1, f.child2, f.el]),
    );
    // the notifications feed lands: content grows → pinned again
    FakeRO.last!.fire();
    FakeRO.last!.fire();
    expect(f.el.scrollIntoView).toHaveBeenCalledTimes(3);
    expect(f.el.scrollIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    stop!();
  });

  test("the user takes over (wheel, touch, key, pointer) → no more re-scrolls", () => {
    for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      const f = setup();
      holdHashTarget(f.doc, "#activity", { ResizeObserver: FakeRO });
      f.emit(ev);
      FakeRO.last!.fire();
      expect(f.el.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(FakeRO.last!.disconnected).toBe(true);
      expect(f.listeners.get(ev)?.size ?? 0).toBe(0);
    }
  });

  test("the hold ends after the settle window", () => {
    const f = setup();
    holdHashTarget(f.doc, "#activity", {
      ResizeObserver: FakeRO,
      settleMs: 1000,
    });
    jest.advanceTimersByTime(1001);
    FakeRO.last!.fire();
    expect(f.el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(FakeRO.last!.disconnected).toBe(true);
  });

  test("no hash / another hash / no panel yet → null (the caller retries), nothing scrolled", () => {
    const f = setup();
    expect(holdHashTarget(f.doc, "", { ResizeObserver: FakeRO })).toBeNull();
    expect(holdHashTarget(f.doc, "#x", { ResizeObserver: FakeRO })).toBeNull();
    expect(
      holdHashTarget({ getElementById: () => null }, "#activity", {
        ResizeObserver: FakeRO,
      }),
    ).toBeNull();
    expect(f.el.scrollIntoView).not.toHaveBeenCalled();
  });

  test("DashboardPage holds the panel (holdHashTarget) and releases it on unmount", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).toMatch(/holdHashTarget\(/);
    expect(src).toMatch(/useRef/);
  });
});
