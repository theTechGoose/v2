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

  test("the tag sits above-left of the tip, away from what it points at", () => {
    expect(tagPlacement({ x: 300, y: 200 }, box, tag)).toEqual({
      left: true,
      up: true,
    });
  });
  test("it flips right only where the box's left edge leaves no room, and down only at the top", () => {
    expect(tagPlacement({ x: 120, y: 200 }, box, tag)).toEqual({
      left: false,
      up: true,
    });
    expect(tagPlacement({ x: 300, y: 60 }, box, tag)).toEqual({
      left: true,
      up: false,
    });
    expect(tagPlacement({ x: 120, y: 60 }, box, tag)).toEqual({
      left: false,
      up: false,
    });
  });

  test("at rest the tag fades to ~0.6, never to 0; the arrow is always fully opaque", () => {
    expect(TAG_REST_OPACITY).toBeGreaterThanOrEqual(0.5);
    expect(TAG_REST_OPACITY).toBeLessThan(1);
    expect(TAG_IDLE_MS).toBeGreaterThan(0);
    expect(pointerLook(false)).toEqual({ arrow: 1, tag: 1 });
    expect(pointerLook(true)).toEqual({ arrow: 1, tag: TAG_REST_OPACITY });
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
