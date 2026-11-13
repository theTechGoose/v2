/**
 * REQ-761 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5v2 (run r37f88707), issue c4-S12b, re-opened by the verifier: Pair 5's
 * employee misread 'TBD' as 'Today' because the customer's pointer, resting on the label, hid
 * its letters. REQ-633 moved and shrank the tag but kept the arrow at opacity 1 ("solid/opaque
 * dark green (opacity 1) and covers part of the letters 'fo'"; `pointerLook` returned arrow:1
 * always). A RESTING arrow now lets the text under it show through: its body is see-through,
 * its outline and halo stay clearly visible (REQ-374 p8: never faint); a moving arrow is solid.
 */
import * as motion from "../../shared/demo-mode/motion";

const m = motion as typeof motion & Record<string, any>;

describe("REQ-761 (demo c4-S12b, cycle 5v2) a resting pointer lets the label under it be read", () => {
  test("while it moves the arrow is solid (easy to follow)", () => {
    const look = m.pointerLook(false);
    expect(look.arrow).toBe(1);
    expect(look.fill).toBe(1);
  });

  test("at rest the arrow is semi-transparent — not opacity 1, as the verifier measured", () => {
    const look = m.pointerLook(true);
    expect(look.arrow).toBeLessThan(1);
    // REQ-374 p8: the outline + halo never drop to the faint .45/.55 of old
    expect(look.arrow).toBeGreaterThanOrEqual(0.7);
  });

  test("at rest the arrow's coloured body covers at most half the letters' contrast", () => {
    const look = m.pointerLook(true);
    // what of the body's colour is painted over the text: the svg's opacity × the fill's
    expect(look.arrow * look.fill).toBeLessThanOrEqual(0.5);
    expect(look.arrow * look.fill).toBeGreaterThan(0.2); // still reads as his colour
  });

  test("the tag still rests opaque and compact (REQ-633 m35 unchanged)", () => {
    const look = m.pointerLook(true);
    expect(look.tag).toBe(1);
    expect(look.compact).toBe(true);
  });
});
