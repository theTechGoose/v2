/**
 * REQ-761 — demo-loop cycle 5v2, issue c4-S12b (re-opened by the verifier): the customer's
 * pointer resting on 'TBD' was drawn at opacity 1 and hid its letters, so the employee read
 * 'Today'. The arrow DemoPointer draws (on the employee's stage and on the customer's screen)
 * is rendered for real (SSR) with the resting and the moving look.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { PointerArrow } from "../components/demo-mode/DemoPointer.tsx";
import { pointerLook } from "../../shared/demo-mode/motion.ts";

const CUSTOMER_GREEN = "#2f6d29";
function arrow(resting: boolean) {
  const html = renderToString(
    <PointerArrow look={pointerLook(resting)} color={CUSTOMER_GREEN} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const svg = doc.querySelector("svg") as Element;
  const paths = Array.from(svg.querySelectorAll("path")) as Element[];
  const body = paths.find((p) => p.getAttribute("fill") === CUSTOMER_GREEN)!;
  const opacity = Number(
    (svg.getAttribute("style") ?? "").match(/(?:^|;)opacity:([\d.]+)/)?.[1] ??
      1,
  );
  const fill = Number(body.getAttribute("fill-opacity") ?? 1);
  return { svg, body, opacity, fill };
}

Deno.test("REQ-761 (demo c4-S12b, cycle 5v2) the resting customer's arrow over 'TBD' lets the letters show through", () => {
  const a = arrow(true);
  assert(
    a.opacity < 1,
    `the resting arrow is semi-transparent, got opacity ${a.opacity}`,
  );
  assert(
    a.opacity >= 0.7,
    `its outline is not faint (REQ-374 p8), got ${a.opacity}`,
  );
  assert(
    a.opacity * a.fill <= 0.5,
    `its green body hides at most half of the letters, got ${
      a.opacity * a.fill
    }`,
  );
  assertEquals(
    a.body.getAttribute("stroke"),
    "#1a1a1a",
    "the dark outline stays",
  );
});

Deno.test("REQ-761 (demo c4-S12b) a moving arrow is drawn solid", () => {
  const a = arrow(false);
  assertEquals(a.opacity, 1);
  assertEquals(a.fill, 1);
});
