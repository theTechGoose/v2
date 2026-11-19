/**
 * REQ-439 (demo-loop cycle 3, issue M9): job-detail options and first
 * drafts keep what the contractor typed. The demo's kitchen lost "22 lf",
 * "48 sq ft", "35 sq ft", "3x6" and the slab drain from every option; the
 * lawn job lost "4 cuartos de acre"; the master-bath first draft lost the
 * shower bench and the mold allowance. REQ-400's coverage check compared the
 * options with each other, so an item dropped from ALL of them was invisible.
 *
 * shared/quote-flow/typed-coverage.ts reads the TYPED text: its work items
 * (no price talk, no schedule, no customer), the quantities they carry, and
 * which of them a set of lines leaves out.
 */
import {
  missedTypedItems,
  missingQuantities,
  typedQuantities,
  typedWorkItems,
  withQuantity,
} from "../../shared/quote-flow/typed-coverage";
import { customerFactsFrom } from "../../shared/quote-flow/option-bullets";

const KITCHEN =
  "Kitchen remodel for the Hendersons on Barton Hills Dr. Demo the old cabinets and haul away. " +
  "Install 22 lf of shaker cabinets (customer is buying the cabinets, just install labor). " +
  "48 sq ft quartz countertops with undermount sink cutout. 35 sq ft subway tile backsplash 3x6. " +
  "Move the sink plumbing 4 ft. New drain line thru slab to island (trench + patch). " +
  "la señora quiere 5 luces LED debajo de los gabinetes. About 3 weeks, $18,500.";

const BATH =
  'Baño principal: quitar la tina vieja, regadera walk-in con vidrio frameless de 60", ' +
  "145 sq ft de porcelanato en piso y paredes, vanity doble, extractor nuevo, mover el contacto GFCI, " +
  "pintura y drywall. Banco en la regadera. Posible moho detrás de la pared, allowance para remediación. " +
  "Empezamos después de Año Nuevo. Precio? tú dime, yo pienso como 18 mil";

const LAWN =
  "Corte de césped semanal y limpieza de hojas para la casa de Ana Pérez, 4 cuartos de acre, $180";

/** What the demo's options looked like: every item reworded, no number. */
const KITCHEN_NO_NUMBERS = [
  "Demolish old cabinets and haul away debris",
  "Install shaker cabinets supplied by the customer",
  "Quartz countertops with undermount sink cutout",
  "Subway tile backsplash",
  "Move the sink plumbing",
  "Install LED under-cabinet lights",
];

describe("REQ-439 (cycle 3, M9) typed quantities", () => {
  it("REQ-439 reads every quantity the kitchen carries — never the price or the duration", () => {
    const keys = typedQuantities(KITCHEN, "en").map((q) => q.key).sort();
    expect(keys).toEqual(["22", "35", "3x6", "4", "48", "5"].sort());
    const texts = typedQuantities(KITCHEN, "en").map((q) => q.text);
    expect(texts).toEqual(
      expect.arrayContaining(["22 lf", "48 sq ft", "35 sq ft", "4 ft"]),
    );
  });

  it("REQ-439 the lawn job's lot size is a quantity; its $180 is not", () => {
    const qs = typedQuantities(LAWN, "es");
    expect(qs.map((q) => q.text)).toEqual(["4 cuartos de acre"]);
  });

  it("REQ-439 the master bath's 60\" and 145 sq ft are quantities; '18 mil' (the price) is not", () => {
    const keys = typedQuantities(BATH, "es").map((q) => q.key);
    expect(keys).toEqual(expect.arrayContaining(["60", "145"]));
    expect(keys).not.toContain("18");
  });

  it("REQ-439 options without the numbers miss every one of them; options with them miss none", () => {
    const qs = typedQuantities(KITCHEN, "en");
    expect(missingQuantities(KITCHEN_NO_NUMBERS, qs).map((q) => q.key).sort())
      .toEqual(["22", "35", "3x6", "4", "48", "5"].sort());
    const kept = [
      "Demolish old cabinets and haul away debris",
      "Install 22 lf of shaker cabinets supplied by the customer",
      "48 sq ft quartz countertops with sink cutout",
      "35 sq ft subway tile backsplash (3 x 6)",
      "Move the sink plumbing 4 ft",
      "Five LED under-cabinet lights",
    ];
    expect(missingQuantities(kept, qs)).toEqual([]);
  });

  it("REQ-439 a missing quantity goes back into the line that names its item", () => {
    const [lf] = typedQuantities(KITCHEN, "en").filter((q) => q.key === "22");
    expect(withQuantity("Install shaker cabinets supplied by the customer", lf))
      .toBe("Install shaker cabinets supplied by the customer (22 lf)");
    const [lights] = typedQuantities("Exhaust fan + 4 recessed lights", "en");
    expect(withQuantity("Exhaust fan and recessed lights", lights))
      .toBe("Exhaust fan and 4 recessed lights");
  });
});

