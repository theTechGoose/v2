/**
 * REQ-293 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 1, issue p11: the demo stage's mirror frame (a replayed copy of
 * the customer's DOM) was reachable by Tab and screen readers, and the amount
 * pad's odometer read "0123456789" per digit instead of the input's value.
 *
 * MoneyInput is rendered for real (SSR). The stage's iframe only exists once a
 * live demo has been fetched (a state SSR cannot reach), so its attributes are
 * pinned on the source of the `<iframe` element, the way REQ-289 pins its
 * post-click surfaces.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import MoneyInput from "../islands/MoneyInput.tsx";

function hiddenFromAT(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.getAttribute("aria-hidden") === "true") return true;
    cur = cur.parentElement;
  }
  return false;
}

Deno.test("REQ-293 the amount pad's rolling digits are hidden from assistive tech; the labelled input is the only accessible value", () => {
  const html = renderToString(<MoneyInput initialCents={1234} lang="en" />);
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const odos = Array.from(doc.querySelectorAll(".odo")) as Element[];
  assert(odos.length >= 2, "the pad renders its integer and decimal odometers");
  for (const odo of odos) {
    assertEquals(
      odo.getAttribute("aria-hidden"),
      "true",
      `the odometer wrapper is aria-hidden: ${odo.outerHTML.slice(0, 80)}`,
    );
  }
  const digits = Array.from(doc.querySelectorAll(".odo__digit")) as Element[];
  assert(digits.length >= 40, "every digit column rolls ten digits");
  for (const d of digits) {
    assert(hiddenFromAT(d), "a rolling digit is never read by AT");
  }
  const input = doc.querySelector("input.mi__input") as Element | null;
  assert(input, "the real value is an input");
  assert(input.getAttribute("aria-label"), "the input carries the label");
  assert(!hiddenFromAT(input), "the input stays accessible");
});

Deno.test("REQ-293 the stage's mirror frame is a picture to AT: inert, aria-hidden, unfocusable, role=img with its title", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  const m = src.match(/<iframe\b([\s\S]*?)\/>/);
  assert(m, "the stage renders one <iframe … />");
  const attrs = m[1];
  assert(/data-cy="demo-frame"/.test(attrs), "it is the demo frame");
  assert(/\binert\b/.test(attrs), "the frame is inert");
  assert(/aria-hidden="true"/.test(attrs), "the frame is aria-hidden");
  assert(
    /tabindex=\{?-1\}?|tabindex="-1"/.test(attrs),
    "the frame is not in the tab order",
  );
  assert(/role="img"/.test(attrs), "the frame is a picture");
  assert(/title=\{t\("demoMode.theirScreen"/.test(attrs), "it keeps its title");
});
