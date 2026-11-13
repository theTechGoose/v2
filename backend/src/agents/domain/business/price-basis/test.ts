import { assertEquals } from "#std/assert";
import { customerSuppliedItems, deriveBasis, isLaborOnly } from "./mod.ts";

/**
 * REQ-332 (demo cycle 1, m30): "Prices include labor and materials" was a
 * constant — the contractor's "they're buying the vanity themselves" never
 * reached it. The basis is derived from the raw message + confirmed scope.
 */

Deno.test("REQ-332 deriveBasis: a plain job → labor_and_materials", () => {
  assertEquals(
    deriveBasis("Paint 2000 sq ft interior, two coats"),
    "labor_and_materials",
  );
  assertEquals(
    deriveBasis(
      "Full gut of the hall bathroom, permit included",
      "Demo to studs\nTile",
    ),
    "labor_and_materials",
  );
});

Deno.test("REQ-332 deriveBasis: the customer buys an item themselves → labor; materials as noted", () => {
  assertEquals(
    deriveBasis(
      "Replace the vanity and the faucet in the hall bath — they're buying the vanity themselves.",
    ),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis(
      "Install 4 recessed lights. Customer is supplying the fixtures.",
    ),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Homeowner already bought the tile, we install it"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Hang 3 ceiling fans the client provides"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Owner-supplied cabinets, we do the install"),
    "labor_materials_as_noted",
  );
});

Deno.test("REQ-332 deriveBasis: labor-only / materials-not-included wording", () => {
  assertEquals(
    deriveBasis("Labor only — install the customer's flooring"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Tile the shower, materials not included"),
    "labor_materials_as_noted",
  );
});

Deno.test("REQ-332 deriveBasis: Spanish — el cliente compra / pone / solo mano de obra", () => {
  assertEquals(
    deriveBasis("Cambiar el lavabo, el cliente compra el lavabo"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Instalar 4 luces, los materiales los pone el cliente"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Pintar la cocina, solo mano de obra"),
    "labor_materials_as_noted",
  );
  assertEquals(
    deriveBasis("Pintar la cocina, dos manos, 2000 pies cuadrados"),
    "labor_and_materials",
  );
});

Deno.test("REQ-332 deriveBasis: the confirmed scope counts too", () => {
  assertEquals(
    deriveBasis(
      "Bathroom refresh",
      "Install customer-supplied vanity\nReplace faucet",
    ),
    "labor_materials_as_noted",
  );
});

Deno.test("REQ-332 deriveBasis: the contractor buying materials is NOT the customer supplying them", () => {
  assertEquals(
    deriveBasis("I'll buy the paint at Sherwin, two coats, 1,200 sq ft"),
    "labor_and_materials",
  );
  assertEquals(
    deriveBasis("We supply all materials and haul away the debris"),
    "labor_and_materials",
  );
});

// ── REQ-382 — demo cycle 2, M22 ─────────────────────────────────────────
// A master-bath gut where the client supplies only the faucets was priced
// $1,850–$2,750: the basis line told the model to "price the labor and only
// the materials the contractor provides". The basis stays "as noted" (the
// faucets ARE the customer's), but the items the customer supplies are named
// so everything else is priced in full.

const M22_RAW =
  "Master bath gut for the Patel home: remove old tub/shower combo, walk-in curbless shower (cut the slab to move the drain), " +
  "recessed niche, frameless glass, porcelain tile 12x24 on walls, 60in double vanity, quartz top, 2 undermount sinks " +
  "(faucets supplied by client / grifos los pone la clienta), new exhaust fan and lights, 8x10 heated floor, permit.";

Deno.test("REQ-382 M22 deriveBasis: the faucet clause makes the basis 'as noted'", () => {
  assertEquals(deriveBasis(M22_RAW), "labor_materials_as_noted");
});

Deno.test("REQ-382 M22 customerSuppliedItems: names ONLY the clause the customer supplies", () => {
  assertEquals(customerSuppliedItems(M22_RAW), [
    "faucets supplied by client / grifos los pone la clienta",
  ]);
  assertEquals(
    customerSuppliedItems("Owner-supplied cabinets, we do the install"),
    [
      "Owner-supplied cabinets",
    ],
  );
  assertEquals(
    customerSuppliedItems("Paint 2000 sq ft interior, two coats"),
    [],
  );
  // the contractor buying is not a customer-supplied item
  assertEquals(customerSuppliedItems("Customer wants us to buy the tile"), []);
});

Deno.test("REQ-382 M22 isLaborOnly: only blanket labor-only wording, never one supplied item", () => {
  assertEquals(isLaborOnly(M22_RAW), false);
  assertEquals(
    isLaborOnly("Labor only — install the customer's flooring"),
    true,
  );
  assertEquals(isLaborOnly("Tile the shower, materials not included"), true);
});
