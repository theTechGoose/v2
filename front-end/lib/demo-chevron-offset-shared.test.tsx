/**
 * REQ-815 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm1 (run r83b6287b), issue p4: the stage's ghost of an out-of-view arrow (a
 * chevron, REQ-645) sat in the middle of the arrow box (left 5, top 8) while the customer's
 * chevron sat against the edge it is off and centred on the tip (left -7, top 2) — 12 px right and
 * 6 px lower from the same reported tip. Both now take the chevron's offset from one helper that
 * needs only the way to the element (`cueMarkOffset(dir)`), so the two screens draw it alike.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer from "../components/demo-mode/DemoPointer.tsx";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import {
  cueMarkOffset,
  type Dir,
  placedReport,
  placeView,
  reportedGhost,
} from "../../shared/demo-mode/presenter-anchor.ts";
import type { Anchor } from "../../shared/demo-mode/protocol.ts";

const VIEW = { left: 0, top: 0, width: 1000, height: 800 };
/** where the element can be seen: the page's scroller, under a 56 px topbar */
const SCROLLER = { left: 16, top: 56, width: 968, height: 744 };

const svgBox = (html: string, sel: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const svg = doc.querySelector(sel) as Element | null;
  assert(svg, `no chevron (${sel})`);
  const style = svg.getAttribute("style") ?? "";
  const num = (k: string) =>
    Number(style.match(new RegExp(`${k}:(-?[\\d.]+)px`))?.[1]);
  return {
    left: num("left"),
    top: num("top"),
    deg: Number(style.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 0),
  };
};

const customer = (at: { x: number; y: number }, dir: Dir) =>
  svgBox(
    renderToString(
      <DemoPointer
        pointer={at}
        cue={{ box: SCROLLER, text: "Ana is pointing up", dir }}
        waves={[]}
        name="Ana"
        color="#2f6d29"
        z={10}
        attach={() => {}}
        bounds={VIEW}
      />,
    ),
    "[data-cy='demo-pointer-off-mark']",
  );

const stage = (at: { x: number; y: number }, dir: Dir) =>
  svgBox(
    renderToString(
      <PointerGhost
        at={at}
        outside={false}
        dir={dir}
        color="#2f6d29"
        z={10}
        label="You"
        bounds={VIEW}
      />,
    ),
    "[data-cy='demo-pointer-ghost'] svg",
  );

const CASES: { name: string; at: { x: number; y: number }; dir: Dir }[] = [
  {
    name: "above (the tester's case)",
    at: { x: 87.5, y: 56 },
    dir: { dx: 0, dy: -1 },
  },
  { name: "below", at: { x: 400, y: 770 }, dir: { dx: 0, dy: 1 } },
  { name: "right", at: { x: 960, y: 300 }, dir: { dx: 1, dy: 0 } },
  { name: "left", at: { x: 16, y: 300 }, dir: { dx: -1, dy: 0 } },
  { name: "up-left corner", at: { x: 16, y: 56 }, dir: { dx: -1, dy: -1 } },
  // the element is straight above, but the tip sits on the scroller's left edge: the cue's way
  // (up) decides, not the edge the tip happens to touch
  {
    name: "above, tip on the left edge",
    at: { x: 16, y: 56 },
    dir: { dx: 0, dy: -1 },
  },
];

for (const c of CASES) {
  Deno.test(`REQ-815 (demo dm1 p4) the stage's ghost chevron sits where the customer's does — ${c.name}`, () => {
    const cus = customer(c.at, c.dir);
    const stg = stage(c.at, c.dir);
    assertEquals(
      { left: stg.left, top: stg.top, deg: stg.deg },
      { left: cus.left, top: cus.top, deg: cus.deg },
      "ghost svg left/top/turn = the customer's chevron",
    );
  });
}

Deno.test("REQ-815 (demo dm1 p4) cueMarkOffset: against the edge it is off, centred on the tip along it", () => {
  // up: centred on the tip across (-7), 2 px in from the top edge
  assertEquals(cueMarkOffset({ dx: 0, dy: -1 }), {
    left: -7,
    top: 2,
    deg: -90,
  });
  // down: against the bottom of the 24 × 30 arrow box (30 - 14 - 2)
  assertEquals(cueMarkOffset({ dx: 0, dy: 1 }), { left: -7, top: 14, deg: 90 });
  // right: against its right side (24 - 14 - 2), centred on the tip down
  assertEquals(cueMarkOffset({ dx: 1, dy: 0 }), { left: 8, top: -7, deg: 0 });
  assertEquals(cueMarkOffset({ dx: -1, dy: 0 }), {
    left: 2,
    top: -7,
    deg: 180,
  });
});

Deno.test("REQ-815 (demo dm1 p4) round trip: the customer places + reports, the stage draws the ghost from the report — same chevron box on both", () => {
  const a: Anchor = { vx: 0.0875, vy: 0 };
  // the element is 300 px above the scroller's top
  const p = placeView({ x: 87.5, y: -244 }, SCROLLER);
  assert(p.dir, "out of view");
  const report = placedReport("pid", a, p, VIEW);
  // the stage's frame is the same size here: the reported fraction lands on the same tip
  const g = reportedGhost(
    { a, at: { x: 500, y: 500 } } as unknown as Parameters<
      typeof reportedGhost
    >[0],
    report,
    VIEW,
  );
  assert(g?.dir, "the stage draws the chevron");
  const cus = customer(p.at, p.dir);
  const stg = stage(g.at, g.dir);
  // the report carries the tip as a 4-decimal fraction: the same pixel within half a pixel
  assertAlmostEquals(stg.left + g.at.x, cus.left + p.at.x, 0.5);
  assertAlmostEquals(stg.top + g.at.y, cus.top + p.at.y, 0.5);
});
