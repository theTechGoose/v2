import { assertEquals } from "#std/assert";
import { deriveBasis } from "./mod.ts";

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
