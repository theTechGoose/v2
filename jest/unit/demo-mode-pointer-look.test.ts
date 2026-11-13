/**
 * REQ-374 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issues m9 (the presenter's name tag was invisible — opacity 0 — most of the
 * time, and covered the text it pointed at when shown) and p8 (the pointer was faint — dimmed to
 * .45/.55 — and its colours were named nowhere).
 *
 * The pointer's look is pure (shared/demo-mode/motion.ts): the tag sits above-left of the tip,
 * away from what is pointed at, and flips only at the box's edge; at rest it fades to
 * TAG_REST_OPACITY, never to 0; the arrow is always fully opaque.
 */
import * as fs from "fs";
import * as path from "path";
import * as motion from "../../shared/demo-mode/motion";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const { tagPlacement, pointerLook, TAG_REST_OPACITY, TAG_IDLE_MS } = motion as
  & typeof motion
  & Record<string, any>;

describe("REQ-374 (demo m9/p8, cycle 2) the pointer's tag stays readable and off the content", () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };
  const tag = { w: 90, h: 22 };

  // REQ-437 REVISION (demo m3, cycle 3): above-left of the tip still covered a control hovered
  // at its centre; the tag now sits outside the element pointed at, else past the arrow's tail
  // (jest/unit/demo-pointer-tag-spot.test.ts) — always inside the box
  test("the tag sits off the arrow (past its tail when no element is known), inside the box", () => {
    const at = tagPlacement({ x: 300, y: 200 }, box, tag);
    expect(at.side).toBe("tail");
    expect(at.y).toBeGreaterThanOrEqual(200 + 30 + 6);
  });
  test("near the box's edges it is clamped inside the box", () => {
    for (
      const p of [{ x: 120, y: 200 }, { x: 300, y: 60 }, { x: 495, y: 345 }]
    ) {
      const at = tagPlacement(p, box, tag);
      expect(at.x).toBeGreaterThanOrEqual(box.left);
      expect(at.y).toBeGreaterThanOrEqual(box.top);
      expect(at.x + tag.w).toBeLessThanOrEqual(box.left + box.width);
      expect(at.y + tag.h).toBeLessThanOrEqual(box.top + box.height);
    }
  });

  // REQ-633 REVISION (demo m35, cycle 5): a 0.6 tag let the coach mark's dark scrim show
  // through ("under the dark layer"); at rest it now stays fully opaque and shrinks instead
  // REQ-761 REVISION (demo c4-S12b, cycle 5v2): a solid resting arrow hid the letters of the
  // label under it ('TBD' read as 'Today'); at rest it is see-through, never faint (≥ .7)
  test("at rest the tag never fades (REQ-633: fully opaque, compact); a moving arrow is fully opaque, a resting one see-through (REQ-761)", () => {
    expect(TAG_REST_OPACITY).toBe(1);
    expect(TAG_IDLE_MS).toBeGreaterThan(0);
    expect(pointerLook(false)).toEqual({
      arrow: 1,
      fill: 1,
      tag: 1,
      compact: false,
    });
    expect(pointerLook(true)).toEqual({
      arrow: motion.ARROW_REST_OPACITY,
      fill: motion.ARROW_REST_FILL,
      tag: 1,
      compact: true,
    });
    expect(motion.ARROW_REST_OPACITY).toBeGreaterThanOrEqual(0.7);
    // no second, dimmer arrow state any more
    expect((motion as Record<string, unknown>).ARROW_IDLE_MS).toBeUndefined();
  });

  test("DemoPointer re-shows the tag on ANY re-placement (the pointer object, or outside), not only on a new x/y", () => {
    const src = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(src).toMatch(/pointerLook\(/);
    expect(src).not.toMatch(/\[pointer\?\.x, pointer\?\.y\]/);
    expect(src).toMatch(/\}, \[pointer, outside\]\)/);
    // no faint arrow: neither the idle .45 nor the outside .55
    expect(src).not.toMatch(/0\.45|0\.55/);
  });

  test("the stage's pill names the customer's pointer colour (presenter chips already carry theirs)", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    const pill = stage.slice(stage.indexOf('data-cy="demo-pill"'));
    expect(pill).toMatch(
      /data-cy="demo-customer-dot"[\s\S]{0,200}background:\$\{CUSTOMER_COLOR\}/,
    );
  });
});
