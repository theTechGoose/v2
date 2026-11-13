/**
 * REQ-323 — demo-loop cycle 1, issue m20: the customer card had no link to the customer's
 * quote / invoice and no customer number, and a brand-new lead with an open $9,500 quote and
 * no invoice read "BALANCE Settled". The DTO now carries `number` and `documents`; the card
 * back lists them; the zero-balance label says "Nothing billed yet" until something was billed.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import type { CustomerCard } from "../../front-end/clients/clients";
import { balanceDisplay } from "../../front-end/lib/clients-display";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

const base: CustomerCard = {
  id: "c1",
  userId: "u1",
  name: "Lead",
  number: "C-001",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  lastWhen: null,
  lastWhenRel: "today",
  lastTone: "hot",
  balanceCents: 0,
  balanceSub: "settled",
  activeJobs: 0,
  jobsSub: "",
  status: "lead",
  temp: 80,
  daysSinceContact: 0,
  revenue12moCents: 0,
  documents: [],
};

const quoteDoc = {
  kind: "quote" as const,
  id: "q1",
  number: "Q-001",
  state: "sent" as const,
  amountCents: 950_000,
  url: "/quotes?open=q1",
  updatedAt: "2026-04-02T00:00:00.000Z",
};
const invoice = (state: "paid" | "void" | "sent" | "draft") => ({
  kind: "invoice" as const,
  id: "i1",
  number: "INV-5000",
  state,
  amountCents: 400_000,
  url: "/i/i1",
  updatedAt: "2026-04-03T00:00:00.000Z",
});

describe("REQ-323 zero balance reads 'Nothing billed yet' until something was billed", () => {
  it("a lead with an open quote and no invoice: nothing billed, in both languages", () => {
    const c = { ...base, documents: [quoteDoc] };
    expect(balanceDisplay(c, "en").text).toBe("Nothing billed yet");
    expect(balanceDisplay(c, "es").text).toBe("Sin facturar");
    expect(balanceDisplay(c, "en").text).not.toBe("Settled");
  });
  it("a customer whose only invoice is void or a draft: still nothing billed", () => {
    expect(balanceDisplay({ ...base, documents: [invoice("void")] }, "en").text)
      .toBe("Nothing billed yet");
    expect(
      balanceDisplay({ ...base, documents: [invoice("draft")] }, "en").text,
    )
      .toBe("Nothing billed yet");
  });
  it("a customer with a paid invoice and no balance: Settled / Saldado", () => {
    const c = { ...base, documents: [quoteDoc, invoice("paid")] };
    expect(balanceDisplay(c, "en").text).toBe("Settled");
    expect(balanceDisplay(c, "es").text).toBe("Saldado");
  });
  it("owed and credit branches are unchanged", () => {
    expect(balanceDisplay({ ...base, balanceCents: 400_000 }, "en").text).toBe(
      "$4,000 due",
    );
    expect(balanceDisplay({ ...base, balanceCents: -5_000 }, "en").text).toBe(
      "$50 credit",
    );
  });
});

describe("REQ-323 the card back shows the C-number and the documents list", () => {
  const island = read("front-end/islands/ClientsBoard.tsx");
  it("renders the customer number on the panel", () => {
    expect(island).toMatch(/data-cy="ccard2-number"[\s\S]{0,200}\{c\.number\}/);
  });
  it("renders every document as a link to its url with number, state and amount", () => {
    expect(island).toContain('data-cy="ccard2-docs"');
    expect(island).toMatch(/c\.documents\.map\(/);
    const row = island.slice(island.indexOf("c.documents.map("));
    expect(row.slice(0, 400)).toContain('data-cy="ccard2-doc"');
    expect(row.slice(0, 400)).toContain("href={d.url}");
    expect(island).toMatch(/clientsBoard\.docState\.\$\{d\.state\}/);
    expect(island).toContain("clientsBoard.panel.docsNone");
  });
  it("the backend builds quote links to /quotes?open= and invoice links to /i/", () => {
    const mod = read(
      "backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts",
    );
    expect(mod).toContain("`/quotes?open=${");
    expect(mod).toContain("`/i/${");
    expect(read("front-end/clients/clients.ts")).toMatch(
      /documents: CustomerDocument\[\]/,
    );
  });
  it("both dictionaries carry the keys, including all ten document states", () => {
    const states = [
      "draft",
      "sent",
      "accepted",
      "declined",
      "revised",
      "claimed",
      "paid",
      "void",
      "approved",
      "pending",
    ];
    for (const d of [EN, ES]) {
      expect(d["clientsDisplay.balance.nothingBilled"]).toBeTruthy();
      expect(d["clientsBoard.panel.docs"]).toBeTruthy();
      expect(d["clientsBoard.panel.docsNone"]).toBeTruthy();
      expect(d["clientsBoard.panel.docOpen"]).toBeTruthy();
      expect(d["clientsBoard.doc.quote"]).toBeTruthy();
      expect(d["clientsBoard.doc.invoice"]).toBeTruthy();
      for (const s of states) {
        expect(d[`clientsBoard.docState.${s}`]).toBeTruthy();
      }
    }
    expect(EN["clientsDisplay.balance.nothingBilled"]).toBe(
      "Nothing billed yet",
    );
    expect(ES["clientsDisplay.balance.nothingBilled"]).toBe("Sin facturar");
    expect(EN["clientsDisplay.balance.settled"]).toBe("Settled");
  });
});
