/**
 * REQ-860 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm4 (run rf5fcb8b9), issues m5 + p6 (RCA at 7401e980).
 *
 * m5: the stage's "pointing below" cue ran ~30 px past the frame's right edge (1220.7 vs
 * 1190.4). The stage draws its cue where the customer's tag is (`alignTag`, REQ-847), keeping
 * the customer's LEFT edge, but the stage's English words are wider than her Spanish ones, and
 * `alignTag` never clamped to the box.
 * p6: with his mouse BELOW the frame (1000,873; frame bottom 830) the stage drew his "You" tag
 * at ~(1016,816), inside the frame over the customer's footer: the customer's tag offset (above
 * her edge-pinned arrow) applied to his unpinned point. The chrome-row hint already says his
 * pointer is off their screen, so his marker carries no tag inside the frame then.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import { OwnMarker } from "../components/demo-mode/OwnPointer.tsx";
import { alignTag } from "../../shared/demo-mode/presenter-anchor.ts";
import { TAG_EDGE } from "../../shared/demo-mode/motion.ts";

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
const px = (el: Element | null, k: string) =>
  Number(
    (el?.getAttribute("style") ?? "").match(
      new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`),
    )?.[1],
  );

// the frame on the stage from the report: left 89.6, width 1100.8 (right 1190.4), bottom 830
const FRAME = { left: 89.6, top: 100, width: 1100.8, height: 730 };
const RIGHT = FRAME.left + FRAME.width;
const BOTTOM = FRAME.top + FRAME.height;

Deno.test("REQ-860 (demo dm4 m5) unit: alignTag keeps a wider label inside the box it is given", () => {
  // the customer's Spanish cue, 244 px wide, flush with her right edge, above the chevron
  const at = { x: 1100, y: 800 };
  const tag = {
    side: "tail-up" as const,
    x: RIGHT - TAG_EDGE - 244 - at.x,
    y: -26,
    w: 244,
    h: 20,
  };
  const own = { w: 333, h: 20 };
  const p = alignTag(tag, own, at, FRAME);
  assert(
    at.x + p.left + own.w <= RIGHT - TAG_EDGE + 0.01,
    `right edge ${at.x + p.left + own.w} past ${RIGHT - TAG_EDGE}`,
  );
  assert(at.x + p.left >= FRAME.left + TAG_EDGE - 0.01);
  // the edge facing the arrow is still kept: above it, bottoms aligned
  assertEquals(p.top + own.h, tag.y + tag.h);
  // and one that fits is left where the customer's is
  const same = alignTag({ ...tag, x: -300 }, own, at, FRAME);
  assertEquals(same.left, -300);
  // below the bottom edge: shifted up inside it
  const low = alignTag(
    { side: "below", x: 0, y: 40, w: 30, h: 20 },
    { w: 30, h: 20 },
    { x: 500, y: 800 },
    FRAME,
  );
  assert(800 + low.top + 20 <= BOTTOM - TAG_EDGE + 0.01);
});

Deno.test("REQ-860 (demo dm4 m5) integration: an ES customer's reported cue + the stage's EN words near the right edge stays inside the frame", () => {
  const at = { x: 1100, y: 800 };
  // her cue, "Alex señala más abajo — desplázate ↓", 244 frame px, fitted to her right edge
  const tag = {
    side: "tail-up" as const,
    x: RIGHT - TAG_EDGE - 244 - at.x,
    y: -26,
    w: 244,
    h: 20,
  };
  const html = renderToString(
    <PointerGhost
      at={at}
      outside={false}
      dir={{ dx: 0, dy: 1 }}
      color="#2a7"
      z={10}
      label="You"
      bounds={FRAME}
      tag={tag}
      cueText="pointing below — the customer must scroll ↓"
      cueBox={FRAME}
      scale={0.86}
    />,
  );
  const cue = parse(html).querySelector("[data-cy='demo-pointer-ghost-cue']");
  assert(cue, "the cue is drawn");
  const words = cue.textContent ?? "";
  const w = 14 + words.length * 6.5; // PointerGhost's own size estimate
  const left = at.x + px(cue, "left");
  assert(
    left + w <= RIGHT + 0.01,
    `the cue's right edge ${left + w} runs past the frame's ${RIGHT}`,
  );
  assert(left >= FRAME.left - 0.01);
});

Deno.test("REQ-860 (demo dm4 p6) integration: his mouse at (1000,873) below a frame whose bottom is 830 puts no 'You' tag inside the frame", () => {
  const at = { x: 1000, y: 873 };
  // the customer's tag sat above her arrow, pinned against her bottom edge
  const tag = { side: "above" as const, x: 16, y: -57, w: 30, h: 18 };
  const html = renderToString(
    <OwnMarker
      at={at}
      color="#2a7"
      z={10}
      label="You"
      tagged
      look="live"
      pendingLabel="pointing…"
      tag={tag}
      bounds={FRAME}
    />,
  );
  const label = parse(html).querySelector(
    "[data-cy='demo-pointer-own-label']",
  );
  if (!label) return; // no tag at all: the chrome-row hint says it
  const x = at.x + px(label, "left");
  const y = at.y + px(label, "top");
  const inside = x < RIGHT && x + 30 > FRAME.left && y < BOTTOM &&
    y + 18 > FRAME.top;
  assert(!inside, `'You' tag at (${x},${y}) is drawn inside the frame`);
});

Deno.test("REQ-860 (demo dm4 p6) unit: inside the frame, his 'You' tag stays where the customer's is, clamped into the frame", () => {
  const at = { x: 1180, y: 500 };
  const tag = { side: "right" as const, x: 16, y: 0, w: 30, h: 18 };
  const html = renderToString(
    <OwnMarker
      at={at}
      color="#2a7"
      z={10}
      label="You"
      tagged
      look="live"
      pendingLabel="pointing…"
      tag={tag}
      bounds={FRAME}
    />,
  );
  const label = parse(html).querySelector(
    "[data-cy='demo-pointer-own-label']",
  );
  assert(label, "tagged inside the frame");
  const w = 14 + "You".length * 6;
  assert(at.x + px(label, "left") + w <= RIGHT - TAG_EDGE + 0.01);
});
