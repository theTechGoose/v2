/**
 * REQ-633 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issues m2 (pointer name tags cover the text they point at),
 * m35 (the resting tag read as "under the coach mark's dark layer") and c4-S12b ('TBD' misread
 * under the customer's pointer). DemoPointer's page hit-test (`coverage`) now scores TEXT as well
 * as other controls, and the painter hands it to `tagPlacement` for every candidate — with or
 * without an anchored element.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer, {
  coverage,
  placeTag,
} from "../components/demo-mode/DemoPointer.tsx";
import { TAG_REACH } from "../../shared/demo-mode/motion.ts";

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

// the onboarding step: "Great — let's get you started!" 8 px above the price chip
const STEP = `<body><main id="main">
  <h2 id="h">Great — let's get you started!</h2>
  <div id="row"><button id="chip"><span id="chip-label">I know my price</span></button></div>
  <table id="t"><tr><td id="amount">$16,800.00</td></tr></table>
</main></body>`;
const stepBoxes: Record<string, R> = {
  "#main": { left: 0, top: 0, width: 1280, height: 720 },
  "#h": { left: 300, top: 250, width: 600, height: 24 },
  "#row": { left: 300, top: 282, width: 600, height: 36 },
  "#chip": { left: 490, top: 282, width: 220, height: 36 },
  "#chip-label": { left: 540, top: 290, width: 120, height: 20 },
  "#t": { left: 300, top: 360, width: 600, height: 30 },
  "#amount": { left: 300, top: 360, width: 600, height: 30 },
};

Deno.test("REQ-633 (demo m2) coverage: a box over a heading or a table cell scores, over empty space or the target chip it does not", () => {
  const doc = fakePage(STEP, stepBoxes);
  const tip = { x: 600, y: 300 }; // on the chip
  assert(
    coverage(doc, { left: 560, top: 252, width: 48, height: 22 }, tip) > 0,
    "over the heading",
  );
  assert(
    coverage(doc, { left: 560, top: 364, width: 48, height: 22 }, tip) > 0,
    "over '$16,800.00'",
  );
  assertEquals(
    coverage(doc, { left: 1000, top: 500, width: 48, height: 22 }, tip),
    0,
    "over empty space",
  );
  assertEquals(
    coverage(doc, { left: 495, top: 285, width: 40, height: 22 }, tip),
    0,
    "over the target chip's padding (not another control, no text)",
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

Deno.test("REQ-633 (demo m2) placeTag with the page's hit-test: 'Alex' on the chip covers neither the heading 8 px above nor the chip", () => {
  const doc = fakePage(STEP, stepBoxes);
  const box = { left: 0, top: 0, width: 1280, height: 720 };
  const tip = { x: 600, y: 300 };
  const el = fakeTag(48, 22);
  placeTag(
    el as unknown as HTMLElement,
    tip,
    box,
    stepBoxes["#chip"],
    { w: 48, h: 22 },
    (r) => coverage(doc, r, tip),
  );
  const t = {
    left: tip.x + parseFloat(el.style.left),
    top: tip.y + parseFloat(el.style.top),
    width: 48,
    height: 22,
  };
  assert(
    !overlaps(t, stepBoxes["#h"]),
    `off the heading: ${JSON.stringify(t)}`,
  );
  assert(
    !overlaps(t, stepBoxes["#chip"]),
    `off the chip: ${JSON.stringify(t)}`,
  );
  assert(reach(tip, t) <= TAG_REACH, `next to the arrow: ${reach(tip, t)} px`);
});

Deno.test("REQ-633 (demo m35) the tag is drawn fully opaque on a solid backing", () => {
  const html = renderToString(
    <DemoPointer
      pointer={{ x: 300, y: 300 }}
      waves={[]}
      name="Alex"
      color="#2f6d29"
      z={10}
      attach={() => {}}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const tag = doc.querySelector('[data-cy="demo-pointer-tag"]') as Element;
  const style = tag.getAttribute("style") ?? "";
  assert(/(^|;)opacity:1(;|$)/.test(style), style);
  assert(/background:#2f6d29/.test(style), style);
  assertEquals(tag.textContent, "Alex");
});
