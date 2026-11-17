/**
 * REQ-871 (demo-loop cycle dm5, issue p1) — the box the customer's pill sends to the stage is
 * never smaller than the box the browser measured (amends REQ-835 / REQ-865).
 *
 * `pillRestBox` rounded the width and height (`Math.round`). Her pill is shrink-to-fit, so its
 * width has a fraction (Ana 404.25, Maria 414.44, Jo 395.48, DocuMonster 462.48): a fraction under
 * .5 lost up to half a pixel, the stage laid the ghost out at that width with her own metrics
 * (REQ-865), and the one-row ghost's text span took the deficit with an ellipsis —
 * "Alex is guiding y…" (scrollWidth 116 > clientWidth 115).
 */
import { pillRestBox } from "../../shared/demo-mode/pill.ts";

const still = { x: 0, y: 0 };

describe("REQ-871 (cycle dm5, p1): pillRestBox never shrinks the measured box", () => {
  test.each([404.25, 414.44, 395.48, 462.484375, 406.6875, 407.5, 300, 0.1])(
    "REQ-871: width %p is sent at least as wide",
    (w) => {
      const sent = pillRestBox(
        { left: 818.4, top: 745.2, width: w, height: 43 },
        still,
        still,
      );
      expect(sent.width).toBeGreaterThanOrEqual(w);
      // never more than a pixel of slack: the ghost's box stays the customer's box
      expect(sent.width - w).toBeLessThan(1);
    },
  );

  test.each([43.25, 42.6, 110.4, 43])(
    "REQ-871: height %p is sent at least as tall",
    (h) => {
      const sent = pillRestBox(
        { left: 10, top: 20, width: 300, height: h },
        still,
        still,
      );
      expect(sent.height).toBeGreaterThanOrEqual(h);
      expect(sent.height - h).toBeLessThan(1);
    },
  );

  test("REQ-871: whole-pixel boxes are sent unchanged; left/top still follow the glide", () => {
    expect(
      pillRestBox(
        { left: 100, top: 700, width: 407, height: 43 },
        { x: -20, y: 0 },
        { x: 0, y: 0 },
      ),
    ).toEqual({ left: 120, top: 700, width: 407, height: 43 });
  });
});
