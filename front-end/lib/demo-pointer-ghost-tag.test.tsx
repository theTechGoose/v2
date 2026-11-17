/**
 * REQ-642 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issue m10: the stage's ghost of the presenter's own arrow
 * carried a long tag ("Your pointer on {name}'s screen") placed with no element and no covers
 * check (`tagPlacement(…, null)`), so it always went under the arrow's tail, over the replica.
 * The ghost now takes the anchored element's box (`rect`) and a `covers` hit-test, and the tag is
 * placed outside the element, next to the arrow, off the other controls — as DemoPointer's is.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";

const BOUNDS = { left: 0, top: 0, width: 1000, height: 800 };
const tagOf = (html: string) =>
  new DOMParser().parseFromString(html, "text/html")!.querySelector(
    "[data-cy='demo-pointer-ghost-label']",
  )!;

Deno.test("REQ-642 (demo m10) PointerGhost: the tag sits outside the anchored element, not under the arrow's tail over it", () => {
  // a 160 × 60 card with the tip in its middle: the tail spot is inside the card
  const rect = { left: 420, top: 370, width: 160, height: 60 };
  const html = renderToString(
    <PointerGhost
      at={{ x: 500, y: 400 }}
      outside={false}
      color="#2f6d29"
      z={10}
      label="You"
      bounds={BOUNDS}
      rect={rect}
    />,
  );
  const side = tagOf(html).getAttribute("data-tag-side");
  assert(
    side !== "tail" && side !== "tail-up",
    `the tag went under the arrow's tail, over the card (side ${side})`,
  );
});

Deno.test("REQ-642 (demo m10) PointerGhost: a side that covers another control gives way to the next", () => {
  const rect = { left: 420, top: 370, width: 160, height: 60 };
  const free = renderToString(
    <PointerGhost
      at={{ x: 500, y: 400 }}
      outside={false}
      color="#2f6d29"
      z={10}
      label="You"
      bounds={BOUNDS}
      rect={rect}
    />,
  );
  const first = tagOf(free).getAttribute("data-tag-side");
  const blocked = renderToString(
    <PointerGhost
      at={{ x: 500, y: 400 }}
      outside={false}
      color="#2f6d29"
      z={10}
      label="You"
      bounds={BOUNDS}
      rect={rect}
      covers={(r) => r.top < rect.top}
    />,
  );
  const second = tagOf(blocked).getAttribute("data-tag-side");
  assertEquals(first, "above");
  assert(second !== "above", `still above, over the control (${second})`);
});
