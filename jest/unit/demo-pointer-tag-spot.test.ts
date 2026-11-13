/**
 * REQ-437 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 3 (run re05e1cbb), issues m3 ("Pointer name tags cover the element they point
 * at": 'Alex' over 'Continuar', 'Tom Baker' over 'Lock it in') and p8-pair3-a ("'Alex' pointer
 * label clipped to 'ex' at the left edge").
 *
 * RCA: REQ-374 put the tag above-left of the tip with a 6 px gap, from the point alone — over the
 * upper-left of any control hovered near its centre; its side was picked from the glide TARGET
 * while the arrow is drawn at the gliding position, and its width was a guess.
 *
 * Now `tagPlacement(tip, box, tag, rect)` returns the tag's own top-left: past the edge of the
 * anchored element's rect with the most room, else below-right past the arrow's tail; always
 * clamped inside the box. DemoPointer runs it on every painted frame (the DRAWN position), with
 * the tag's measured size, and marks the side on `data-tag-side`.
 */
import * as fs from "fs";
import * as path from "path";
import * as motion from "../../shared/demo-mode/motion";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// deno-lint-ignore no-explicit-any
const { tagPlacement, ARROW_BOX } = motion as
  & typeof motion
  & Record<string, any>;

interface R {
  left: number;
  top: number;
  width: number;
  height: number;
}
const overlaps = (a: R, b: R) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const inside = (a: R, box: R) =>
  a.left >= box.left - 0.01 && a.top >= box.top - 0.01 &&
  a.left + a.width <= box.left + box.width + 0.01 &&
  a.top + a.height <= box.top + box.height + 0.01;
const tagRect = (
  tip: { x: number; y: number },
  box: R,
  tag: { w: number; h: number },
  rect?: R | null,
): R & { side: string } => {
  const s = tagPlacement(tip, box, tag, rect);
  return { left: s.x, top: s.y, width: tag.w, height: tag.h, side: s.side };
};
const arrowAt = (tip: { x: number; y: number }): R => ({
  left: tip.x,
  top: tip.y,
  width: ARROW_BOX.w,
  height: ARROW_BOX.h,
});

