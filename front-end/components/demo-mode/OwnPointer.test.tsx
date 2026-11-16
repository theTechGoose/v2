/**
 * REQ-813 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm1 (run r83b6287b), issue m4: the stage drew the presenter's own "You" arrow at
 * full strength while its banner said his pointer was not on the customer's screen. The marker
 * (`OwnMarker`, drawn by OwnPointer) now shows what the customer has: dimmed and hollow with a
 * "not shown" tag while absent, the "pointing…" look while pending, full strength only when live.
 */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { OwnMarker } from "./OwnPointer.tsx";
import { OWN_ABSENT_OPACITY } from "../../../shared/demo-mode/presenter-anchor.ts";

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

const base = {
  at: { x: 100, y: 200 },
  color: "#2a7",
  z: 10,
  label: "You",
  tagged: true,
  absentLabel: "You · not shown",
  pendingLabel: "pointing…",
};

Deno.test("REQ-813 (demo dm1 m4): live — full strength, filled, tagged 'You', no data-absent", () => {
  const doc = parse(renderToString(<OwnMarker {...base} look="live" />));
  const el = doc.querySelector("[data-cy='demo-pointer-own']")!;
  assert(el, "the marker is drawn");
  assert(!el.hasAttribute("data-absent"), "not absent");
  assert(!el.hasAttribute("data-pending"), "not pending");
  assert(!/opacity:/.test(el.getAttribute("style") ?? ""), "full strength");
  assertEquals(
    doc.querySelector("[data-cy='demo-pointer-own-label']")?.textContent,
    "You",
  );
});

Deno.test("REQ-813 (demo dm1 m4): absent (pointerAbsent true) — dimmed, hollow, tagged 'not shown', data-absent", () => {
  const doc = parse(renderToString(<OwnMarker {...base} look="absent" />));
  const el = doc.querySelector("[data-cy='demo-pointer-own']")!;
  assert(el, "the marker is still drawn (where he pointed)");
  assert(el.hasAttribute("data-absent"), "data-absent");
  assertMatch(
    el.getAttribute("style") ?? "",
    new RegExp(`opacity:${OWN_ABSENT_OPACITY}`),
  );
  const paths = el.querySelectorAll("path");
  const fill = (paths[paths.length - 1] as unknown as Element).getAttribute(
    "fill",
  );
  assertEquals(fill, "none", "hollow: no fill");
  assertEquals(
    doc.querySelector("[data-cy='demo-pointer-own-label']")?.textContent,
    "You · not shown",
  );
});

Deno.test("REQ-813 (demo dm1 m4): absent is tagged even while a ghost carries 'You' (tagged false)", () => {
  const doc = parse(
    renderToString(<OwnMarker {...base} tagged={false} look="absent" />),
  );
  assertEquals(
    doc.querySelector("[data-cy='demo-pointer-own-label']")?.textContent,
    "You · not shown",
  );
});

Deno.test("REQ-813 (demo dm1 m4): pending — the customer's 'pointing…' look, data-pending", () => {
  const doc = parse(renderToString(<OwnMarker {...base} look="pending" />));
  const el = doc.querySelector("[data-cy='demo-pointer-own']")!;
  assert(el.hasAttribute("data-pending"), "data-pending");
  assert(!el.hasAttribute("data-absent"), "pending is not absent");
  const tag = doc.querySelector("[data-cy='demo-pointer-own-pending']");
  assert(tag, "the pointing… words");
  assertMatch(tag!.textContent ?? "", /pointing…/);
});
