/**
 * REQ-1064 (LOOP-007 cycle 2, q2-53) — "Public invoice shows a one-day
 * service date as a range". A one-day job stores serviceDateFrom ==
 * serviceDateTo. The invoice email and PDF collapse that to one date
 * (`from && to && from !== to ? range : from || to`), but the plain
 * `[from, to].filter(Boolean).map(fmt).join(" → ")` joins in /i/[id].tsx
 * and in shared/documents/search.ts (searchHitDates, the global search
 * sub-line) print the same day twice: "Nov 19 → Nov 19".
 */
import { searchHitLine, searchRecords } from "../../shared/documents/search";

const customers = [{ id: "c1", number: "C-001", name: "Ann Lee" }];

function invoiceHit(inv: Record<string, unknown>) {
  const hits = searchRecords(
    {
      customers,
      quotes: [],
      invoices: [{
        id: "i1",
        number: "INV-001",
        customerId: "c1",
        amount: 10000,
        status: "sent",
        ...inv,
      }],
      changeOrders: [],
      workOrders: [],
    } as never,
    "INV-001",
  );
  const hit = hits.find((h) => h.type === "invoice");
  if (!hit) throw new Error("no invoice hit");
  return hit;
}

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("REQ-1064 (LOOP-007 q2-53) a one-day service date reads as one date", () => {
  test("REQ-1064 search: serviceDateFrom == serviceDateTo shows the day once (en)", () => {
    const line = searchHitLine(
      invoiceHit({ serviceDateFrom: "2026-11-19", serviceDateTo: "2026-11-19" }),
      "en",
    );
    expect(count(line, "Nov 19")).toBe(1);
    expect(line).not.toContain("→");
  });

  test("REQ-1064 search: serviceDateFrom == serviceDateTo shows the day once (es)", () => {
    const line = searchHitLine(
      invoiceHit({ serviceDateFrom: "2026-11-19", serviceDateTo: "2026-11-19" }),
      "es",
    );
    expect(count(line, "19 nov")).toBe(1);
    expect(line).not.toContain("→");
  });

  test("REQ-1064 search: a full-ISO same-day pair is still one day", () => {
    const line = searchHitLine(
      invoiceHit({
        serviceDateFrom: "2026-11-19T00:00:00.000Z",
        serviceDateTo: "2026-11-19",
      }),
      "en",
    );
    expect(count(line, "Nov 19")).toBe(1);
  });

  test("REQ-1064 search: two different days still read as a range with both days", () => {
    const line = searchHitLine(
      invoiceHit({ serviceDateFrom: "2026-11-19", serviceDateTo: "2026-11-21" }),
      "en",
    );
    expect(line).toContain("Nov 19");
    expect(line).toContain("Nov 21");
  });

  test("REQ-1064 search: only one end set shows just that day", () => {
    const from = searchHitLine(invoiceHit({ serviceDateFrom: "2026-11-19" }), "en");
    expect(count(from, "Nov 19")).toBe(1);
    const to = searchHitLine(invoiceHit({ serviceDateTo: "2026-11-21" }), "en");
    expect(count(to, "Nov 21")).toBe(1);
  });
});
