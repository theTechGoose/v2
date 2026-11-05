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
