/**
 * REQ-877 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm5 (run r38fa8936), issue m1: with the presenter's mouse beside the fitted
 * frame, the customer saw a clamped edge mark with his initial ("A", fleet-r38fa8936-4/stdout:57:
 * demo-pointer-off-mark 1264–1278×784–798, demo-pointer-off-initial 1247–1263×767–783) for
 * OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS, while the stage said only "Your pointer is off {name}'s
 * screen" and drew nothing in the frame: `reportedGhost` returned null for every o:1 anchor
 * (REQ-642), so the stage never mirrored her edge mark.
 *
 * Now the customer's report of his off-frame marker becomes an edge ghost on the stage
 * (`reportedGhost(...).off`): on the same edge of the frame, keyed on the same rounded spot as her
 * marker (a new spot restarts both fades, the same spot re-sent restarts neither), drawn by
 * PointerGhost as the same chevron plus his initial, faint, with the same pmDemoOffFade
 * (OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS, `forwards` to 0) — so it is gone when hers is.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import * as anchorMod from "../../shared/demo-mode/presenter-anchor.ts";
import {
  initialOf,
  OFF_MARK_FADE_MS,
  OFF_MARK_SHOW_MS,
  offBadge,
  offEdge,
  offMark,
  placedReport,
  reportedGhost,
} from "../../shared/demo-mode/presenter-anchor.ts";
import {
  type Anchor,
  fracToPoint,
  parsePeerMessage,
  type PlacedMessage,
} from "../../shared/demo-mode/protocol.ts";
import { ARROW_BOX, placeIn } from "../../shared/demo-mode/motion.ts";

/** the customer's 1280 × 800 viewport (demo 5's) */
/** REQ-877 — the one pmDemoOffFade definition both screens use (read at run time: missing, the
 *  tests that need it fail on their own) */
const OFF_FADE_KEYFRAMES = (anchorMod as Record<string, unknown>)
  .OFF_FADE_KEYFRAMES as string;
const VIEW = { left: 0, top: 0, width: 1280, height: 800 };

/** the customer's overlay places an off anchor (DemoModeOverlay `placeOnScreen`) and reports it
 *  (`placedReport`), over the wire (`parsePeerMessage`) */
const customer = (a: Anchor) => {
  const placed = placeIn(fracToPoint(a, VIEW), VIEW, ARROW_BOX, true);
  const wire = JSON.parse(
    JSON.stringify(
      placedReport("u1", a, { ...placed, dir: null }, VIEW, null),
    ),
  );
  const r = parsePeerMessage(wire) as PlacedMessage | null;
  assert(r && r.k === "placed", `report parsed: ${JSON.stringify(wire)}`);
  return {
    at: placed.at,
    // DemoPointer's `markKey`: her marker remounts (its fade restarts) on a new rounded spot
    key: `${Math.round(placed.at.x)},${Math.round(placed.at.y)}`,
    mark: offMark(placed.at, VIEW),
    edge: offEdge(placed.at, VIEW),
    r,
  };
};

const frames = [
  {
    left: 89.6,
    top: 40,
    width: VIEW.width * 0.86,
    height: VIEW.height * 0.86,
    s: 0.86,
  },
  {
    left: 12,
    top: 30,
    width: VIEW.width * 1.25,
    height: VIEW.height * 1.25,
    s: 1.25,
  },
];
/** his mouse beside the frame: the anchor is where it meets the frame's edge */
const offAnchors: Anchor[] = [
  { vx: 1, vy: 1, o: 1 }, // past the bottom-right corner (demo 5's 1264,784 mark)
  { vx: 0, vy: 0.4, o: 1 }, // beside the left edge
  { vx: 0.5, vy: 1, o: 1 }, // under the bottom edge (demo 5's 640,775 case)
  { vx: 1, vy: 0.3, o: 1 }, // beside the right edge
];
const held = (a: Anchor, at = { x: 5, y: 300 }) => ({
  a,
  load: "L1",
  at,
  provisional: false,
});

Deno.test("REQ-877 (dm5 m1): an off-frame report is an edge ghost on the stage — on the edge her marker is on, keyed on her marker's rounded spot", () => {
  for (const frame of frames) {
    for (const a of offAnchors) {
      const c = customer(a);
      const g = reportedGhost(held(a), c.r, frame);
      assert(g, `REQ-877: a ghost for ${JSON.stringify(a)} at s ${frame.s}`);
      assert(g.outside, "marked outside");
      assert(
        g.off,
        `REQ-877: the ghost is the off marker (${JSON.stringify(g)})`,
      );
      assertEquals(g.off.key, c.key, "keyed on her marker's rounded spot");
      // the same edge: the stage's own offEdge of the ghost on the frame
      assertEquals(
        offEdge(g.at, frame),
        c.edge,
        `edge of ${JSON.stringify(a)}`,
      );
      // along the edge, the same point of her screen (in her px, within 1 px)
      const s = frame.s;
      const along = (v: number, lo: number) => (v - lo) / s;
      if (c.edge.dx === 0) {
        assertAlmostEquals(along(g.at.x, frame.left), c.at.x, 1);
      }
      if (c.edge.dy === 0) {
        assertAlmostEquals(along(g.at.y, frame.top), c.at.y, 1);
      }
    }
  }
});

