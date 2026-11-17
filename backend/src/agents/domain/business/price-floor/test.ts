import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { describeJobSize, plausibilityFloorCents } from "./mod.ts";

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

/**
 * REQ-575 (demo-loop cycle 4, M13): "Quote 120 ft of 6 ft cedar privacy fence
 * with one gate for Joe Patterson" was drafted at $1,200 ($10/ft) + a $400
 * gate and saved as it came — plausibilityFloorCents returned 0 for anything
 * that is not a gut / remodel. A fence, a deck and a roof now have a floor
 * per unit of their size (linear ft, sq ft, roofing square); a repair or a
 * size-less mention still has none.
 */
const FENCE_M13 =
  "Quote 120 ft of 6 ft cedar privacy fence with one gate for Joe Patterson";

Deno.test("REQ-575 M13 plausibilityFloorCents: pair 8's 120 ft cedar privacy fence + gate has a floor over the demo's $1,600 and under Hank's own $5,450", () => {
  const floor = plausibilityFloorCents(FENCE_M13, "");
  assert(floor > 160_000, `fence floor ${floor} must catch $1,200 + $400`);
  assert(
    floor < 545_000,
    `fence floor ${floor} must pass $40/ft + a $650 gate`,
  );
  // the height (6 ft) is not the length
  assert(floor >= 120 * 1_500, `floor ${floor} reads 120 ft, not 6 ft`);
  // the model's own line carries the same size
  assertEquals(
    plausibilityFloorCents(
      "cedar fence for Joe",
      "Cedar privacy fence installation (120 ft, 6 ft height)\nGate installation",
    ),
    floor,
  );
});

Deno.test("REQ-575 M13 plausibilityFloorCents: chain link < plain wood < privacy / cedar per foot; more feet, more floor", () => {
  const chain = plausibilityFloorCents(
    "Install 200 ft of 4 ft chain link fence",
    "",
  );
  const wood = plausibilityFloorCents(
    "Install 200 ft of wood picket fence",
    "",
  );
  const cedar = plausibilityFloorCents(
    "Install 200 ft of 6 ft cedar privacy fence",
    "",
  );
  assert(
    chain > 0 && chain < wood && wood < cedar,
    `${chain} ${wood} ${cedar}`,
  );
  assert(
    plausibilityFloorCents("Install 300 ft of cedar privacy fence", "") > cedar,
    "longer fence, higher floor",
  );
  assert(
    plausibilityFloorCents(
      "Instalar cerca de madera de 150 pies lineales",
      "",
    ) > 0,
    "Spanish fence",
  );
});

Deno.test("REQ-575 M13 plausibilityFloorCents: a fence repair, a fence with no length, 'cerca de 18 mil' have no floor", () => {
  assertEquals(plausibilityFloorCents("Fence repair - replace 3 posts", ""), 0);
  assertEquals(plausibilityFloorCents("fix the fence gate latch", ""), 0);
  assertEquals(
    plausibilityFloorCents("New cedar fence for the backyard", ""),
    0,
  );
  assertEquals(
    plausibilityFloorCents("pintar 3 cuartos, cerca de 120 pies cuadrados", ""),
    0,
  );
});

Deno.test("REQ-575 M13 plausibilityFloorCents: a new deck has a floor per sq ft (composite higher); staining one has none", () => {
  const wood = plausibilityFloorCents(
    "Build a 12x16 deck off the back door",
    "",
  );
  const composite = plausibilityFloorCents("Build a 12x16 composite deck", "");
  assert(wood >= 192 * 1_000, `wood deck floor ${wood}`);
  assert(composite > wood, `${composite} > ${wood}`);
  assert(
    composite < 192 * 4_000,
    `composite floor ${composite} stays a sanity floor`,
  );
  assert(plausibilityFloorCents("New 300 sq ft deck", "") > wood);
  assertEquals(plausibilityFloorCents("Stain and seal a 12x16 deck", ""), 0);
  assertEquals(plausibilityFloorCents("Deck repair, 12x16, 4 boards", ""), 0);
});

Deno.test("REQ-575 M13 plausibilityFloorCents: a roof replacement has a floor per square; a roof repair has none", () => {
  const squares = plausibilityFloorCents(
    "Replace the roof, 25 squares, architectural shingles",
    "",
  );
  assert(squares >= 25 * 25_000, `roof floor ${squares}`);
  assert(squares < 25 * 70_000, `roof floor ${squares} stays a sanity floor`);
  assert(
    plausibilityFloorCents("New roof on a 2,000 sq ft house, tear off", "") > 0,
    "sq ft of roof",
  );
  assertEquals(
    plausibilityFloorCents("Roof leak repair over the garage", ""),
    0,
  );
  assertEquals(plausibilityFloorCents("Replace the roof", ""), 0);
});

Deno.test("REQ-575 M13 plausibilityFloorCents: labor only halves a unit floor too; a remodel keeps its own floor", () => {
  const full = plausibilityFloorCents(FENCE_M13, "");
  assertEquals(
    plausibilityFloorCents(`${FENCE_M13}, labor only`, ""),
    Math.round(full / 2),
  );
  assertEquals(
    plausibilityFloorCents("Full kitchen remodel", ""),
    1_200_000,
  );
});

Deno.test("REQ-575 M13 describeJobSize: the re-ask names the fence's length and gate, not 'a room gut / remodel'", () => {
  const size = describeJobSize(FENCE_M13, "");
  assertStringIncludes(size, "120");
  assertStringIncludes(size, "fence");
  assertStringIncludes(size, "gate");
  assert(!/remodel/.test(size), size);
  assertStringIncludes(
    describeJobSize("Build a 12x16 composite deck", ""),
    "192",
  );
  assertStringIncludes(
    describeJobSize("Replace the roof, 25 squares", ""),
    "25",
  );
  // a remodel still reads as before
  assertStringIncludes(describeJobSize("Full kitchen remodel", ""), "kitchen");
});
