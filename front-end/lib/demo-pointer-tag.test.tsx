/**
 * REQ-437 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 3, issues m3 (the pointer's name tag covered the element it pointed at) and
 * p8-pair3-a ('Alex' clipped to 'ex' at the window's left edge). DemoPointer is rendered for real
 * (SSR), and its per-frame tag painter is driven with an element whose size is MEASURED.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer, { placeTag } from "../components/demo-mode/DemoPointer.tsx";

const bounds = { left: 0, top: 0, width: 1280, height: 800 };
const button = { left: 560, top: 380, width: 160, height: 40 };
const tip = { x: 640, y: 400 };
const px = (style: string, prop: string) =>
  Number(style.match(new RegExp(`(^|;)${prop}:(-?[\\d.]+)px`))?.[2] ?? NaN);

Deno.test("REQ-437 (demo m3) the first render places the tag outside the element pointed at, side marked", () => {
  const html = renderToString(
    <DemoPointer
      pointer={tip}
      rect={button}
      waves={[]}
      name="Alex"
      color="#2f6d29"
      z={10}
      attach={() => {}}
      bounds={bounds}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const tag = doc.querySelector('[data-cy="demo-pointer-tag"]') as Element;
  assert(tag, "the tag is drawn");
  const side = tag.getAttribute("data-tag-side") ?? "";
  assert(side !== "", "the side is marked");
  const style = tag.getAttribute("style") ?? "";
  // left/top are relative to the tip (the pointer box is translated to it)
  const left = tip.x + px(style, "left");
  const top = tip.y + px(style, "top");
  assert(Number.isFinite(left) && Number.isFinite(top), `placed: ${style}`);
  const w = 16 + "Alex".length * 7.5, h = 22;
  const overlaps = left < button.left + button.width &&
    button.left < left + w && top < button.top + button.height &&
    button.top < top + h;
  assertEquals(overlaps, false, `the tag (${left},${top}) is off the button`);
});

/** a tag element as the browser has it: a measured size, a style, attributes */
function fakeTag(w: number, h: number) {
  const attrs: Record<string, string> = {};
  return {
    offsetWidth: w,
    offsetHeight: h,
    style: { left: "", top: "" } as Record<string, string>,
    setAttribute(k: string, v: string) {
      attrs[k] = v;
    },
    attrs,
  };
}

Deno.test("REQ-437 (demo p8-pair3-a) the painter uses the tag's MEASURED size and keeps it inside the box at either edge", () => {
  // a name far wider than its estimate: measured 140 px
  const el = fakeTag(140, 24);
  const right = { x: 1270, y: 300 };
  placeTag(el as unknown as HTMLElement, right, bounds, null, { w: 40, h: 22 });
  const left = right.x + parseFloat(el.style.left);
  assert(left + 140 <= bounds.width, `inside the right edge: ${left}+140`);
  assert(el.attrs["data-tag-side"], "the side is marked on every paint");
  // the drawn arrow at the window's left edge (mid-glide or at rest): never clipped
  const lefty = fakeTag(48, 22);
  placeTag(lefty as unknown as HTMLElement, { x: 2, y: 300 }, bounds, {
    left: 0,
    top: 280,
    width: 70,
    height: 40,
  }, { w: 46, h: 22 });
  assert(2 + parseFloat(lefty.style.left) >= 0, "not clipped at the left");
});

Deno.test("REQ-437 an unmeasured tag (not laid out yet) falls back to the estimate", () => {
  const el = fakeTag(0, 0);
  placeTag(el as unknown as HTMLElement, { x: 1279, y: 300 }, bounds, null, {
    w: 46,
    h: 22,
  });
  const left = 1279 + parseFloat(el.style.left);
  assert(left + 46 <= bounds.width, `inside with the estimate: ${left}`);
});
