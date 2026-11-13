/**
 * REQ-546 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4, issue m14: a customer click within 90 px of the frame's top drew its
 * 180 px ring over the staff impersonation banner — each wave was a position:fixed ring, and the
 * stage's overflow:hidden does not clip a fixed descendant. The waves (and the last-click dot)
 * are now drawn inside a container with the frame's box and overflow:hidden; the ring is smaller,
 * so it does not enclose the neighbouring chips. DemoPointer is rendered for real.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer, {
  type Bounds,
  type Wave,
} from "../components/demo-mode/DemoPointer.tsx";

/** the fitted frame on the stage, under a 52 px banner */
const frame: Bounds = { left: 100, top: 80, width: 400, height: 800 };

function draw(waves: Wave[], bounds?: Bounds) {
  const html = renderToString(
    <DemoPointer
      pointer={null}
      waves={waves}
      name="Rosa"
      color="#2f6d29"
      z={10}
      attach={() => {}}
      bounds={bounds}
    />,
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
}
const styleOf = (el: Element) => el.getAttribute("style") ?? "";
const px = (s: string, prop: string) =>
  Number(s.match(new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)px`))?.[1]);

Deno.test("REQ-546 (demo m14, cycle 4) a wave near the frame's top is clipped to the frame", () => {
  // a click 10 px under the frame's top edge
  const doc = draw([{ id: 1, x: 300, y: 90 }], frame);
  const ring = doc.querySelector('[data-cy="demo-wave"]') as Element;
  assert(ring, "the ring is drawn");
  const clip = ring.parentElement as Element;
  assertEquals(
    clip.getAttribute("data-cy"),
    "demo-wave-clip",
    "the ring sits inside the waves' clip",
  );
  const c = styleOf(clip);
  assert(/overflow:hidden/.test(c), `the clip hides overflow: ${c}`);
  assert(/position:fixed/.test(c), `the clip is placed on the screen: ${c}`);
  assertEquals(px(c, "left"), frame.left);
  assertEquals(px(c, "top"), frame.top);
  assertEquals(px(c, "width"), frame.width);
  assertEquals(px(c, "height"), frame.height);
  assert(/pointer-events:none/.test(c), "the clip never takes a click");
  // inside the clip the ring is placed relative to it, not to the window
  const r = styleOf(ring);
  assert(/position:absolute/.test(r), `the ring is placed in the clip: ${r}`);
  assertEquals(px(r, "left"), 300 - frame.left);
  assertEquals(px(r, "top"), 90 - frame.top);
});

Deno.test("REQ-546 (demo m14, cycle 4) the last-click dot is clipped with its wave", () => {
  const doc = draw([{ id: 1, x: 300, y: 90 }], frame);
  const dot = doc.querySelector('[data-cy="demo-click-dot"]') as Element;
  assertEquals(
    (dot.parentElement as Element).getAttribute("data-cy"),
    "demo-wave-clip",
  );
  const s = styleOf(dot);
  assertEquals(px(s, "left"), 200);
  assertEquals(px(s, "top"), 10);
});

Deno.test("REQ-546 (demo m14, cycle 4) the ring is small enough not to enclose the neighbouring chips", () => {
  const ring = draw([{ id: 1, x: 300, y: 300 }], frame).querySelector(
    '[data-cy="demo-wave"]',
  ) as Element;
  const w = px(styleOf(ring), "width");
  assert(w > 0 && w <= 120, `the ring is at most 120 px, got ${w}px`);
});

Deno.test("REQ-546 (demo m14, cycle 4) with no bounds the waves are clipped to the window", () => {
  const doc = draw([{ id: 1, x: 30, y: 40 }]);
  const clip = doc.querySelector('[data-cy="demo-wave-clip"]') as Element;
  assert(clip, "a clip is drawn");
  assertEquals(px(styleOf(clip), "left"), 0);
  assertEquals(px(styleOf(clip), "top"), 0);
});

Deno.test("REQ-546 (demo m14, cycle 4) no waves, no clip", () => {
  assertEquals(
    draw([], frame).querySelector('[data-cy="demo-wave-clip"]'),
    null,
  );
});
