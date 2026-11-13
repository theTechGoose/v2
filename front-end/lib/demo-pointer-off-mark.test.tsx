/**
 * REQ-635 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 5 (run r37f88707), issue m37: "Stray '<' chevron on the left edge of every app
 * page on a phone". It was REQ-451's off-screen marker (the presenter's mouse beside the phone
 * frame on his stage): a bare chevron with no name, over the page's modal dims, there for good.
 * The marker now carries the presenter's initial on a dot in his colour, fades out after
 * OFF_MARK_SHOW_MS (a new spot shows it again), and on the customer's screen sits at OFF_MARK_Z,
 * under the app's modal dims. DemoPointer is rendered for real (SSR).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer from "../components/demo-mode/DemoPointer.tsx";
import {
  initialOf,
  OFF_BADGE_PX,
  OFF_MARK_FADE_MS,
  OFF_MARK_PX,
  OFF_MARK_SHOW_MS,
  OFF_MARK_Z,
  offBadge,
} from "../../shared/demo-mode/presenter-anchor.ts";

const phone = { left: 0, top: 0, width: 390, height: 844 };
function drawOff(
  pointer: { x: number; y: number },
  extra: { offZ?: number; name?: string } = {},
) {
  const html = renderToString(
    <DemoPointer
      pointer={pointer}
      outside
      off
      waves={[]}
      name={extra.name ?? "Alex"}
      color="#7a3fd1"
      z={2147483001}
      offZ={extra.offZ}
      attach={() => {}}
      bounds={phone}
    />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}
const styleOf = (el: Element) => el.getAttribute("style") ?? "";

Deno.test("REQ-635 (demo m37) the off marker says whose it is: the presenter's initial on a dot in his colour", () => {
  const doc = drawOff({ x: 0, y: 338 });
  const mark = doc.querySelector(
    '[data-cy="demo-pointer-off-mark"]',
  ) as Element;
  assert(mark, "the off marker is drawn");
  const badge = mark.querySelector(
    '[data-cy="demo-pointer-off-initial"]',
  ) as Element;
  assert(badge, "the marker carries an initial — not a bare chevron");
  assertEquals(badge.textContent, "A");
  assert(
    /background:#7a3fd1/.test(styleOf(badge)),
    `the dot is the presenter's colour: ${styleOf(badge)}`,
  );
  // the chevron is still there, in his colour
  const chevron = Array.from(mark.querySelectorAll("path")).find((p) =>
    (p as Element).getAttribute("stroke") === "#7a3fd1"
  );
  assert(chevron, "the chevron is drawn in his colour");
  // no full name tag over the page's controls (REQ-451 kept)
  assertEquals(doc.querySelector('[data-cy="demo-pointer-tag"]'), null);
});

Deno.test("REQ-635 (demo m37) the marker fades out after OFF_MARK_SHOW_MS — it does not sit on every page for good", () => {
  assert(OFF_MARK_SHOW_MS >= 2000 && OFF_MARK_SHOW_MS <= 3000, "2-3 s shown");
  assert(OFF_MARK_FADE_MS > 0 && OFF_MARK_FADE_MS <= 1000, "a short fade");
  const doc = drawOff({ x: 0, y: 338 });
  const mark = doc.querySelector(
    '[data-cy="demo-pointer-off-mark"]',
  ) as Element;
  const s = styleOf(mark);
  const anim = s.match(/animation:pmDemoOffFade (\d+)ms[^;]*forwards/);
  assert(anim, `the marker runs the fade-out animation: ${s}`);
  assertEquals(Number(anim[1]), OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS);
  const html = doc.documentElement!.outerHTML;
  const kf = html.match(/@keyframes pmDemoOffFade\{([^}]*\}[^}]*\}[^}]*\})\}/);
  assert(kf, "the fade's keyframes are defined");
  assert(/100%\{opacity:0\}/.test(kf[1]), `it ends invisible: ${kf[1]}`);
});

Deno.test("REQ-635 (demo m37) on the customer's screen the off marker sits under modal dims (offZ), the arrow stays on top", () => {
  // the app's lowest modal dim is z-index 50 (verify.css, quotes.css); TransferAccount etc. 60
  assert(OFF_MARK_Z < 50, `OFF_MARK_Z ${OFF_MARK_Z} is under the modal dims`);
  const off = drawOff({ x: 0, y: 338 }, { offZ: OFF_MARK_Z });
  const box = off.querySelector('[data-cy="demo-pointer"]') as Element;
  assert(
    new RegExp(`z-index:${OFF_MARK_Z}(;|$)`).test(styleOf(box)),
    `off: the pointer's layer is OFF_MARK_Z — ${styleOf(box)}`,
  );
  // not off: the arrow keeps the overlay's z, above everything
  const html = renderToString(
    <DemoPointer
      pointer={{ x: 100, y: 300 }}
      waves={[]}
      name="Alex"
      color="#7a3fd1"
      z={2147483001}
      offZ={OFF_MARK_Z}
      attach={() => {}}
      bounds={phone}
    />,
  );
  const on = new DOMParser().parseFromString(html, "text/html")!
    .querySelector('[data-cy="demo-pointer"]') as Element;
  assert(/z-index:2147483002/.test(styleOf(on)), styleOf(on));
});

Deno.test("REQ-635 offBadge sits the initial on the inner side of the chevron, never past the edge it is off", () => {
  // off the left edge: the dot to the chevron's right
  const l = offBadge({ x: 0, y: 338 }, phone);
  assert(l.left >= OFF_MARK_PX, `right of the chevron: ${JSON.stringify(l)}`);
  // off the right edge (the arrow box clamped inside): the dot to its left
  const r = offBadge({ x: 366, y: 338 }, phone);
  assert(
    r.left + OFF_BADGE_PX <= 0,
    `left of the chevron: ${JSON.stringify(r)}`,
  );
  // off the top: below it; off the bottom: above it
  assert(offBadge({ x: 180, y: 0 }, phone).top >= OFF_MARK_PX);
  assert(offBadge({ x: 180, y: 814 }, phone).top + OFF_BADGE_PX <= 0);
});

Deno.test("REQ-635 initialOf: the first letter of the name, upper-cased; '?' for none", () => {
  assertEquals(initialOf("alex Rivera"), "A");
  assertEquals(initialOf("  Ñandú"), "Ñ");
  assertEquals(initialOf(""), "?");
});
