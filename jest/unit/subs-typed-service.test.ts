/**
 * REQ-1143 (LOOP-007 cycle 3, q3-75) — amends REQ-921/979. On /field/subscriptions "New repeat
 * visit", an owner with no services types "Gutter cleaning" into the service box, moves to the
 * price box (the dropdown closes, the typed text stays, nothing is picked), types 40 and presses
 * +. Before the fix `addItem` only looked up `form.pickId` and answered
 * "Pick a service on every line." — a typed name that matches no service was never created.
 *
 * Fix contract: `subsAddItemIntent({ catalog, pickId, typed, price })` in front-end/lib/field.ts
 * decides what + / Enter does:
 *   - a picked service (pickId in the catalogue) → { kind: "pick", id, name, priceCents }
 *   - nothing picked, a typed name matching a service case-insensitively → that service ("pick")
 *   - nothing picked, a typed name matching no service → { kind: "create", name, priceCents }
 *   - nothing picked or typed → { kind: "err", key: "serviceLines.err.pick" }
 *   - a price that is not > $0 → { kind: "err", key: "serviceLines.err.price" } (-20 is refused)
 * The island calls it from onAddItem and, on "create", runs fieldClient.createTaskType({ name }).
 * The empty-catalogue hint stays on the page (no link to /field/services that drops the form) and
 * field.subs.noItems says "service", not the internal "task type".
 */
import * as fs from "fs";
import * as path from "path";
import * as field from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldSubscriptionsPage.tsx");

type Svc = { id: string; name: string };
type Intent =
  | { kind: "pick"; id: string; name: string; priceCents: number }
  | { kind: "create"; name: string; priceCents: number }
  | { kind: "err"; key: string };
const subsAddItemIntent = (field as unknown as {
  subsAddItemIntent?: (
    a: { catalog: Svc[]; pickId: string; typed: string; price: string },
  ) => Intent;
}).subsAddItemIntent;

const intent = (
  a: { catalog: Svc[]; pickId: string; typed: string; price: string },
) => {
  expect(typeof subsAddItemIntent).toBe("function");
  return subsAddItemIntent!(a);
};

const gutter: Svc = { id: "tt-1", name: "Gutter cleaning" };

describe("REQ-1143 (q3-75) + on the repeat-visit form adds a typed service", () => {
  test("REQ-1143: empty catalogue, nothing picked, 'Gutter cleaning' typed at $40 → create it", () => {
    expect(
      intent({ catalog: [], pickId: "", typed: "Gutter cleaning", price: "40" }),
    ).toEqual({ kind: "create", name: "Gutter cleaning", priceCents: 4000 });
  });

  test("REQ-1143: a typed name matching a service (any case, extra spaces) picks that service, never a duplicate", () => {
    expect(
      intent({
        catalog: [gutter],
        pickId: "",
        typed: "  gutter CLEANING ",
        price: "40",
      }),
    ).toEqual({
      kind: "pick",
      id: "tt-1",
      name: "Gutter cleaning",
      priceCents: 4000,
    });
  });

  test("REQ-1143: a picked service still wins over the typed text", () => {
    expect(
      intent({
        catalog: [gutter],
        pickId: "tt-1",
        typed: "Gutter cleaning",
        price: "12.5",
      }),
    ).toEqual({
      kind: "pick",
      id: "tt-1",
      name: "Gutter cleaning",
      priceCents: 1250,
    });
  });

  test("REQ-1143: nothing picked or typed → 'Pick a service'; a typed name at -20 → the price error", () => {
    expect(intent({ catalog: [], pickId: "", typed: "  ", price: "40" }))
      .toEqual({ kind: "err", key: "serviceLines.err.pick" });
    expect(
      intent({ catalog: [], pickId: "", typed: "Gutter cleaning", price: "-20" }),
    ).toEqual({ kind: "err", key: "serviceLines.err.price" });
  });

  test("REQ-1143: the island routes + through subsAddItemIntent and creates a typed service via createTaskType", () => {
    expect(island).toMatch(/subsAddItemIntent\(/);
    // createTaskType is reached from the + path too, not only the dropdown's create row
    expect((island.match(/fieldClient\.createTaskType\(/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  test("REQ-1143: the empty-catalogue hint does not send the owner off the modal", () => {
    const start = island.indexOf('data-cy="subs-no-services"');
    expect(start).toBeGreaterThan(-1);
    const hint = island.slice(start, island.indexOf("</span>", start));
    // a same-tab link to /field/services unmounts the modal and drops the half-filled form
    expect(hint).not.toMatch(/<a\s+href="\/field\/services"\s*>/);
  });

  test("REQ-1143: field.subs.noItems says 'service', never the internal 'task type' (en + es)", () => {
    expect(en["field.subs.noItems"]).not.toMatch(/task type/i);
    expect(en["field.subs.noItems"]).toMatch(/service/i);
    expect(es["field.subs.noItems"]).not.toMatch(/tipo de tarea/i);
    expect(es["field.subs.noItems"]).toMatch(/servicio/i);
  });
});
