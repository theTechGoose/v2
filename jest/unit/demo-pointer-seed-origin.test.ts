/**
 * REQ-539 — demo issue m24 (demo-loop cycle 4): "Presenter pointer appears at a left-over spot when
 * demo starts". Amends REQ-393 / REQ-451: the cursor handed over to the stage is tagged with the
 * page it came from.
 *
 * The hand-off from /admin (the click on Demo) says where his mouse IS, not what he means to show:
 * for a desktop customer the fitted frame covers most of the stage, so the Demo button's spot fell
 * on the frame and the customer's arrow sat on her mic or Send button at the start of the demo
 * (pairs 7, 8, 10). Only the stage's own hand-off (its `pagehide`, a reload: the same page, the
 * same spot) is pushed to the customer; /admin's is used only for the stage's on/off-frame hint,
 * and nothing reaches their screen until he makes a real pointer move.
 *
 *   - `cursor-handoff`: a hand-off carries its source (`from`: "admin" | "stage"); an untagged one
 *     (an older page) is /admin's — never pushed;
 *   - `seedUse` (shared/demo-mode/presenter-anchor.ts): a stage hand-off on the fitted frame is
 *     sent; beside it, nothing (REQ-451); an /admin hand-off — on the frame or beside it — is a
 *     hint only, never sent;
 *   - wiring: the stage hands its own over as "stage", the overlay's placePresenter as "admin";
 *     `takeSeed` pushes only a seed `seedUse` says to send, and a hint never becomes `lastMoveRef`.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type From = "admin" | "stage";
type Seed = Pt & { from: From };

// looked up at run time: a missing export fails its own tests, not the whole file
const handoff = () =>
  require("../../front-end/lib/demo-mode/cursor-handoff") as {
    CURSOR_KEY: string;
    handCursor(store: unknown, p: Pt | null, now?: number, from?: From): void;
    takeCursor(store: unknown, now?: number): Seed | null;
  };
const pa = () =>
  require("../../shared/demo-mode/presenter-anchor") as {
    seedUse(
      seed: Seed | null,
      frame: Box,
    ): { at: Pt; send: boolean } | null;
  };

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("REQ-539 the cursor hand-off says which page handed it over (m24)", () => {
  test("the stage's own hand-off (pagehide, a reload) comes back tagged 'stage'", () => {
    const { handCursor, takeCursor } = handoff();
    const s = memStore();
    handCursor(s, { x: 610, y: 145 }, 1_000, "stage");
    expect(takeCursor(s, 2_000)).toEqual({ x: 610, y: 145, from: "stage" });
  });
  test("/admin's hand-off (the click on Demo) comes back tagged 'admin' — and so does one with no tag", () => {
    const { handCursor, takeCursor, CURSOR_KEY } = handoff();
    const s = memStore();
    handCursor(s, { x: 1150, y: 595 }, 1_000, "admin");
    expect(takeCursor(s, 2_000)).toEqual({ x: 1150, y: 595, from: "admin" });
    handCursor(s, { x: 1150, y: 595 }, 1_000);
    expect(takeCursor(s, 2_000)).toEqual({ x: 1150, y: 595, from: "admin" });
    // an older page's untagged entry, or a junk tag: /admin's — the one never pushed
    s.map.set(CURSOR_KEY, JSON.stringify({ x: 5, y: 6, at: 1_000 }));
    expect(takeCursor(s, 2_000)).toEqual({ x: 5, y: 6, from: "admin" });
    s.map.set(
      CURSOR_KEY,
      JSON.stringify({ x: 5, y: 6, at: 1_000, from: "elsewhere" }),
    );
    expect(takeCursor(s, 2_000)).toEqual({ x: 5, y: 6, from: "admin" });
  });
});

describe("REQ-539 seedUse: only the stage's own hand-off on the frame is where he points; /admin's is a hint only (m24)", () => {
  // a desktop customer (1280 × 720) fitted on a 1280 × 860 stage at ~0.8: most of the stage
  const desktop: Box = { left: 128, top: 90, width: 1024, height: 576 };
  // a phone frame in the middle of a 1280 px stage
  const phone: Box = { left: 472, top: 16, width: 337, height: 729 };
  test("the demo's case: /admin's Demo button falls on a desktop customer's frame (her mic button) — a hint, never sent", () => {
    expect(pa().seedUse({ x: 1100, y: 560, from: "admin" }, desktop)).toEqual({
      at: { x: 1100, y: 560 },
      send: false,
    });
  });
  test("/admin's hand-off beside a phone frame: a hint (the stage may say he is off their screen), never sent", () => {
    expect(pa().seedUse({ x: 1024, y: 479, from: "admin" }, phone)).toEqual({
      at: { x: 1024, y: 479 },
      send: false,
    });
  });
  test("the stage's own hand-off (a reload) on the frame: sent — the same page, the same spot", () => {
    expect(pa().seedUse({ x: 640, y: 400, from: "stage" }, phone)).toEqual({
      at: { x: 640, y: 400 },
      send: true,
    });
    expect(pa().seedUse({ x: 1100, y: 560, from: "stage" }, desktop))
      .toEqual({ at: { x: 1100, y: 560 }, send: true });
  });
  test("the stage's own hand-off beside the frame, or nothing handed over: nothing (REQ-451)", () => {
    expect(pa().seedUse({ x: 1024, y: 479, from: "stage" }, phone)).toBeNull();
    expect(pa().seedUse(null, phone)).toBeNull();
  });
});

describe("REQ-539 the wiring: the stage pushes only a stage hand-off; the overlay tags its own 'admin' (m24)", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const fn = (name: string) => {
    const at = stage.indexOf(`const ${name} = `);
    if (at < 0) throw new Error(`no ${name} in DemoStage.tsx`);
    return stage.slice(at, stage.indexOf("\n  };", at));
  };
  test("the stage hands its own over tagged 'stage' on its way out", () => {
    expect(stage).toMatch(
      /const hand = \(\) =>\s*handCursor\(sessionStore\(\), lastMoveRef\.current, Date\.now\(\), "stage"\)/,
    );
  });
  test("placePresenter hands /admin's over tagged 'admin'", () => {
    expect(overlay).toMatch(
      /handCursor\(sessionStore\(\), cursorRef\.current, Date\.now\(\), "admin"\)/,
    );
  });
  test("takeSeed goes through seedUse: a hint sets only the hint point (no lastMoveRef, no push); only a seed to send is pushed", () => {
    const take = fn("takeSeed");
    expect(take).toMatch(/seedUse\(s, fitBox\(\)\)/);
    expect(take).not.toMatch(/seedOn\(/);
    expect(take).toMatch(
      /if \(!use\.send\) \{\s*hintRef\.current = use\.at;\s*markOff\(\);\s*return;\s*\}/,
    );
    const hintAt = take.indexOf("if (!use.send)");
    const push = take.indexOf("throttle.push(");
    const last = take.indexOf("lastMoveRef.current = use.at");
    expect(hintAt).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(hintAt);
    expect(last).toBeGreaterThan(hintAt);
  });
  test("the off hint reads his mouse, or else /admin's hint; a real pointer event or leaving the window drops the hint", () => {
    expect(fn("markOff")).toMatch(
      /const p = lastMoveRef\.current \?\? hintRef\.current;/,
    );
    const at = stage.slice(stage.indexOf("const at = (e: PointerEvent) => {"));
    expect(at.slice(0, at.indexOf("\n    };"))).toMatch(
      /hintRef\.current = null;/,
    );
    const gone = stage.slice(stage.indexOf("const gone = () => {"));
    expect(gone.slice(0, gone.indexOf("\n    };"))).toMatch(
      /hintRef\.current = null;/,
    );
  });
});
