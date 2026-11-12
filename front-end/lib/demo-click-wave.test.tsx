/**
 * REQ-431 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 3, issue m28: the click wave lasted only 1.1 s (one 1100 ms ring fading to 0,
 * dropped from state after WAVE_MS) and was missed by eye. The ring now repeats (about 2.5–3 s in
 * all) and the LAST click leaves a small dot that fades over about 4 s; the dot is drawn at the
 * wave's x/y, so `placeWavesAgain` re-places it with the anchor. DemoPointer is rendered for real.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import * as DP from "../components/demo-mode/DemoPointer.tsx";
import DemoPointer, {
  type Wave,
} from "../components/demo-mode/DemoPointer.tsx";

// looked up at run time: a missing export fails its own tests, not the whole file
const { CLICK_DOT_MS, WAVE_MS } = DP as unknown as {
  CLICK_DOT_MS: number;
  WAVE_MS: number;
};

function draw(waves: Wave[]) {
  const html = renderToString(
    <DemoPointer
      pointer={null}
      waves={waves}
      name="Rosa"
      color="#2f6d29"
      z={10}
      attach={() => {}}
    />,
  );
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
}
const styleOf = (el: Element) => el.getAttribute("style") ?? "";
/** `animation:<name> <ms>ms <easing> <count>` → total ms the animation runs */
function animation(el: Element) {
  const m = styleOf(el).match(
    /animation:(\w+) (\d+)ms [\w-]+(?: (\d+|infinite))?/,
  );
  assert(m, `an animation on ${styleOf(el)}`);
  const count = m[3] === undefined ? 1 : Number(m[3]);
  return { name: m[1], ms: Number(m[2]), count, total: Number(m[2]) * count };
}

const two: Wave[] = [{ id: 1, x: 100, y: 120 }, { id: 2, x: 300, y: 340 }];

Deno.test("REQ-431 (demo m28, cycle 3) the click ring repeats 2–3 times, about 2.5–3 s in all", () => {
  const doc = draw(two);
  const rings = Array.from(
    doc.querySelectorAll('[data-cy="demo-wave"]'),
  ) as Element[];
  assertEquals(rings.length, 2, "one ring per wave");
  const a = animation(rings[1]);
  assertEquals(a.name, "pmDemoWave");
  assert(
    a.count >= 2 && a.count <= 3,
    `the ring repeats 2–3 times, got ${a.count}`,
  );
  assert(
    a.total >= 2500 && a.total <= 3200,
    `the rings run about 2.5–3 s in all, got ${a.total} ms`,
  );
});

Deno.test("REQ-431 (demo m28, cycle 3) the last click leaves one small dot at its point that fades over about 4 s", () => {
  const doc = draw(two);
  const dots = Array.from(
    doc.querySelectorAll('[data-cy="demo-click-dot"]'),
  ) as Element[];
  assertEquals(dots.length, 1, "only the last click is marked");
  const s = styleOf(dots[0]);
  assert(
    /left:300px;top:340px/.test(s),
    `the dot sits on the last click: ${s}`,
  );
  const w = Number(s.match(/width:(\d+)px/)?.[1]);
  assert(w > 0 && w <= 24, `the dot is small, got ${w}px`);
  const a = animation(dots[0]);
  assertEquals(a.count, 1);
  assert(
    a.total >= 3500 && a.total <= 4500,
    `the dot fades over about 4 s, got ${a.total} ms`,
  );
  assertEquals(a.total, CLICK_DOT_MS);
  const html = doc.body.innerHTML;
  assert(
    new RegExp(`@keyframes ${a.name}\\{[^@]*100%\\{[^}]*opacity:0`).test(html),
    "the dot's keyframes end at opacity 0",
  );
});

Deno.test("REQ-431 (demo m28, cycle 3) a wave stays in state until its dot has faded, and no longer than needed", () => {
  const ring = animation(
    draw(two).querySelector('[data-cy="demo-wave"]') as Element,
  );
  assert(WAVE_MS >= ring.total, "the ring is not cut short");
  assert(WAVE_MS >= CLICK_DOT_MS, "the dot is not cut short");
  assert(WAVE_MS <= CLICK_DOT_MS + 500, `then it goes, got ${WAVE_MS} ms`);
});

Deno.test("REQ-431 (demo m28, cycle 3) the dot follows its wave when it is placed again", () => {
  const before = draw([{ id: 7, x: 50, y: 60 }]);
  const after = draw([{ id: 7, x: 50, y: 160 }]); // placeWavesAgain moved it
  const at = (d: typeof before) =>
    styleOf(d.querySelector('[data-cy="demo-click-dot"]') as Element);
  assert(/left:50px;top:60px/.test(at(before)));
  assert(/left:50px;top:160px/.test(at(after)), "the dot moved with the wave");
});

Deno.test("REQ-431 (demo m28, cycle 3) the stage and the peer pointer drop a wave after WAVE_MS", async () => {
  for (
    const rel of [
      "../islands/DemoStage.tsx",
      "../components/demo-mode/PeerPointer.tsx",
    ]
  ) {
    const src = await Deno.readTextFile(new URL(rel, import.meta.url));
    assert(
      /setWaves\(\(w\) => w\.filter\(\(x\) => x\.id !== id\)\),\s*WAVE_MS,/
        .test(src),
      `${rel} removes the wave after WAVE_MS`,
    );
  }
});
