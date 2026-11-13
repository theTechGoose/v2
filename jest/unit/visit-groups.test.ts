/**
 * REQ-173 — "on invoices can we make the address a heading and then detail the date and the
 * service?" — a batch invoice's line items carry date / service / address, and every surface
 * groups them under the address.
 */
import {
  fmtVisitDate,
  groupVisits,
} from "../../shared/quote-flow/visit-groups";

const line = (
  date: string,
  service: string,
  address: string,
  price: number,
) => ({
  description: `${date} — ${service} — ${address}`,
  quantity: 1,
  unit: "visit",
  price,
  date,
  service,
  address,
});

describe("REQ-173 groupVisits", () => {
  test("groups structured lines under their address, first address first, visits by date then service", () => {
    const groups = groupVisits([
      line("2026-10-09", "Lawn", "725 Frederick Rd", 6500),
      line("2026-10-02", "overhead cost", "725 Frederick Rd", 650),
      line("2026-10-02", "Lawn", "725 Frederick Rd", 6500),
      line("2026-10-07", "Pool Cleaning", "9 Pine Ave", 8000),
    ]);
    expect(groups).toEqual([
      {
        address: "725 Frederick Rd",
        subtotal: 13650,
        visits: [
          { date: "2026-10-02", service: "Lawn", price: 6500 },
          { date: "2026-10-02", service: "overhead cost", price: 650 },
          { date: "2026-10-09", service: "Lawn", price: 6500 },
        ],
      },
      {
        address: "9 Pine Ave",
        subtotal: 8000,
        visits: [{ date: "2026-10-07", service: "Pool Cleaning", price: 8000 }],
      },
    ]);
  });
  test("is null for an ordinary invoice — any line without date, service and address", () => {
    expect(groupVisits(undefined)).toBeNull();
    expect(groupVisits([])).toBeNull();
    expect(
      groupVisits([{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 100000,
      }]),
    ).toBeNull();
    expect(
      groupVisits([line("2026-10-02", "Lawn", "725 Frederick Rd", 6500), {
        description: "x",
        price: 1,
      }]),
    ).toBeNull();
  });
  test("fmtVisitDate reads 'Oct 2' in English and '2 oct' in Spanish", () => {
    expect(fmtVisitDate("2026-10-02", "en")).toBe("Oct 2");
    expect(fmtVisitDate("2026-10-02", "es")).toBe("2 oct");
  });
});

/**
 * REQ-791 — "can we group recurring tasks on an invoice by address, then by date with an amount
 * on the end so it looks better?" A2Z's batch draft showed flat "Oct 2 — Lawn — 845 Frederick Rd…"
 * lines: editing the draft on /invoices re-saved the lines without date / service / address.
 */
import { keepVisitFields } from "../../shared/quote-flow/visit-groups";

describe("REQ-791 groupVisits reads a batch line back from its text", () => {
  const addr = "845 Frederick Rd, Rockingham, VA 22801-1314";
  const flat = (d: string, price = 6500) => ({ description: `${d} — Lawn — ${addr}`, quantity: 1, unit: "visit", price });
  test("lines that lost date/service/address are grouped by address, then by date, priced", () => {
    const groups = groupVisits(
      [flat("Oct 9"), flat("Oct 2"), flat("Oct 30")],
      { from: "2026-10-01", to: "2026-10-31" },
    );
    expect(groups).toEqual([{
      address: addr,
      subtotal: 19500,
      visits: [
        { date: "2026-10-02", service: "Lawn", price: 6500 },
        { date: "2026-10-09", service: "Lawn", price: 6500 },
        { date: "2026-10-30", service: "Lawn", price: 6500 },
      ],
    }]);
  });
  test("Spanish dates, a job of several days (its first day), and a range across new year", () => {
    const g = groupVisits(
      [
        { description: `28 dic — Poda — ${addr}`, price: 100 },
        { description: `Jan 3 – Jan 5 — Fence — 9 Pine Ave`, price: 200 },
      ],
      { from: "2026-12-20", to: "2027-01-10" },
    );
    expect(g).toEqual([
      { address: addr, subtotal: 100, visits: [{ date: "2026-12-28", service: "Poda", price: 100 }] },
      { address: "9 Pine Ave", subtotal: 200, visits: [{ date: "2027-01-03", service: "Fence", price: 200 }] },
    ]);
  });
  test("an ordinary line that does not read as a visit keeps the invoice ordinary", () => {
    expect(groupVisits([flat("Oct 2"), { description: "Mulch — 3 yards", price: 100 }], { from: "2026-10-01" })).toBeNull();
    expect(groupVisits([{ description: "Deck — repair — rear", price: 1 }], { from: "2026-10-01" })).toBeNull();
  });
});

describe("REQ-791 keepVisitFields — editing a draft keeps each visit's date/service/address", () => {
  const before = [
    { description: "Oct 2 — Lawn — 1 Elm St", price: 6500, date: "2026-10-02", service: "Lawn", address: "1 Elm St" },
    { description: "Oct 9 — Lawn — 1 Elm St", price: 6500, date: "2026-10-09", service: "Lawn", address: "1 Elm St" },
  ];
  test("an unchanged description keeps its fields even when the price changes", () => {
    const out = keepVisitFields(before, [
      { description: "Oct 2 — Lawn — 1 Elm St", quantity: 1, price: 7000 },
      { description: "Oct 9 — Lawn — 1 Elm St", quantity: 1, price: 6500 },
    ]);
    expect(out[0]).toEqual({ description: "Oct 2 — Lawn — 1 Elm St", quantity: 1, price: 7000, date: "2026-10-02", service: "Lawn", address: "1 Elm St" });
    expect(out[1].address).toBe("1 Elm St");
  });
  test("a rewritten or new line carries none (it is no longer that visit)", () => {
    const out = keepVisitFields(before, [
      { description: "Oct 2 — Lawn + edging — 1 Elm St", price: 7000 },
      { description: "Oct 9 — Lawn — 1 Elm St", price: 6500 },
      { description: "Extra trip", price: 500 },
    ]);
    expect(out[0].date).toBeUndefined();
    expect(out[1].date).toBe("2026-10-09");
    expect(out[2]).toEqual({ description: "Extra trip", price: 500 });
  });
});
