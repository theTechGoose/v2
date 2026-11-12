import { assert, assertEquals } from "#std/assert";
import { plausibilityFloorCents } from "./mod.ts";

/**
 * REQ-382 (demo cycle 2, M22): a master-bath gut with a slab cut and a
 * heated floor came back $1,850 / $2,250 / $2,750 and nothing noticed. The
 * plausibility floor reads the job's size and trade off the text: a gut or
 * remodel with N scope items has a minimum no tier may sit under.
 */

const M22_RAW =
  "Master bath gut for the Patel home: remove old tub/shower combo, walk-in curbless shower (cut the slab to move the drain), " +
  "recessed niche, frameless glass, porcelain tile 12x24 on walls, 60in double vanity, quartz top, 2 undermount sinks " +
  "(faucets supplied by client / grifos los pone la clienta), new exhaust fan and lights, 8x10 heated floor, permit.";
const V1_SCOPE =
  "Remove old tub/shower combo\nInstall walk-in shower with curbless entry\nPorcelain tile 12x24 on walls";

Deno.test("REQ-382 M22 plausibilityFloorCents: a master-bath gut is never under $8,000 — the demo's $2,750 premium sits far below", () => {
  const floor = plausibilityFloorCents(M22_RAW, V1_SCOPE);
  assert(floor >= 800000, `bathroom gut floor ${floor}`);
  assert(275000 < floor, "the demo's premium tier is below the floor");
  // a more detailed gut has a higher floor than a terse one
  assert(
    floor > plausibilityFloorCents("Bathroom remodel", ""),
    "more items, higher floor",
  );
});

Deno.test("REQ-382 M22 plausibilityFloorCents: kitchen > bathroom > other remodel; small jobs have no floor", () => {
  const kitchen = plausibilityFloorCents("Full kitchen remodel", "");
  const bath = plausibilityFloorCents("Full bathroom remodel", "");
  const other = plausibilityFloorCents("Basement remodel", "");
  assert(
    kitchen > bath && bath > other && other > 0,
    `${kitchen} ${bath} ${other}`,
  );
  assertEquals(
    plausibilityFloorCents("Paint 2000 sq ft interior, two coats", ""),
    0,
  );
  assertEquals(plausibilityFloorCents("Replace the bathroom faucet", ""), 0);
  assert(
    plausibilityFloorCents(
      "Remodelación completa del baño, piso radiante, permiso",
      "",
    ) > 0,
    "Spanish gut",
  );
});

Deno.test("REQ-382 M22 plausibilityFloorCents: blanket labor-only halves the floor; one customer-supplied item does not", () => {
  const full = plausibilityFloorCents("Full bathroom remodel", "");
  assertEquals(
    plausibilityFloorCents("Full bathroom remodel, labor only", ""),
    Math.round(full / 2),
  );
  const withFaucet = plausibilityFloorCents(M22_RAW, V1_SCOPE);
  const noFaucet = plausibilityFloorCents(
    M22_RAW.replace(
      " (faucets supplied by client / grifos los pone la clienta)",
      "",
    ),
    V1_SCOPE,
  );
  assertEquals(withFaucet, noFaucet);
});
