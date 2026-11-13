/**
 * REQ-713 — demo-loop cycle 5, issue m27: "US and ISO dates in the Spanish
 * UI". The topbar search printed an invoice's due date as raw ISO
 * ("INV-002 … Programada 2026-11-29") because shared/documents/search.ts
 * baked `i.dueDate.slice(0, 10)` into the free-text `sub` line and
 * GlobalSearch.tsx printed `sub` unchanged. A hit now carries its dates as
 * typed fields (dueDate / serviceFrom / serviceTo / scheduledFor) and the
 * client spells them in the page language (searchHitLine → formatShortDate).
 * The /field subscription form's "Primera visita" native date input (drawn
 * in the browser locale) gains the REQ-587 spelled-out companion.
 */
import * as fs from "fs";
import * as path from "path";
import { searchHitLine, searchRecords } from "../../shared/documents/search";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ISO = /\d{4}-\d{2}-\d{2}/;

const customers = [{ id: "c1", number: "C-001", name: "Ann Lee" }];

function invoiceHit(inv: Record<string, unknown>) {
  const hits = searchRecords(
    {
      customers,
      quotes: [],
      invoices: [{
        id: "i1",
        number: "INV-002",
        customerId: "c1",
        amount: 10000,
        status: "scheduled",
        ...inv,
      }],
      changeOrders: [],
      workOrders: [],
    } as never,
    "INV-002",
  );
  const hit = hits.find((h) => h.type === "invoice");
  if (!hit) throw new Error("no invoice hit");
  return hit;
}

describe("REQ-713 (demo cycle 5, m27) search dates are typed and localized", () => {
  test("REQ-713 an invoice hit carries its due date as a typed field, not inside sub", () => {
    const hit = invoiceHit({ dueDate: "2026-11-29T00:00:00.000Z" });
    expect(hit.dueDate).toBe("2026-11-29");
    expect(hit.sub ?? "").not.toMatch(ISO);
  });

  test("REQ-713 the Spanish search line spells the due date ('29 nov'), never ISO", () => {
    const hit = invoiceHit({ dueDate: "2026-11-29" });
    const es = searchHitLine(hit, "es");
    expect(es).toContain("29 nov");
    expect(es).not.toMatch(ISO);
    expect(searchHitLine(hit, "en")).toContain("Nov 29");
  });

  test("REQ-713 service dates come back typed and render as a localized range", () => {
    const hit = invoiceHit({
      dueDate: "2026-12-06",
      serviceDateFrom: "2026-11-20",
      serviceDateTo: "2026-11-22",
    });
    expect(hit.serviceFrom).toBe("2026-11-20");
    expect(hit.serviceTo).toBe("2026-11-22");
    expect(hit.sub ?? "").not.toMatch(ISO);
    const es = searchHitLine(hit, "es");
    expect(es).toContain("20 nov → 22 nov");
    expect(es).not.toMatch(ISO);
  });

  test("REQ-713 an address still wins the second line over a date", () => {
    const hit = invoiceHit({
      dueDate: "2026-11-29",
      serviceAddress: "9 Oak Ave",
    });
    expect(searchHitLine(hit, "es")).toContain("9 Oak Ave");
    expect(searchHitLine(hit, "es")).not.toMatch(ISO);
  });

  test("REQ-713 a work order's scheduled day is typed and localized", () => {
    const hits = searchRecords(
      {
        customers,
        quotes: [],
        invoices: [],
        changeOrders: [],
        workOrders: [{
          id: "w1",
          number: "WO-001",
          customerId: "c1",
          description: "Fix gutter",
          scheduledFor: "2026-11-21",
        }],
      } as never,
      "WO-001",
    );
    const hit = hits.find((h) => h.type === "workOrder")!;
    expect(hit.scheduledFor).toBe("2026-11-21");
    expect(hit.sub ?? "").not.toMatch(ISO);
    const es = searchHitLine(hit, "es");
    expect(es).toContain("21 nov");
    expect(es).not.toMatch(ISO);
  });

  test("REQ-713 GlobalSearch renders the line through searchHitLine (no raw h.sub)", () => {
    const src = read("front-end/islands/GlobalSearch.tsx");
    expect(src).toMatch(/searchHitLine\(h, lang\)/);
  });

  test("REQ-713 the subscription 'Primera visita' date input has a spelled-out companion", () => {
    const src = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(src).toMatch(/data-cy="subs-start-text"/);
    expect(src).toMatch(/formatLongDate\(form\.startDate, lang\)/);
  });
});
