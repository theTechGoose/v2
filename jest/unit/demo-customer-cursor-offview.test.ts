/**
 * REQ-850 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm3 (run r02524ccd), issue p10: "After the customer narrows the window, the
 * stage draws the customer's cursor past the frame's edge; its label turns from ML to the full
 * name" (fleet-3: last mouse x ≈ 1200, the stage drew it at x ≈ 800, past the frame's right edge
 * 799; the tag flipped from "ML" to "Maria Lopez").
 *
 * RCA (at 5fef7e6d): a resize ran the overlay's replace(), which re-sent the resting pointer — now
 * outside her narrowed viewport — as a fraction CLAMPED to vx = 1 (no leave); the stage placed
 * vx = 1 on the frame's right edge, which placeIn counts as inside, so the 24 px arrow hung past
 * the frame; and DemoPointer reset the tag's idle state on every new pointer object, even a
 * re-send to the same spot.
 */
import * as fs from "fs";
import * as path from "path";
import { inViewport } from "../../front-end/lib/demo-mode/pointer-anchor";
import {
  ARROW_BOX,
  idleKey,
  placeAnchorIn,
} from "../../shared/demo-mode/motion";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const view = { left: 0, top: 0, width: 390, height: 844 };

describe("REQ-850 (demo-loop cycle dm3, p10) a cursor outside the customer's window is not on her screen", () => {
  test("inViewport: a point of her window is in; one past its right/bottom edge (the old x 1200 after narrowing) is not", () => {
    expect(inViewport({ x: 10, y: 10 }, view)).toBe(true);
    expect(inViewport({ x: 0, y: 0 }, view)).toBe(true);
    expect(inViewport({ x: 389, y: 843 }, view)).toBe(true);
    expect(inViewport({ x: 1200, y: 400 }, view)).toBe(false);
    expect(inViewport({ x: 390, y: 400 }, view)).toBe(false);
    expect(inViewport({ x: 100, y: 844 }, view)).toBe(false);
    expect(inViewport({ x: -1, y: 10 }, view)).toBe(false);
    expect(inViewport({ x: 10, y: -1 }, view)).toBe(false);
  });

  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const replace = overlay.slice(
    overlay.indexOf("const replace = () => {"),
    overlay.indexOf("const shifted = () => {"),
  );

  test("the overlay's replace() (a resize, a scroll) sends leave and forgets a resting pointer that is no longer in her viewport — never a clamped fraction", () => {
    expect(replace.length).toBeGreaterThan(0);
    expect(replace).toMatch(/inViewport\(rest, viewportBox\(\)\)/);
    const off = replace.slice(replace.indexOf("inViewport(rest"));
    expect(off).toMatch(/dropRest\(\)/);
    // the leave comes BEFORE any re-send of the rest
    expect(replace.indexOf("inViewport(rest")).toBeLessThan(
      replace.indexOf("throttle.push(rest)"),
    );
    const drop = overlay.slice(
      overlay.indexOf("const dropRest = () => {"),
      overlay.indexOf("const dropRest = () => {") + 600,
    );
    expect(drop).toMatch(/lastMoveRef\.current = null/);
    expect(drop).toMatch(/sentRef\.current = null/);
    expect(drop).toMatch(/send\(\{ k: "leave" \}\)/);
  });

  test("the throttle's (trailing) send and resendPointer never send a point outside her viewport as a move", () => {
    const thr = overlay.slice(
      overlay.indexOf("const throttle = useMemo(() =>"),
      overlay.indexOf(
        "}), []);",
        overlay.indexOf("const throttle = useMemo(() =>"),
      ),
    );
    expect(thr).toMatch(/inViewport\(\{ x, y \}, viewportBox\(\)\)/);
    expect(thr).toMatch(/dropRest\(\)/);
    const resend = overlay.slice(
      overlay.indexOf("const resendPointer = () => {"),
      overlay.indexOf("const throttle = useMemo(() =>"),
    );
    expect(resend).toMatch(/inViewport\(p, viewportBox\(\)\)/);
  });
});

describe("REQ-850 (demo-loop cycle dm3, p10) the stage never draws a fraction-only anchor at her window's far edge past the frame", () => {
  // demo-report 3a: the frame is 481–799 wide on the stage
  const frame = { left: 481, top: 100, width: 318, height: 690 };
  const toStage = (a: { vx: number; vy: number }) => ({
    x: frame.left + a.vx * frame.width,
    y: frame.top + a.vy * frame.height,
  });

  test("vx = 1 with no node (a clamped fraction): the whole arrow is inside the frame, marked outside", () => {
    const a = { vx: 1, vy: 0.4 };
    const p = placeAnchorIn(a, toStage(a), frame, ARROW_BOX);
    expect(p.at.x + ARROW_BOX.w).toBeLessThanOrEqual(frame.left + frame.width);
    expect(p.outside).toBe(true);
  });

  test("vy = 1 with no node: the whole arrow is inside the frame, marked outside", () => {
    const a = { vx: 0.5, vy: 1 };
    const p = placeAnchorIn(a, toStage(a), frame, ARROW_BOX);
    expect(p.at.y + ARROW_BOX.h).toBeLessThanOrEqual(frame.top + frame.height);
    expect(p.outside).toBe(true);
  });

  test("a point inside her window is drawn where it is; an anchor with a node, and REQ-393's off anchor, as before", () => {
    const a = { vx: 0.5, vy: 0.5 };
    expect(placeAnchorIn(a, toStage(a), frame, ARROW_BOX)).toEqual({
      at: toStage(a),
      outside: false,
    });
    const n = { vx: 1, vy: 0.5, n: { id: 3, x: 1, y: 0.5, l: "L" } };
    expect(placeAnchorIn(n, toStage(n), frame, ARROW_BOX).outside).toBe(false);
    const o = { vx: 0.2, vy: 0.3, o: 1 as const };
    expect(placeAnchorIn(o, toStage(o), frame, ARROW_BOX).outside).toBe(true);
  });

  test("DemoStage places every customer anchor through placeAnchorIn", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /const placeOnStage = \(a: Anchor\) =>\s*placeAnchorIn\(a, toStage\(a\), fitBox\(\), ARROW_BOX\)/,
    );
  });
});

describe("REQ-850 (demo-loop cycle dm3, p10) a re-send to the same spot does not wake the tag (ML stays ML)", () => {
  test("idleKey: the same x/y in a new object is the same key; a new x/y, an edge toggle, or no pointer is a new one", () => {
    expect(idleKey({ x: 10, y: 20 }, false)).toBe(
      idleKey({ x: 10, y: 20 }, false),
    );
    expect(idleKey({ x: 10, y: 20 }, false)).not.toBe(
      idleKey({ x: 11, y: 20 }, false),
    );
    expect(idleKey({ x: 10, y: 20 }, false)).not.toBe(
      idleKey({ x: 10, y: 21 }, false),
    );
    expect(idleKey({ x: 10, y: 20 }, false)).not.toBe(
      idleKey({ x: 10, y: 20 }, true),
    );
    expect(idleKey(null, false)).toBe("");
  });

  test("DemoPointer's idle effect is keyed on idleKey(pointer, outside), not on the pointer object", () => {
    const src = read("front-end/components/demo-mode/DemoPointer.tsx");
    const fx = src.slice(
      src.indexOf("const [idle, setIdle] = useState(false);"),
      src.indexOf("const look = pointerLook(idle);"),
    );
    expect(fx).toMatch(/\}, \[idleKey\(pointer, outside\)\]\);/);
    expect(fx).not.toMatch(/\}, \[pointer, outside\]\);/);
  });
});
