/**
 * REQ-835 — demo-loop cycle dm2, issues m2 + M2 (amends REQ-816 / REQ-228 / REQ-822).
 *
 * m2: the stage's copy of the customer's open End question used an OLD position. `sendPill` built
 * its rect from `atRef` (left/top, written only by `place()`, which REQ-300 freezes while End asks)
 * plus the live size, and REQ-816's clamp moved the pill with `setDock` without touching `atRef`.
 * From the right-edge peek (atRef.left 818) the 771 px asking pill was sent as 818..1589 and the
 * stage cut it at the frame edge with "…"; on a 390 phone the old top ran past the bottom. And the
 * ghost was `white-space:nowrap` with no wrap, so it could never draw the phone's 2-3 rows.
 *
 * M2: a resize while End asks left the pill where it was at 1280 px (x 611 → 977 on a 390 window):
 * REQ-816's clamp ran only when `asking` flipped and `place()` returned before re-placing.
 */
// REVISION (demo-loop run 16, by hand): the asking branch records the asking form's size first (REQ-820 AMENDMENT 5).
import * as fs from "fs";
import * as path from "path";
import {
  askDock,
  ghostFlow,
  keepInView,
  peekBox,
  PILL_BAND_GAP,
  PILL_MARGIN,
  pillHome,
  pillRestBox,
  pillShowsAtOnce,
  placePill,
  tabBox,
  translateOf,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

type Rect = { left: number; top: number; width: number; height: number };
type Dock = { x: number; y: number };

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(b, i + a.length);
  expect(j).toBeGreaterThan(i);
  return s.slice(i, j);
};

/** what the browser lays out for the customer's pill: `left:12px` + its foot PILL_BAND_GAP above
 *  the visible bottom, shifted by `translate(dock)` */
const laidOut = (
  view: { w: number; h: number },
  dock: Dock,
  size: { w: number; h: number },
): Rect => ({
  left: PILL_MARGIN + dock.x,
  top: view.h - PILL_BAND_GAP - size.h + dock.y,
  width: size.w,
  height: size.h,
});

/** the peek out of the right-edge mini-pill, as the demo saw it (818 at 1280 for a 462 px pill) */
function rightPeek(
  view: { w: number; h: number },
  rest: { w: number; h: number },
) {
  const home = pillHome({ view, size: rest }).box;
  const p = placePill({
    home,
    view,
    dialog: false,
    yields: true,
    blocked: () => 1,
    controls: (r) => (r.left === 0 ? 1 : 0),
  });
  expect(p.tucked).toBe(true);
  const peek = peekBox({ home, tab: p.box, edge: tabBox(home), view });
  return {
    peek,
    dock: {
      x: Math.round(peek.left - home.left),
      y: Math.round(peek.top - home.top),
    },
  };
}

