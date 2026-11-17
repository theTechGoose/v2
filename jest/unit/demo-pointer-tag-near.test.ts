/**
 * REQ-543 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4 (run r857a9d67), issue m6 ("Pointer name tags cover targets, drift 60-130 px
 * from arrow, run off edge"): 'Carl' over Cancel ~100 px from the arrow, 'Rosa Delgado' over the
 * option buttons, 'Priya Nair' 60-130 px from her arrow in different directions, 'Alex' flush
 * against the right edge of a 390 px frame (x 350-390).
 *
 * RCA (ad104a19): REQ-437's `tagPlacement` picked the side of the anchored element with the MOST
 * room and accepted any side within TAG_REACH = 140 px of the tip — nearness to the arrow played
 * no part, so the tag landed past the far edge of a card / chip / modal button, over the next
 * control; and fit() clamped it flush to the box with no margin.
 *
 * Now: a candidate side (above, below, right, left, past the arrow's tail) counts only when it
 * covers neither the target nor the arrow, stays inside the box with TAG_EDGE padding and sits
 * within TAG_REACH (≤ 40 px) of the tip; among those, one that covers no OTHER control (the
 * caller's `covers` hit-test) wins, then the nearest. None: the arrow's tail.
 */
import {
  ARROW_BOX,
  TAG_EDGE,
  TAG_REACH,
  tagPlacement,
} from "../../shared/demo-mode/motion";

interface R {
  left: number;
  top: number;
  width: number;
  height: number;
}
const overlaps = (a: R, b: R) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
/** the distance from the tip to the nearest point of the tag's box */
const reach = (tip: { x: number; y: number }, t: R) =>
  Math.hypot(
    Math.max(t.left - tip.x, 0, tip.x - (t.left + t.width)),
    Math.max(t.top - tip.y, 0, tip.y - (t.top + t.height)),
  );
const tagRect = (
  tip: { x: number; y: number },
  box: R,
  tag: { w: number; h: number },
  rect?: R | null,
  covers?: (r: R) => boolean,
): R & { side: string } => {
  const s = tagPlacement(tip, box, tag, rect, covers);
  return { left: s.x, top: s.y, width: tag.w, height: tag.h, side: s.side };
};
const arrowAt = (tip: { x: number; y: number }): R => ({
  left: tip.x,
  top: tip.y,
  width: ARROW_BOX.w,
  height: ARROW_BOX.h,
});
const centre = (r: R) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
/** a hit-test over a list of other controls, as DemoPointer's is over the page */
const coversAny = (others: R[]) => (r: R) => others.some((o) => overlaps(r, o));