Deno.test("REQ-877 (dm5 m1): an off ghost is never dropped as 'under his cursor' (GHOST_GAP_PX), and a report of another anchor is still no ghost", () => {
  const frame = frames[0];
  const a = offAnchors[1];
  const c = customer(a);
  // his mouse right at the frame's edge point: still the marker her screen has
  const at = fracToPoint(a, frame);
  assert(reportedGhost(held(a, at), c.r, frame)?.off);
  // he moved back onto the frame (another anchor): her old off report draws nothing
  assertEquals(
    reportedGhost(held({ vx: 0.5, vy: 0.5 }), c.r, frame),
    null,
  );
  // a report of nowhere: nothing
  assertEquals(
    reportedGhost(held(a), { ...c.r, p: null }, frame),
    null,
  );
});

const px = (el: Element | null, k: string) =>
  Number(
    (el?.getAttribute("style") ?? "").match(
      new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`),
    )?.[1],
  );

Deno.test("REQ-877 (dm5 m1): PointerGhost draws the off ghost as her marker — chevron + initial, no 'You' tag, the same pmDemoOffFade (OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS, forwards)", () => {
  const frame = frames[0];
  const a = offAnchors[0];
  const c = customer(a);
  const g = reportedGhost(held(a), c.r, frame)!;
  assert(g?.off, "an off ghost");
  const html = renderToString(
    <PointerGhost
      at={g.at}
      outside={g.outside}
      dir={g.dir}
      off={g.off}
      initial={initialOf("Alex Rivera")}
      color="#2a6"
      z={10}
      label="You"
      bounds={frame}
    />,
  );
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  )!;
  const root = doc.querySelector("[data-cy='demo-pointer-ghost']");
  assert(root, "the ghost is drawn");
  assertEquals(root.getAttribute("data-off"), "", "data-off");
  const mark = doc.querySelector("[data-cy='demo-pointer-ghost-off-mark']");
  assert(mark, `REQ-877: the edge mark (${html})`);
  const want = offMark(g.at, frame);
  assertEquals(px(mark, "left"), want.left);
  assertEquals(px(mark, "top"), want.top);
  assert(
    (mark.getAttribute("style") ?? "").includes(
      `animation:pmDemoOffFade ${
        OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS
      }ms linear forwards`,
    ),
    `REQ-877: the same fade as hers (${mark.getAttribute("style")})`,
  );
  const initial = doc.querySelector(
    "[data-cy='demo-pointer-ghost-off-initial']",
  );
  assertEquals(initial?.textContent, "A", "his initial, as hers says it");
  const badge = offBadge(g.at, frame);
  assertEquals(px(initial, "left"), badge.left);
  assertEquals(px(initial, "top"), badge.top);
  // her marker has no tag: neither has its ghost
  assertEquals(
    doc.querySelector("[data-cy='demo-pointer-ghost-label']"),
    null,
    "no 'You' tag on the off ghost",
  );
  // the same keyframes on both screens (one shared definition)
  assert(
    typeof OFF_FADE_KEYFRAMES === "string" && html.includes(OFF_FADE_KEYFRAMES),
    "the shared pmDemoOffFade keyframes",
  );
});

Deno.test("REQ-877 (dm5 m1): the stage hands PointerGhost the off ghost and his initial, keys the mark on her spot, and does not hold an off ghost back for REQ-789's rest (hers shows at once)", async () => {
  const stage = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  const ghostEl = stage.slice(
    stage.indexOf("<PointerGhost"),
    stage.indexOf("/>", stage.indexOf("<PointerGhost")),
  );
  assert(ghostEl.includes("off={ghost.off}"), "off={ghost.off}");
  assert(/initial=\{myInitial\}/.test(ghostEl), "initial={myInitial}");
  assert(
    /const myInitial = initialOf\(presenterNameOf\(demo\?\.pid\)\)/.test(stage),
    "his initial from his name, as the customer's roster has it",
  );
  assert(
    /if \(wait > 0 && !g\.off\)/.test(stage),
    "REQ-877: an off ghost skips the rest wait",
  );
  assert(
    /was\.off\?\.key === g\.off\?\.key/.test(stage),
    "a new spot is a new ghost (its fade restarts)",
  );
  const ghost = await Deno.readTextFile(
    new URL("../components/demo-mode/PointerGhost.tsx", import.meta.url),
  );
  assert(/key=\{off\.key\}/.test(ghost), "the mark is keyed on her spot");
  const pointer = await Deno.readTextFile(
    new URL("../components/demo-mode/DemoPointer.tsx", import.meta.url),
  );
  assert(
    pointer.includes("OFF_FADE_KEYFRAMES"),
    "her marker uses the shared keyframes too",
  );
});