describe("REQ-835 (demo-loop cycle dm2, m2 + M2) — the open End question: one real box, kept in view", () => {
  test("REQ-835 m2: opened from the right-edge peek, the rect sent to the stage is the pill's real (bounding) box — not atRef's old left with the new width", () => {
    const view = { w: 1280, h: 800 };
    const { peek, dock } = rightPeek(view, { w: 462, h: 43 });
    // REQ-849 (cycle dm3, p14) — PILL_MARGIN in from the right edge (was 818, flush)
    expect(peek.left).toBe(806);
    // atRef as place() left it: the peek, before the question (REQ-300 froze it there)
    const at = { left: peek.left, top: peek.top };
    const asking = { w: 771, h: 43 };
    // the clamp moves the dock so the asking pill fits
    const next = askDock({ view, dock, size: asking });
    expect(next.dock).not.toBe(dock);
    // mid-glide (computed translate still the old dock) and at rest, the box sent is the same:
    // the box the pill is coming to rest in, which is what the browser lays out at rest
    const rest = laidOut(view, next.dock, asking);
    const mid = laidOut(view, dock, asking);
    const sentMid = pillRestBox(mid, dock, next.dock);
    const sentRest = pillRestBox(rest, next.dock, next.dock);
    expect(sentRest).toEqual(rest);
    expect(sentMid).toEqual(rest);
    expect(sentRest).toEqual({
      ...next.fit,
      left: next.fit.left,
      top: next.fit.top,
    });
    // inside the customer's window, so the stage never cuts it at the frame edge
    expect(sentRest.left + sentRest.width).toBeLessThanOrEqual(
      view.w - PILL_MARGIN,
    );
    // the old rect (the bug): atRef's left + the live width, 818..1589 (806..1577 since REQ-849's margin)
    expect(at.left + asking.w).toBe(1577);
    expect(sentRest.left).not.toBe(at.left);
  });

  test("REQ-835 m2: on a 390 phone the taller wrapped pill is sent at its real top (it grows upward), not the old compact top", () => {
    const view = { w: 390, h: 844 };
    const dock = { x: 0, y: 0 };
    const compact = laidOut(view, dock, { w: 300, h: 43 });
    const asking = { w: 366, h: 111 };
    const next = askDock({ view, dock, size: asking });
    const real = laidOut(view, next.dock, asking);
    const sent = pillRestBox(real, next.dock, next.dock);
    expect(sent.top + sent.height).toBe(view.h - PILL_BAND_GAP);
    expect(sent.top).toBeLessThan(compact.top);
    expect(sent.top + sent.height).toBeLessThanOrEqual(view.h);
  });

  test("REQ-835 M2: asking, the window narrows 1280 → 390 — the dock pulls the pill's right edge to ≤ 390 − 12", () => {
    const desk = { w: 1280, h: 800 };
    // at 1280, placed from the top-right spot (as demo 1 saw: y 24.6), flush with the margin
    const size1280 = { w: 657, h: 43 };
    const dock = { x: 599, y: -(desk.h - PILL_BAND_GAP - size1280.h - 25) };
    const at1280 = askDock({ view: desk, dock, size: size1280 });
    // REQ-300: it fits, so nothing moves (the same dock, the same object)
    expect(at1280.dock).toBe(dock);
    // the window narrows: capped at 100vw − 24 it is 366 wide, two rows, same dock — off-screen
    const phone = { w: 390, h: 800 };
    const size390 = { w: 366, h: 74 };
    const before = laidOut(phone, dock, size390);
    expect(before.left).toBe(611);
    expect(before.left + before.width).toBe(977);
    const after = askDock({ view: phone, dock, size: size390 });
    const box = laidOut(phone, after.dock, size390);
    expect(box.left + box.width).toBeLessThanOrEqual(phone.w - PILL_MARGIN);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(PILL_MARGIN);
    expect(after.fit).toEqual(box);
  });

  test("REQ-835 REQ-300 still holds: an asking pill that fits keeps its dock (askDock returns the same one)", () => {
    const view = { w: 1280, h: 800 };
    const dock = { x: 0, y: 0 };
    const r = askDock({ view, dock, size: { w: 657, h: 43 } });
    expect(r.dock).toBe(dock);
    expect(r.fit).toEqual(
      keepInView(laidOut(view, dock, { w: 657, h: 43 }), view),
    );
  });

  test("REQ-835 translateOf reads the computed transform (none, matrix, matrix3d)", () => {
    expect(translateOf("none")).toEqual({ x: 0, y: 0 });
    expect(translateOf("")).toEqual({ x: 0, y: 0 });
    expect(translateOf("matrix(1, 0, 0, 1, 599.5, -731)")).toEqual({
      x: 599.5,
      y: -731,
    });
    expect(
      translateOf(
        "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, -12, 0, 1)",
      ),
    ).toEqual({ x: 40, y: -12 });
  });

  test("REQ-835 m2: the face carries `wraps` (the customer's pillWraps); the wire keeps a boolean and drops junk; a wraps flip with the question shows at once", () => {
    const m = parsePeerMessage({
      k: "pill",
      r: { left: 1, top: 2, width: 3, height: 4 },
      wraps: true,
    });
    expect(m && m.k === "pill" && m.wraps).toBe(true);
    const junk = parsePeerMessage({
      k: "pill",
      r: { left: 1, top: 2, width: 3, height: 4 },
      wraps: "yes",
    });
    expect(junk && junk.k === "pill" && "wraps" in junk).toBe(false);
    expect(
      pillShowsAtOnce(
        { compact: true, status: "live", text: "x" },
        {
          compact: true,
          status: "live",
          text: "x",
          asking: true,
          ask: "End?",
          wraps: true,
        },
      ),
    ).toBe(true);
  });

  test("REQ-835 m2: ghostFlow — a wrapping ghost wraps into rows with normal white-space and its words never shrink to slivers; a one-row ghost stays nowrap", () => {
    const w = ghostFlow(true);
    expect(w.box).toMatch(/flex-wrap:wrap/);
    expect(w.box).toMatch(/white-space:normal/);
    expect(w.text).not.toMatch(/min-width:0/);
    expect(w.text).not.toMatch(/text-overflow:ellipsis/);
    // REQ-851 (dm3, p3) amends: the question GROUP (question + answers) takes the row, as
    // EndDemo's ownRow does — not the question alone with its answers under it
    expect(w.ask).toMatch(/flex:0 1 100%/);
    expect(w.ask).toMatch(/flex-wrap:wrap/);
    const one = ghostFlow(false);
    expect(one.box).toMatch(/white-space:nowrap/);
    expect(one.box).not.toMatch(/flex-wrap:wrap/);
    expect(one.text).toMatch(/min-width:0/);
  });

  describe("REQ-835 the islands' wiring", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const s = read("front-end/islands/DemoStage.tsx");

    test("sendPill sends the pill's real box (getBoundingClientRect, less the glide still to go) and again when the glide ends", () => {
      const send = between(
        o,
        "const sendPill = () => {",
        "sendPillRef.current = sendPill;",
      );
      expect(send).toMatch(/getBoundingClientRect\(\)/);
      expect(send).toMatch(/pillRestBox\(/);
      expect(send).toMatch(/translateOf\(/);
      expect(send).not.toMatch(
        /left: at\.left,\s*top: at\.top,\s*width: at\.tab \? PILL_TAB\.w : el\.offsetWidth/,
      );
      expect(send).toMatch(/wraps: f\.wraps/);
      expect(o).toMatch(/addEventListener\("transitionend", sendPill\)/);
      expect(o).toMatch(/removeEventListener\("transitionend", sendPill\)/);
    });

    test("the clamp is one function: the [asking] layout effect, place()'s asking branch and the resize all run it", () => {
      const clamp = between(o, "const clampAsk = () => {", "\n  };");
      expect(clamp).toMatch(/askDock\(/);
      expect(clamp).toMatch(/offsetWidth/);
      expect(clamp).toMatch(
        /atRef\.current = \{ left: fit\.left, top: fit\.top, tab: false \}/,
      );
      const place = between(
        o,
        "const place = () => {",
        "setCompact(isNarrow());",
      );
      expect(place).toMatch(
        /querySelector\('\[data-cy="demo-end-ask"\]'\)\) \{\s*(?:\/\/[^\n]*\n\s*)*(?:sizedRef\.current = \{[^}]*\};\s*)?clampAsk\(\);\s*sendPill\(\);\s*return;/,
      );
      const effect = o.match(
        /useLayoutEffect\(\(\) => \{\s*if \(!asking\) return;[\s\S]*?\}, \[asking\]\);/,
      );
      expect(effect).not.toBeNull();
      expect(effect![0]).toMatch(/clampAsk\(\)/);
      expect(effect![0]).toMatch(/requestAnimationFrame\(clampAsk\)/);
      const resize = between(o, "const onResize = () => {", "\n    };");
      expect(resize).toMatch(/requestAnimationFrame\(/);
      expect(resize).toMatch(/clampAsk\(\)/);
    });

    test("the face says whether the pill wraps, and the stage's ghost lays out by it", () => {
      const face = between(o, "faceRef.current = {\n    compact,", "\n  };");
      expect(face).toMatch(/wraps: pillWraps\(\{ compact, open: shownOpen, asking \}\)/);
      const ghost = between(
        s,
        'data-cy="demo-pill-ghost"',
        'data-cy="demo-pill-ghost-clipped"',
      );
      expect(s).toMatch(/ghostFlow\(pillFace\.wraps === true\)/);
      expect(ghost).toMatch(/flow\.box/);
      expect(ghost).toMatch(/flow\.text/);
      expect(ghost).toMatch(/flow\.part/);
      expect(ghost).toMatch(/flow\.ask/);
      expect(between(s, "const faceOf = (m: PillMsg)", "const showPill"))
        .toMatch(/\bwraps: m\.wraps\b/);
    });
  });
});
