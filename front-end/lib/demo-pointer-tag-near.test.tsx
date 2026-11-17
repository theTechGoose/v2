/**
 * REQ-543 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4 (run r857a9d67), issue m6: the pointer's name tag sat 60-130 px from its
 * arrow, over the NEXT control ('Carl' over Cancel, 'Rosa Delgado' over the option buttons), and
 * flush against the frame's edge. DemoPointer's painter now hit-tests each candidate tag box on
 * the page under it (`coversControl`, through the stage's same-origin mirror iframe) and
 * `placeTag` hands that to `tagPlacement`, which keeps the tag within TAG_REACH of the tip.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer, {
  coversControl,
  placeTag,
} from "../components/demo-mode/DemoPointer.tsx";
import { TAG_EDGE, TAG_REACH } from "../../shared/demo-mode/motion.ts";

interface R {
  left: number;
  top: number;
  width: number;
  height: number;
}
const overlaps = (a: R, b: R) =>
  a.left < b.left + b.width && b.left < a.left + a.width &&
  a.top < b.top + b.height && b.top < a.top + a.height;
const reach = (tip: { x: number; y: number }, t: R) =>
  Math.hypot(
    Math.max(t.left - tip.x, 0, tip.x - (t.left + t.width)),
    Math.max(t.top - tip.y, 0, tip.y - (t.top + t.height)),
  );

/** a page as the browser hit-tests it: elements laid out at boxes, the topmost last */
function fakePage(html: string, boxes: Record<string, R>) {
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const laid: { el: Element; r: R }[] = [];
  for (const [sel, r] of Object.entries(boxes)) {
    const el = doc.querySelector(sel)!;
    // deno-lint-ignore no-explicit-any
    (el as any).getBoundingClientRect = () => ({
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
    });
    laid.push({ el, r });
  }
  // deno-lint-ignore no-explicit-any
  (doc as any).elementFromPoint = (x: number, y: number) => {
    for (let i = laid.length - 1; i >= 0; i--) {
      const { el, r } = laid[i];
      if (
        x >= r.left && x < r.left + r.width && y >= r.top &&
        y < r.top + r.height
      ) return el;
    }
    return doc.body;
  };
  return doc as unknown as Document;
}

const MODAL = `<body><div id="modal"><p id="msg">Send it?</p>
  <button id="cancel"><span id="cancel-label">Cancel</span></button>
  <button id="ok"><span id="ok-label">Send</span></button></div></body>`;
const modalBoxes = {
  "#modal": { left: 520, top: 480, width: 340, height: 200 },
  "#msg": { left: 540, top: 500, width: 300, height: 60 },
  "#cancel": { left: 570, top: 600, width: 120, height: 40 },
  "#cancel-label": { left: 600, top: 610, width: 60, height: 20 },
  "#ok": { left: 700, top: 600, width: 120, height: 40 },
  "#ok-label": { left: 735, top: 610, width: 50, height: 20 },
};

Deno.test("REQ-543 (demo m6) coversControl: a box over another control (Cancel, through its label) covers it; over plain text or the control the tip is on, not", () => {
  const doc = fakePage(MODAL, modalBoxes);
  const tip = { x: 760, y: 620 }; // on OK
  assertEquals(
    coversControl(doc, { left: 610, top: 605, width: 48, height: 22 }, tip),
    true,
    "over Cancel's label",
  );
  assertEquals(
    coversControl(doc, { left: 600, top: 520, width: 48, height: 22 }, tip),
    false,
    "over the message text",
  );
  assertEquals(
    coversControl(doc, { left: 740, top: 612, width: 48, height: 22 }, tip),
    false,
    "over OK itself — the target, not another control",
  );
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

Deno.test("REQ-543 (demo m6) placeTag with the page's hit-test: 'Carl' on OK sits next to the arrow, over neither OK nor Cancel", () => {
  const doc = fakePage(MODAL, modalBoxes);
  const box = { left: 0, top: 0, width: 1280, height: 720 };
  const ok = modalBoxes["#ok"];
  const tip = { x: 760, y: 620 };
  const el = fakeTag(44, 22);
  placeTag(
    el as unknown as HTMLElement,
    tip,
    box,
    ok,
    { w: 48, h: 22 },
    (r) => coversControl(doc, r, tip),
  );
  const t = {
    left: tip.x + parseFloat(el.style.left),
    top: tip.y + parseFloat(el.style.top),
    width: 44,
    height: 22,
  };
  assert(!overlaps(t, ok), `off OK: ${JSON.stringify(t)}`);
  assert(
    !overlaps(t, modalBoxes["#cancel"]),
    `off Cancel: ${JSON.stringify(t)}`,
  );
  assert(reach(tip, t) <= TAG_REACH, `next to the arrow: ${reach(tip, t)} px`);
});

Deno.test("REQ-543 (demo m6) the first render keeps the tag within reach of a chip and TAG_EDGE clear of a 390 px frame's right edge", () => {
  const frame = { left: 0, top: 0, width: 390, height: 844 };
  const chip = { left: 290, top: 380, width: 100, height: 40 };
  const tip = { x: 370, y: 400 };
  const html = renderToString(
    <DemoPointer
      pointer={tip}
      rect={chip}
      waves={[]}
      name="Alex"
      color="#2f6d29"
      z={10}
      attach={() => {}}
      bounds={frame}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const tag = doc.querySelector('[data-cy="demo-pointer-tag"]') as Element;
  const style = tag.getAttribute("style") ?? "";
  const px = (p: string) =>
    Number(style.match(new RegExp(`(^|;)${p}:(-?[\\d.]+)px`))?.[2] ?? NaN);
  const t = {
    left: tip.x + px("left"),
    top: tip.y + px("top"),
    width: 18 + "Alex".length * 7.5,
    height: 22,
  };
  assert(
    t.left + t.width <= frame.width - TAG_EDGE,
    `clear of the edge: ${t.left}+${t.width}`,
  );
  assert(reach(tip, t) <= TAG_REACH, `next to the arrow: ${reach(tip, t)} px`);
  assert(!overlaps(t, chip), "off the chip");
});
