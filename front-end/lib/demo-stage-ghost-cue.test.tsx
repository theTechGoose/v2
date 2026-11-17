/**
 * REQ-843 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm3 (run r02524ccd), issue p15: the stage's out-of-view ghost read
 * "You · Alex is pointing below — scroll ↓" ("Tú · Alex señala más arriba — desplázate ↑",
 * fleet-2/stdout:25) — the presenter named twice in a sentence written for the customer.
 * REQ-837 req 4 had DemoStage word the presenter's OWN ghost with the customer's cue
 * (`cueKey` + `{name: presenterNameOf(demo.pid)}`). Now the ghost has its own second-person
 * words (`ownCueKey` → `demoMode.pointerGhostCue.*`, no {name}); colleagues keep `cueKey` + name.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import { cueKey, ownCueKey } from "../../shared/demo-mode/presenter-anchor.ts";

const DIRS = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
];
const lang = async (l: string) =>
  JSON.parse(
    await Deno.readTextFile(new URL(`../../lang/${l}.json`, import.meta.url)),
  ) as Record<string, string>;

Deno.test("REQ-843 (demo dm3 p15) unit: ownCueKey gives the ghost its own key per direction, never the customer's", () => {
  assertEquals(ownCueKey({ dx: 0, dy: 1 }), "demoMode.pointerGhostCue.below");
  assertEquals(ownCueKey({ dx: 0, dy: -1 }), "demoMode.pointerGhostCue.above");
  assertEquals(ownCueKey({ dx: 1, dy: 0 }), "demoMode.pointerGhostCue.right");
  assertEquals(ownCueKey({ dx: -1, dy: 0 }), "demoMode.pointerGhostCue.left");
  for (const d of DIRS) assert(String(ownCueKey(d)) !== String(cueKey(d)));
});

Deno.test("REQ-843 (demo dm3 p15) unit: en and es word all four ghost cues in the second person, with no {name}", async () => {
  for (const l of ["en", "es"]) {
    const dict = await lang(l);
    for (const d of DIRS) {
      const s = dict[ownCueKey(d)];
      assert(s, `${l} lacks ${ownCueKey(d)}`);
      assert(!s.includes("{name}"), `${l} ${ownCueKey(d)} names someone`);
      // the customer's cue keeps its {name} for colleagues
      assert(dict[cueKey(d)].includes("{name}"));
    }
  }
});

Deno.test("REQ-843 (demo dm3 p15) unit: the ghost reads 'You · pointing below — the customer must scroll ↓', the presenter not named", async () => {
  const en = await lang("en");
  const html = renderToString(
    <PointerGhost
      at={{ x: 372, y: 725 }}
      outside={false}
      dir={{ dx: 0, dy: 1 }}
      color="#2a7"
      z={10}
      label={en["demoMode.pointerGhost"]}
      bounds={{ left: 0, top: 0, width: 1000, height: 800 }}
      cueText={en[ownCueKey({ dx: 0, dy: 1 })]}
      cueBox={{ left: 0, top: 56, width: 1000, height: 700 }}
    />,
  );
  const cue = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  )!
    .querySelector("[data-cy='demo-pointer-ghost-cue']");
  assertEquals(
    cue?.textContent,
    "You · pointing below — the customer must scroll ↓",
  );
  assert(!/You · You/.test(cue!.textContent), "label doubled");
});

Deno.test("REQ-843 (demo dm3 p15) integration: DemoStage words its own ghost with ownCueKey (no presenter name), colleagues with cueKey + name", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  const ghost = src.match(/<PointerGhost[\s\S]*?\/>/)?.[0] ?? "";
  assert(ghost, "no PointerGhost in DemoStage");
  assert(
    /cueText=\{[\s\S]*ownCueKey\(ghost\.dir\)/.test(ghost),
    "the ghost is not worded with ownCueKey",
  );
  assert(
    !/presenterNameOf\(/.test(ghost),
    "the ghost still names the presenter to himself",
  );
  assert(
    /text:\s*t\(cueKey\(p\.dir\),\s*\{\s*name:\s*presenterNameOf\(pid\)/.test(
      src,
    ),
    "colleagues lost their named cue",
  );
});
