/**
 * REQ-847 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm3 (run r02524ccd), issue p16: the stage's out-of-view cue ("You · Hans is
 * pointing below — scroll ↓") sat ~6 px lower and ~1 px righter than the customer's cue
 * (fleet-2/stdout:64: customer cue 320,96, stage cue 321,102 in customer px, chevrons both at
 * 314,60). DemoStage handed PointerGhost `tag={ghost.dir ? null : ownTag}`, so in cue mode the
 * customer's reported placement was thrown away and the ghost placed its words with
 * `tagPlacement`'s CSS-px constants (tail at tip + 30 + 6) in UNSCALED stage px — with the frame
 * drawn at s ≈ 0.86 that is 36 / 0.86 ≈ 41.9 customer px instead of 36.
 *
 * Now (1) the stage hands the reported placement on in cue mode too, and (2) with no report the
 * ghost places its cue in the customer's px (`scale`: the frame's s), so both screens agree.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import { placeTag } from "../components/demo-mode/DemoPointer.tsx";
import {
  type Dir,
  placedReport,
  reportedGhost,
  reportedTag,
} from "../../shared/demo-mode/presenter-anchor.ts";
import {
  type Anchor,
  parsePeerMessage,
  type PlacedMessage,
} from "../../shared/demo-mode/protocol.ts";

/** the customer's 1280 × 800 viewport; the element can be seen under a 56 px topbar */
const VIEW = { left: 0, top: 0, width: 1280, height: 800 };
const SCROLLER = { left: 0, top: 56, width: 1280, height: 744 };
/** the stage draws their screen at s = 0.86 (demo 2's mapping: (x − 89.6) / 0.86) */
const S = 0.86;
const FRAME = {
  left: 89.6,
  top: 40,
  width: VIEW.width * S,
  height: VIEW.height * S,
  s: S,
};
const onStage = (r: typeof SCROLLER) => ({
  left: FRAME.left + r.left * S,
  top: FRAME.top + r.top * S,
  width: r.width * S,
  height: r.height * S,
});
/** a stage point back in the customer's px */
const toCustomer = (p: { x: number; y: number }) => ({
  x: (p.x - FRAME.left) / S,
  y: (p.y - FRAME.top) / S,
});

const TIP = { x: 314, y: 60 };
const DOWN: Dir = { dx: 0, dy: 1 };
const a: Anchor = { vx: TIP.x / VIEW.width, vy: 0.9 };
const CUE = "Hans is pointing below — scroll ↓";

const px = (el: Element | null, k: string) =>
  Number(
    (el?.getAttribute("style") ?? "").match(
      new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`),
    )?.[1],
  );

/** the customer's overlay places its cue span (DemoPointer's `placeTag`, the code path its
 *  painter runs on every frame) and returns where it went, relative to the tip */
const customerCue = () => {
  const el = {
    offsetWidth: 14 + CUE.length * 6.6,
    offsetHeight: 20,
    style: {} as Record<string, string>,
    setAttribute() {},
  } as unknown as HTMLElement;
  return placeTag(el, TIP, SCROLLER, null, { w: 0, h: 0 });
};

/** the stage's ghost cue's top-left, in the customer's px */
const stageCue = (
  props: Partial<Parameters<typeof PointerGhost>[0]>,
  at: { x: number; y: number },
) => {
  const doc = new DOMParser().parseFromString(
    `<body>${
      renderToString(
        <PointerGhost
          at={at}
          outside={false}
          dir={DOWN}
          color="#2a7"
          z={10}
          label="You"
          bounds={FRAME}
          cueText={CUE}
          cueBox={onStage(SCROLLER)}
          {...props}
        />,
      )
    }</body>`,
    "text/html",
  )!;
  const el = doc.querySelector("[data-cy='demo-pointer-ghost-cue']");
  assert(el, "the ghost draws its cue words");
  return toCustomer({ x: at.x + px(el, "left"), y: at.y + px(el, "top") });
};

Deno.test("REQ-847 (demo dm3 p16) unit: with no report, the ghost's cue at s=0.86 sits where the customer's does (top within 1 px)", () => {
  const cus = customerCue();
  const at = { x: FRAME.left + TIP.x * S, y: FRAME.top + TIP.y * S };
  const stg = stageCue({ scale: S }, at);
  // the customer: tail slot, 36 px under the tip (60 + 36 = 96), 6 px right (320)
  assertAlmostEquals(TIP.y + cus.y, 96, 0.01);
  assertAlmostEquals(stg.y, TIP.y + cus.y, 1, `stage cue top ${stg.y}`);
  assertAlmostEquals(stg.x, TIP.x + cus.x, 1, `stage cue left ${stg.x}`);
});

Deno.test("REQ-847 (demo dm3 p16) integration: customer cue → placedReport → wire → reportedGhost + reportedTag at s=0.86 → the ghost's cue top equals the customer's within 1 px", () => {
  const cus = customerCue();
  const report = parsePeerMessage(JSON.parse(JSON.stringify(placedReport(
    "pid",
    a,
    { at: TIP, outside: false, dir: DOWN },
    VIEW,
    cus,
  )))) as PlacedMessage;
  const held = { a, load: null, at: { x: 600, y: 600 }, provisional: false };
  const g = reportedGhost(held, report, FRAME);
  assert(g?.dir, "the stage draws the cue");
  const t = reportedTag(held, report, FRAME);
  assert(t, "the report carries the cue's placement");
  const stg = stageCue({ tag: t, scale: S }, g.at);
  assertAlmostEquals(stg.y, TIP.y + cus.y, 1, `stage cue top ${stg.y}`);
  assertAlmostEquals(stg.x, TIP.x + cus.x, 1, `stage cue left ${stg.x}`);
});

Deno.test("REQ-847 (demo dm3 p16) integration: DemoStage hands its ghost the reported tag in cue mode too, and the frame's scale", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  const ghost = src.slice(src.indexOf("<PointerGhost"));
  const props = ghost.slice(0, ghost.indexOf("/>"));
  assert(
    !/tag=\{ghost\.dir \? null/.test(props),
    "the cue still throws the customer's reported placement away",
  );
  assert(/tag=\{ownTag\}/.test(props), "the ghost is not given the tag");
  assert(/scale=\{fit\.s\}/.test(props), "the ghost is not given the scale");
});
