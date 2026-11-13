/**
 * REQ-633 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issues m2 ("Pointer name tags cover the text they point
 * at": 'started!', 'AMOUNT', '$16,800.00', 'Panel Upgrade' — all 10 pairs), m35 ("Presenter
 * pointer drawn under the coach-mark's dark layer") and the cycle-4 backlog c4-S12b (the
 * employee misread 'TBD' because the customer's pointer covered it).
 *
 * RCA (2444608a): `tagPlacement` only avoided CONTROLS; when every side covered one it returned
 * ok[0] blindly; the tail fallback (a big anchored element, or none) ran no check at all; and a
 * resting tag faded to 0.6, so a dark scrim showed through it and it read as "under the layer".
 *
 * Now: `covers` may SCORE a candidate (how much content it covers); the least-covering candidate
 * wins (ties: the nearest side), the sides around the arrow itself (tail, tail-up, right, left)
 * go through the same check, and a resting tag stays fully opaque and shrinks to the initials.
 */
import * as motion from "../../shared/demo-mode/motion";
import {
  ARROW_BOX,
  TAG_REACH,
  tagPlacement,
} from "../../shared/demo-mode/motion";

interface R {
  left: number;
  top: number;
  width: number;
  height: number;
}
const overlapArea = (a: R, b: R) =>
  Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  ) *
  Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
const reach = (tip: { x: number; y: number }, t: R) =>
  Math.hypot(
    Math.max(t.left - tip.x, 0, tip.x - (t.left + t.width)),
    Math.max(t.top - tip.y, 0, tip.y - (t.top + t.height)),
  );
/** how much text a tag at `r` covers — the page's hit-test, scored */
const textArea = (texts: R[]) => (r: R) =>
  texts.reduce((s, t) => s + overlapArea(r, t), 0);
const place = (
  tip: { x: number; y: number },
  box: R,
  tag: { w: number; h: number },
  rect: R | null,
  covers?: (r: R) => boolean | number,
) => {
  const s = tagPlacement(tip, box, tag, rect, covers as never);
  return { left: s.x, top: s.y, width: tag.w, height: tag.h, side: s.side };
};

describe("REQ-633 (demo m2 + m35 + c4-S12b, cycle 5) the pointer's name tag stays off the TEXT it points at", () => {
  const win: R = { left: 0, top: 0, width: 1280, height: 720 };
  const alex = { w: 48, h: 22 };

  test("'started!' over the 'I know my price' chip: a heading 8 px above the target chip is left readable", () => {
    const chip: R = { left: 490, top: 282, width: 220, height: 36 };
    const heading: R = { left: 300, top: 250, width: 600, height: 24 }; // 8 px above
    const tip = { x: 600, y: 300 };
    const t = place(tip, win, alex, chip, textArea([heading]));
    expect({ side: t.side, covered: overlapArea(t, heading) }).toEqual({
      side: t.side,
      covered: 0,
    });
    expect(overlapArea(t, chip)).toBe(0);
    expect(reach(tip, t)).toBeLessThanOrEqual(TAG_REACH);
  });

  test("every side covers some text: the LEAST covered wins, never the first blindly", () => {
    const chip: R = { left: 490, top: 282, width: 220, height: 36 };
    const tip = { x: 600, y: 300 };
    // a heading fills the spot above the chip; a line of text clips the spots below it
    const texts: R[] = [
      { left: 0, top: 240, width: 1280, height: 40 },
      { left: 0, top: 350, width: 1280, height: 10 },
    ];
    const score = textArea(texts);
    const t = place(tip, win, alex, chip, score);
    expect(score(t)).toBeGreaterThan(0);
    // the old pick (the nearest side, whatever it covers) covers more than the winner
    const blind = place(tip, win, alex, chip, () => true);
    expect(score(t)).toBeLessThan(score(blind));
  });

  test("a large anchored element (an 800 × 600 list): the tag is placed around the tip, off the line of text under the arrow's tail", () => {
    const list: R = { left: 200, top: 60, width: 800, height: 600 };
    const tip = { x: 600, y: 300 };
    // the row under the arrow's tail, where the old fallback sat (606, 336)
    const row: R = { left: 220, top: 330, width: 760, height: 30 };
    const t = place(tip, win, alex, list, textArea([row]));
    expect(overlapArea(t, row)).toBe(0);
    expect(reach(tip, t)).toBeLessThanOrEqual(TAG_REACH);
    expect(
      overlapArea(t, {
        left: tip.x,
        top: tip.y,
        width: ARROW_BOX.w,
        height: ARROW_BOX.h,
      }),
    ).toBe(0);
  });

  test("no anchored element (an outside or fraction anchor) still avoids text: '$16,800.00' under the tail stays readable", () => {
    const tip = { x: 600, y: 300 };
    const total: R = { left: 560, top: 334, width: 200, height: 26 };
    const t = place(tip, win, alex, null, textArea([total]));
    expect(overlapArea(t, total)).toBe(0);
    expect(reach(tip, t)).toBeLessThanOrEqual(TAG_REACH);
  });

  test("with nothing covered the old spots hold: a card's tail, a chip's nearest side", () => {
    const card: R = { left: 440, top: 300, width: 400, height: 110 };
    const tip = { x: 640, y: 355 };
    expect(place(tip, win, alex, card, () => 0).side).toBe("tail");
    expect(place(tip, win, alex, null, () => false).side).toBe("tail");
  });

  test("m35: a resting tag stays fully opaque (no scrim shows through) and shrinks to the initials", () => {
    const m = motion as typeof motion & Record<string, any>;
    expect(m.TAG_REST_OPACITY).toBe(1);
    // REQ-761 (c4-S12b, cycle 5v2): the resting ARROW is see-through; the tag is not
    expect(m.pointerLook(true)).toMatchObject({ tag: 1, compact: true });
    expect(m.pointerLook(false)).toEqual({
      arrow: 1,
      fill: 1,
      tag: 1,
      compact: false,
    });
    expect(m.tagLabel("Alex", true)).toBe("A");
    expect(m.tagLabel("Ana Torres", true)).toBe("AT");
    expect(m.tagLabel("Ana Torres", false)).toBe("Ana Torres");
    expect(m.tagLabel("  ", true)).toBe("");
  });
});