describe("REQ-437 (demo m3 + p8-pair3-a, cycle 3) the pointer's name tag sits outside what it points at, inside its box", () => {
  const win: R = { left: 0, top: 0, width: 1280, height: 800 };
  const alex = { w: 48, h: 22 };
  const tom = { w: 86, h: 22 };

  test("m3: a 40 px button hovered at its centre ('Alex' over 'Continuar') — the tag is off the button and off the arrow", () => {
    const button: R = { left: 560, top: 380, width: 160, height: 40 };
    const tip = { x: 640, y: 400 };
    const t = tagRect(tip, win, alex, button);
    expect(overlaps(t, button)).toBe(false);
    expect(overlaps(t, arrowAt(tip))).toBe(false);
    expect(inside(t, win)).toBe(true);
  });

  test("m3: a full-width sidebar row at the left edge ('Roles', 'Subscriptions') — the tag covers neither the row nor the window's edge", () => {
    const row: R = { left: 0, top: 220, width: 240, height: 36 };
    const tip = { x: 120, y: 238 };
    const t = tagRect(tip, win, tom, row);
    expect(overlaps(t, row)).toBe(false);
    expect(inside(t, win)).toBe(true);
  });

  test("a button at the window's bottom puts the tag above it; at the top, below it (REQ-543: the nearest free side within reach, no longer the roomiest)", () => {
    const low: R = { left: 600, top: 760, width: 120, height: 36 };
    const a = tagRect({ x: 660, y: 778 }, win, tom, low);
    expect(a.side).toBe("above");
    expect(a.top + a.height).toBeLessThanOrEqual(low.top);
    const high: R = { left: 600, top: 4, width: 120, height: 36 };
    const b = tagRect({ x: 660, y: 22 }, win, tom, high);
    expect(b.side).toBe("below");
    expect(b.top).toBeGreaterThanOrEqual(high.top + high.height);
    expect(overlaps(b, arrowAt({ x: 660, y: 22 }))).toBe(false);
  });

  test("with no element, the tag sits below-right past the arrow's tail (≥ ARROW_H + 6 below the tip), and above it only at the bottom", () => {
    const tip = { x: 400, y: 300 };
    const t = tagRect(tip, win, alex, null);
    expect(t.top).toBeGreaterThanOrEqual(tip.y + ARROW_BOX.h + 6);
    expect(t.left).toBeGreaterThanOrEqual(tip.x);
    expect(overlaps(t, arrowAt(tip))).toBe(false);
    const low = { x: 400, y: 790 };
    const u = tagRect(low, win, alex, null);
    expect(u.top + u.height).toBeLessThanOrEqual(low.y);
    expect(inside(u, win)).toBe(true);
  });

  test("p8-pair3-a: 'Alex' at the window's left edge is never clipped — with or without an element, and at the right edge too", () => {
    for (const x of [0, 2, 8, 30]) {
      const tip = { x, y: 300 };
      expect(tagRect(tip, win, alex, null).left).toBeGreaterThanOrEqual(0);
      const edgeBtn: R = { left: 0, top: 280, width: 70, height: 40 };
      expect(inside(tagRect(tip, win, alex, edgeBtn), win)).toBe(true);
    }
    const right = { x: 1278, y: 300 };
    expect(inside(tagRect(right, win, alex, null), win)).toBe(true);
    // a stage frame that is not the window: clamped into the frame, not the window
    const frame: R = { left: 300, top: 60, width: 420, height: 700 };
    const t = tagRect({ x: 301, y: 400 }, frame, alex, null);
    expect(t.left).toBeGreaterThanOrEqual(frame.left);
  });

  test("whatever the tip and element, a tag that fits the box is drawn inside it", () => {
    const box: R = { left: 40, top: 30, width: 600, height: 500 };
    for (let x = box.left; x <= box.left + box.width; x += 37) {
      for (let y = box.top; y <= box.top + box.height; y += 29) {
        for (
          const rect of [
            null,
            { left: x - 50, top: y - 15, width: 100, height: 30 },
            { left: box.left, top: y - 200, width: box.width, height: 400 },
          ]
        ) {
          const t = tagRect({ x, y }, box, tom, rect);
          expect(inside(t, box)).toBe(true);
        }
      }
    }
  });

  test("the element's box only counts near the tip: an element far bigger than the reach falls back to the tail placement", () => {
    const page: R = { left: 0, top: 0, width: 1280, height: 800 };
    const tip = { x: 640, y: 400 };
    const t = tagRect(tip, win, alex, page);
    expect(t.side).toBe("tail");
    expect(inside(t, win)).toBe(true);
  });

  test("wiring: the tag is placed from the DRAWN glide position every painted frame, with its measured size, and the element's rect travels with the pointer", () => {
    const glide = read("front-end/lib/demo-mode/use-glide.ts");
    // paint() hands every drawn position to the pointer's painter (not only the target)
    expect(glide).toMatch(/const paint = \(p: Pt\) => \{[\s\S]{0,300}onPaint/);
    expect(glide).toMatch(/rect: Rect \| null/);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/data-tag-side/);
    expect(pointer).toMatch(/offsetWidth/);
    expect(pointer).toMatch(/tagPlacement\(/);
    expect(pointer).not.toMatch(
      /name\.length \* 7\.5, h: 22 \};\n\s*const place = pointer\s*\?\s*tagPlacement\(pointer, bounds/,
    );
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/glide\.glideTo\(cmd\.at, cmd\.outside, cmd\.rect\)/);
    expect(peer).toMatch(/rect=\{glide\.rect\}/);
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(/rect: p\.outside \? null : rectOnScreen\(a\)/);
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/rectOnStage\(/);
    expect(stage).toMatch(/rect=\{glide\.rect\}/);
    const replay = read("front-end/lib/demo-mode/mirror-replay.ts");
    expect(replay).toMatch(/rectOf\(\s*a: NodeAnchor,?\s*\)/);
  });
});
