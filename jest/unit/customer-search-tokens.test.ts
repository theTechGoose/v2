/**
 * REQ-519 (demo-loop cycle 3, M33) — client search ignores accents AND skipped words,
 * in both search paths.
 *
 * The demo (pair 6): on /customers, "maria pena" found nothing for "María José Peña"
 * ("Ningún cliente coincide con este filtro"), and the header search "maria" found
 * nothing at all ('Nada coincide con "maria"').
 * Root cause (RCA M33):
 *   - shared/quote-flow/customer-search.ts customerMatchesQuery tested the whole folded
 *     query as ONE substring, so the middle name between the typed words broke it;
 *   - shared/documents/search.ts (the header search) never folded accents: hasText was
 *     hay.toLowerCase().includes(q), and fold() stripped "é" instead of folding it to "e".
 */
import { customerMatchesQuery } from "../../shared/quote-flow/customer-search";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const search = () => require("../../shared/documents/search");

const maria = {
  id: "c1",
  number: "C-001",
  name: "María José Peña",
  businessName: "Peña Jardinería",
  email: "mjp@example.com",
  phoneNumber: "+1 (843) 555-0101",
  address: "12 Calle Ñandú",
  createdAt: "2026-11-06T10:00:00.000Z",
};
const bob = {
  id: "c2",
  number: "C-002",
  name: "Bob Smith",
  createdAt: "2026-11-06T10:00:00.000Z",
};
const empty = {
  customers: [maria, bob],
  quotes: [],
  invoices: [],
  changeOrders: [],
  workOrders: [],
};

describe("REQ-519 (demo cycle 3, M33) customer list search — every word must appear, in any order, words may be skipped", () => {
  it("REQ-519 'maria pena' (middle name skipped) finds 'María José Peña'", () => {
    for (
      const q of [
        "maria pena",
        "María Peña",
        "pena maria",
        "  maria   pena ",
        "maria jardineria",
        "pena nandu",
      ]
    ) {
      expect([q, customerMatchesQuery(maria, q)]).toEqual([q, true]);
    }
  });

  it("REQ-519 every word must match — a word that appears nowhere still filters the customer out", () => {
    for (const q of ["maria smith", "bob pena", "maria pena zzz"]) {
      expect([q, customerMatchesQuery(maria, q)]).toEqual([q, false]);
    }
    expect(customerMatchesQuery(bob, "maria pena")).toBe(false);
  });
});

describe("REQ-519 (demo cycle 3, M33) header search (searchRecords) — accent-blind and word-by-word", () => {
  const labels = (q: string) =>
    search().searchRecords(empty, q).filter((h: { type: string }) =>
      h.type === "customer"
    ).map((h: { label: string }) => h.label);

  it("REQ-519 'maria' finds 'María José Peña'", () => {
    expect(labels("maria")).toEqual(["María José Peña"]);
  });

  it("REQ-519 'pena', 'PEÑA', 'jardineria', 'nandu' and 'maria pena' find her too; 'bob' does not", () => {
    for (
      const q of [
        "pena",
        "PEÑA",
        "jardineria",
        "calle nandu",
        "maria pena",
        "María",
      ]
    ) {
      expect([q, labels(q)]).toEqual([q, ["María José Peña"]]);
    }
    expect(labels("bob")).toEqual(["Bob Smith"]);
    expect(labels("maria smith")).toEqual([]);
  });

  it("REQ-519 an accented quote summary is found unaccented", () => {
    const data = {
      ...empty,
      quotes: [{
        id: "q1",
        number: "Q-001",
        seq: 1,
        customerId: "c2",
        summary: "Remodelación de baño",
        status: "sent",
        createdAt: "2026-11-02T10:00:00.000Z",
      }],
    };
    const hits = search().searchRecords(data, "remodelacion bano").filter((
      h: { type: string },
    ) => h.type === "quote");
    expect(hits.map((h: { id: string }) => h.id)).toEqual(["q1"]);
  });
});
