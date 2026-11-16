/**
 * REQ-831 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm2 (run r9c47ba57), issue m4: "Customer's presenter arrow and click wave are
 * stacked below the demo pill". On the customer's screen the pill (and its folded tab) sat at
 * z-index Z+3 while PeerPointer got z={Z+1}: the wave clip at Z+1, the arrow at Z+2 — both under
 * the pill and under End's question inside it (the tester's elementsFromPoint(1217,771):
 * demo-end-cancel, demo-end-ask, demo-pill, FOOTER — no pointer). The stage draws the arrow above
 * its pill ghost (ghost at Z, pointer at Z+1), so the two screens disagreed.
 *
 * The overlay now gives the presenters' pointers their own layer above the pill: the wave clip and
 * the arrow both have a z-index above the pill's and the tab's, still pointer-events:none, and the
 * off-screen marker keeps OFF_MARK_Z (REQ-635). DemoPointer is rendered for real (SSR) with the z
 * the overlay passes it.
 *
 *   cd front-end && deno test -A lib/demo-pointer-above-pill.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer from "../components/demo-mode/DemoPointer.tsx";
import { OFF_MARK_Z } from "../../shared/demo-mode/presenter-anchor.ts";

const ROOT = new URL("../", import.meta.url);
const overlay = Deno.readTextFileSync(
  new URL("islands/DemoModeOverlay.tsx", ROOT),
);

/** the overlay's base Z */
const Z = Number(overlay.match(/const Z = (\d+);/)?.[1]);

/** resolve an expression of the overlay — `Z + n`, or a const defined as one (chained) — to a number */
function resolve(expr: string, depth = 0): number {
  const e = expr.trim();
  if (depth > 5) throw new Error(`cannot resolve ${e}`);
  if (/^\d+$/.test(e)) return Number(e);
  if (e === "Z") return Z;
  const sum = e.match(/^([A-Za-z_][\w]*)\s*\+\s*(\d+)$/);
  if (sum) return resolve(sum[1], depth + 1) + Number(sum[2]);
  const def = overlay.match(new RegExp(`const ${e} = ([^;]+);`));
  if (def) return resolve(def[1], depth + 1);
  throw new Error(`cannot resolve ${e}`);
}

/** the z the overlay passes PeerPointer */
function pointerZ(): number {
  const tag = overlay.match(/<PeerPointer\b[\s\S]*?\/>/)?.[0] ?? "";
  const z = tag.match(/\bz=\{([^}]+)\}/)?.[1];
  assert(z, `PeerPointer gets a z: ${tag}`);
  return resolve(z);
}

/** the z-index of a style const of the overlay (pillStyle, tabStyle) */
function styleZ(name: string): number {
  const at = overlay.indexOf(`const ${name} =`);
  assert(at >= 0, `${name} is defined`);
  const z = overlay.slice(at).match(/z-index:\$\{\s*([^}]+?)\s*\}/)?.[1];
  assert(z, `${name} has a z-index`);
  return resolve(z);
}

function draw(z: number, extra: { off?: boolean } = {}) {
  const html = renderToString(
    <DemoPointer
      pointer={{ x: 1217, y: 771 }}
      off={extra.off}
      outside={extra.off}
      waves={[{ id: 1, x: 1217, y: 771 }]}
      name="Alex"
      color="#7a3fd1"
      z={z}
      offZ={OFF_MARK_Z}
      attach={() => {}}
      bounds={{ left: 0, top: 0, width: 1280, height: 800 }}
    />,
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
}
const styleOf = (el: Element) => el.getAttribute("style") ?? "";
const zOf = (el: Element) =>
  Number(styleOf(el).match(/z-index:(-?\d+)/)?.[1] ?? NaN);

Deno.test("REQ-831 (demo dm2 m4): on the customer's screen the presenter's arrow is drawn above the demo pill and its folded tab", () => {
  assert(Number.isFinite(Z) && Z > 0, `the overlay's base Z: ${Z}`);
  const pill = styleZ("pillStyle");
  const tab = styleZ("tabStyle");
  const doc = draw(pointerZ());
  const arrow = doc.querySelector('[data-cy="demo-pointer"]') as Element;
  assert(arrow, "the arrow is drawn");
  assert(
    zOf(arrow) > pill,
    `the arrow's z-index ${zOf(arrow)} is above the pill's ${pill}`,
  );
  assert(
    zOf(arrow) > tab,
    `the arrow's z-index ${zOf(arrow)} is above the tab's ${tab}`,
  );
  assert(
    /pointer-events:none/.test(styleOf(arrow)),
    "the arrow never takes a click: the pill's End / Yes / Keep going still do",
  );
});

Deno.test("REQ-831 (demo dm2 m4): the presenter's click wave is drawn above the demo pill too", () => {
  const pill = styleZ("pillStyle");
  const doc = draw(pointerZ());
  const clip = doc.querySelector('[data-cy="demo-wave-clip"]') as Element;
  assert(clip, "the wave clip is drawn");
  assert(
    zOf(clip) > pill,
    `the wave clip's z-index ${zOf(clip)} is above the pill's ${pill}`,
  );
  assert(/pointer-events:none/.test(styleOf(clip)), "the wave takes no click");
  // the arrow stays above its own wave
  const arrow = doc.querySelector('[data-cy="demo-pointer"]') as Element;
  assert(zOf(arrow) > zOf(clip), "the arrow is above its wave");
});

Deno.test("REQ-831 (demo dm2 m4): the off-screen marker keeps OFF_MARK_Z (REQ-635), under the page's modal dims", () => {
  const tag = overlay.match(/<PeerPointer\b[\s\S]*?\/>/)?.[0] ?? "";
  assert(/offZ=\{OFF_MARK_Z\}/.test(tag), `PeerPointer keeps offZ: ${tag}`);
  const arrow = draw(pointerZ(), { off: true }).querySelector(
    '[data-cy="demo-pointer"]',
  ) as Element;
  assertEquals(zOf(arrow), OFF_MARK_Z);
});