describe("REQ-439 (cycle 3, M9) typed work items", () => {
  it("REQ-439 price talk and the start date are not work items; the bench and the mold are", () => {
    const items = typedWorkItems(BATH, "es");
    expect(items.some((i) => /banco/i.test(i))).toBe(true);
    expect(items.some((i) => /moho/i.test(i))).toBe(true);
    expect(items.some((i) => /a[ñn]o nuevo|precio|18 mil/i.test(i))).toBe(
      false,
    );
  });

  it("REQ-439 the slab drain dropped from the options is missed", () => {
    const missed = missedTypedItems(
      KITCHEN_NO_NUMBERS,
      typedWorkItems(KITCHEN, "en"),
    );
    expect(missed.some((i) => /slab/i.test(i))).toBe(true);
    // the reworded items are not missed
    expect(missed.some((i) => /quartz|backsplash|shaker/i.test(i))).toBe(false);
  });

  it("REQ-439 the master-bath draft without the bench and the mold misses those two, nothing it has a line for", () => {
    const draft = [
      "Quitar la tina vieja",
      'Regadera walk-in con vidrio frameless de 60"',
      "Porcelanato en piso y paredes, 145 sq ft",
      "Instalar vanity doble",
      "Extractor nuevo",
      "Mover el contacto GFCI",
      "Pintura y drywall",
    ];
    const missed = missedTypedItems(draft, typedWorkItems(BATH, "es"));
    expect(missed.some((i) => /banco/i.test(i))).toBe(true);
    expect(missed.some((i) => /moho/i.test(i))).toBe(true);
    // every item the draft has a line for is covered, however reworded
    expect(
      missed.some((i) =>
        /tina|vanity|extractor|gfci|pintura|porcelanato|frameless/i.test(i)
      ),
    )
      .toBe(false);
    expect(
      missedTypedItems([
        ...draft,
        "Banco en la regadera",
        "Allowance de remediación de moho",
      ], typedWorkItems(BATH, "es")),
    )
      .toEqual([]);
  });
});

/**
 * REQ-951 (LOOP-007 cycle 1, q1-27) — REQ-439/REQ-266: the first draft of
 * Q-002 folded "quitar el piso viejo" into "Cambio de piso de cocina (180
 * pies cuadrados, cerámica)" and the REQ-439 check never noticed. Its only
 * key term after the filler list is "piso", which the earlier "cambiar piso
 * de cocina" part already had, so typedScopeItems dropped the removal as a
 * reworded repeat — and the street address was kept as a "work item" instead.
 */
const Q127 =
  "cotizacion para Jose Martinez, jose.m@example.com, 1820 Elm St Austin TX 78702. " +
  "cambiar piso de cocina, 180 pies cuadrados de ceramica, quitar el piso viejo, $3,200 con materiales. " +
  "mitad al empezar y mitad al terminar";
const Q127_DRAFT = ["Cambio de piso de cocina (180 pies cuadrados, cerámica)"];

describe("REQ-951 (LOOP-007 q1-27) REQ-439 a removal is its own typed item", () => {
  const work = () => typedWorkItems(Q127, "es", customerFactsFrom(Q127));

  it("REQ-951 REQ-439 typedWorkItems keeps 'quitar el piso viejo' beside 'cambiar piso de cocina'", () => {
    expect(work().some((i) => /quitar el piso viejo/i.test(i))).toBe(true);
  });

  it("REQ-951 REQ-439 the typed street address is not a work item", () => {
    expect(work().some((i) => /1820 Elm St/i.test(i))).toBe(false);
  });

  it("REQ-951 REQ-439 a replacement-only draft misses the removal", () => {
    const missed = missedTypedItems(Q127_DRAFT, work());
    expect(missed.some((i) => /quitar el piso viejo/i.test(i))).toBe(true);
    expect(missed.some((i) => /1820 Elm/i.test(i))).toBe(false);
  });

  it("REQ-951 REQ-439 a line that also removes the old floor covers it", () => {
    expect(
      missedTypedItems([
        "Cambio de piso de cocina (180 pies cuadrados, cerámica) y retiro del piso viejo",
      ], work()),
    ).toEqual([]);
  });
});