describe("REQ-543 (demo m6, cycle 4) the pointer's name tag stays next to its arrow, off other controls, off the box's edge", () => {
  const win: R = { left: 0, top: 0, width: 1280, height: 720 };
  const priya = { w: 18 + "Priya Nair".length * 7.5, h: 22 };
  const alex = { w: 48, h: 22 };

  test("the reach is about 40 px, and the box's edge padding 4-6 px", () => {
    expect(TAG_REACH).toBeLessThanOrEqual(40);
    expect(TAG_EDGE).toBeGreaterThanOrEqual(4);
    expect(TAG_EDGE).toBeLessThanOrEqual(6);
  });

  test("the RCA's four elements (option card, chip, modal button, chat bubble) hovered at their centre: the tag is within reach of the tip and never over the arrow", () => {
    const els: R[] = [
      { left: 440, top: 300, width: 400, height: 110 }, // option card: was left, 119 px
      { left: 560, top: 340, width: 160, height: 40 }, // chip: was right, 86 px
      { left: 700, top: 640, width: 120, height: 40 }, // modal button low: was left, 139 px
      { left: 340, top: 300, width: 600, height: 120 }, // chat bubble: was below, 116 px
    ];
    for (const el of els) {
      const tip = centre(el);
      const t = tagRect(tip, win, priya, el);
      expect({ el, reach: reach(tip, t) <= 40 }).toEqual({ el, reach: true });
      expect(overlaps(t, arrowAt(tip))).toBe(false);
    }
  });

  test("a small control (chip, button) keeps its tag off itself when a side within reach is free", () => {
    const chip: R = { left: 560, top: 340, width: 160, height: 40 };
    const tip = centre(chip);
    const t = tagRect(tip, win, priya, chip);
    expect(overlaps(t, chip)).toBe(false);
    expect(reach(tip, t)).toBeLessThanOrEqual(40);
  });

  test("an element bigger than the reach around the tip (a card): the tag sits at the arrow's tail", () => {
    const card: R = { left: 440, top: 300, width: 400, height: 110 };
    const tip = centre(card);
    const t = tagRect(tip, win, priya, card);
    expect(t.side).toBe("tail");
    expect(t.top).toBeGreaterThanOrEqual(tip.y + ARROW_BOX.h);
  });

  test("'Carl over Cancel': on a modal's OK button the tag covers neither OK nor Cancel beside it", () => {
    const cancel: R = { left: 570, top: 600, width: 120, height: 40 };
    const ok: R = { left: 700, top: 600, width: 120, height: 40 };
    const tip = centre(ok);
    const t = tagRect(tip, win, { w: 48, h: 22 }, ok, coversAny([cancel]));
    expect(overlaps(t, ok)).toBe(false);
    expect(overlaps(t, cancel)).toBe(false);
    expect(reach(tip, t)).toBeLessThanOrEqual(40);
  });

  test("'Rosa Delgado over the option buttons': in a column of chips the nearer side over the next chip loses to a free side within reach", () => {
    const chips: R[] = [200, 240, 280].map((top) => ({
      left: 100,
      top,
      width: 60,
      height: 32,
    }));
    const [above, mid, below] = chips;
    const tip = centre(mid);
    const rosa = { w: 18 + "Rosa Delgado".length * 7.5, h: 22 };
    const t = tagRect(tip, win, rosa, mid, coversAny([above, below]));
    expect(overlaps(t, mid)).toBe(false);
    expect(overlaps(t, above)).toBe(false);
    expect(overlaps(t, below)).toBe(false);
    expect(overlaps(t, arrowAt(tip))).toBe(false);
    expect(reach(tip, t)).toBeLessThanOrEqual(40);
  });

  test("with every side covering another control, the nearest side within reach still wins (never a far one)", () => {
    const btn: R = { left: 600, top: 300, width: 100, height: 36 };
    const tip = centre(btn);
    const t = tagRect(tip, win, alex, btn, () => true);
    expect(overlaps(t, btn)).toBe(false);
    expect(reach(tip, t)).toBeLessThanOrEqual(40);
  });

  test("'Alex runs off the right edge (x 350-390)' of a 390 px frame: TAG_EDGE px clear of either edge, with or without an element", () => {
    const frame: R = { left: 0, top: 0, width: 390, height: 844 };
    for (const x of [340, 360, 375, 389]) {
      const tip = { x, y: 400 };
      const t = tagRect(tip, frame, alex, null);
      expect(t.left + t.width).toBeLessThanOrEqual(390 - 4);
      const btn: R = { left: 300, top: 380, width: 90, height: 40 };
      const u = tagRect(tip, frame, alex, btn);
      expect(u.left + u.width).toBeLessThanOrEqual(390 - 4);
    }
    for (const x of [0, 2]) {
      const t = tagRect({ x, y: 400 }, frame, alex, null);
      expect(t.left).toBeGreaterThanOrEqual(4);
    }
    const low = tagRect({ x: 200, y: 843 }, frame, alex, null);
    expect(low.top + low.height).toBeLessThanOrEqual(844 - 4);
    const high = tagRect({ x: 200, y: 0 }, frame, alex, null);
    expect(high.top).toBeGreaterThanOrEqual(4);
  });

  test("a sweep of buttons and chips across the window: every tag is within reach, off its button and off the arrow", () => {
    for (const [w, h] of [[40, 28], [80, 32], [120, 44], [160, 40]]) {
      for (let x = 10; x + w <= win.width - 10; x += 97) {
        for (let y = 10; y + h <= win.height - 10; y += 61) {
          const btn: R = { left: x, top: y, width: w, height: h };
          const tip = centre(btn);
          const t = tagRect(tip, win, priya, btn);
          const got = {
            btn,
            near: reach(tip, t) <= 40,
            offBtn: !overlaps(t, btn),
            offArrow: !overlaps(t, arrowAt(tip)),
          };
          expect(got).toEqual({
            btn,
            near: true,
            offBtn: true,
            offArrow: true,
          });
        }
      }
    }
  });
});
