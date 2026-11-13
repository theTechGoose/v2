/**
 * REQ-474 — demo-loop cycle 3, issue M17: "Same job invoiced twice with no
 * warning; the assistant says $360 owed, Clientes says $180".
 *
 * The New invoice modal ("Bill a client directly — no quote") built its body
 * from the form alone: it never looked at what the picked client already had.
 * Ana Pérez's signed Q-001 had INV-001 $180 scheduled; INV-002 $180 went out
 * beside it, and the REQ-233 agreement cap never ran (no quoteId).
 *
 * Now picking a client shows what is already billed or still to bill for them
 * — `priorBillingFor()` in shared/documents/invoice-form.ts — with "Send
 * INV-001 now" on a scheduled / draft one and "Link to Q-001" on a signed
 * quote, which sends the quoteId so the REQ-233 cap applies.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/InvoicesPage.tsx");

/** Ana Pérez's books in the demo (fleet-re05e1cbb-1 stdout:115). */
const QUOTES = [
  {
    id: "q-ana",
    number: "Q-001",
    customerId: "c-ana",
    status: "accepted",
    acceptedAt: "2026-11-12T09:00:00Z",
    estimatedTotal: 18000,
  },
  // someone else's signed quote
  {
    id: "q-bob",
    number: "Q-002",
    customerId: "c-bob",
    status: "accepted",
    estimatedTotal: 50000,
  },
  // Ana's unsigned quote — nothing to link to yet
  {
    id: "q-ana-2",
    number: "Q-003",
    customerId: "c-ana",
    status: "sent",
    estimatedTotal: 9000,
  },
];
const INV001 = {
  id: "inv-1",
  number: "INV-001",
  customerId: "c-ana",
  quoteId: "q-ana",
  status: "scheduled",
  amount: 18000,
  scheduledFor: "2026-11-20",
};

describe("REQ-474 (demo cycle 3, M17) priorBillingFor — what the picked client already has", () => {
  test("REQ-474: Ana's scheduled INV-001 $180 for Q-001 is found, and Q-001 is offered to link (nothing left to bill on it)", () => {
    const p = mod().priorBillingFor("c-ana", [INV001], QUOTES);
    expect(p.invoices).toEqual([
      {
        id: "inv-1",
        number: "INV-001",
        kind: "scheduled",
        amountCents: 18000,
        quoteId: "q-ana",
        quoteNumber: "Q-001",
      },
    ]);
    expect(p.quotes).toEqual([
      { id: "q-ana", number: "Q-001", remainingCents: 0 },
    ]);
  });

  test("REQ-474: draft and open (sent / viewed / claimed / pending) invoices count, by customerId or through one of the client's quotes; paid, void and other clients' do not", () => {
    const invoices = [
      {
        id: "d",
        number: "INV-002",
        customerId: "c-ana",
        status: "draft",
        amount: 5000,
      },
      {
        id: "o",
        number: "INV-003",
        customerId: "c-ana",
        status: "sent",
        amount: 7000,
        paidCents: 2000,
      },
      // no customerId, but on Ana's quote
      {
        id: "v",
        number: "INV-004",
        quoteId: "q-ana",
        status: "viewed",
        amount: 1000,
      },
      {
        id: "p",
        number: "INV-005",
        customerId: "c-ana",
        status: "paid",
        amount: 9000,
      },
      {
        id: "x",
        number: "INV-006",
        customerId: "c-ana",
        status: "void",
        amount: 9000,
      },
      {
        id: "b",
        number: "INV-007",
        customerId: "c-bob",
        status: "sent",
        amount: 9000,
      },
      {
        id: "pa",
        number: "INV-008",
        customerId: "c-ana",
        status: "sent",
        amount: 9000,
        paidAt: "2026-11-12",
      },
    ];
    const p = mod().priorBillingFor("c-ana", invoices, QUOTES);
    expect(
      p.invoices.map((
        i: { number: string; kind: string; amountCents: number },
      ) => `${i.number}:${i.kind}:${i.amountCents}`),
    ).toEqual(["INV-002:draft:5000", "INV-003:open:5000", "INV-004:open:1000"]);
    // Q-001's $180 less INV-004's $10 still to bill
    expect(p.quotes).toEqual([
      { id: "q-ana", number: "Q-001", remainingCents: 17000 },
    ]);
  });

  test("REQ-474: no client, a new client, or a client with nothing billed → nothing to warn about", () => {
    const empty = { invoices: [], quotes: [] };
    expect(mod().priorBillingFor("", [INV001], QUOTES)).toEqual(empty);
    expect(mod().priorBillingFor("__new__", [INV001], QUOTES)).toEqual(empty);
    expect(mod().priorBillingFor("c-zoe", [INV001], QUOTES)).toEqual(empty);
  });

  test("REQ-474: a lost / sample quote is never offered to link", () => {
    const p = mod().priorBillingFor("c-ana", [], [
      { ...QUOTES[0], status: "lost" },
      { ...QUOTES[0], id: "q-s", isSample: true },
    ]);
    expect(p.quotes).toEqual([]);
  });
});

describe("REQ-474 copy — en and es in sync", () => {
  const KEYS = [
    "invoicesPage.new.prior.scheduled",
    "invoicesPage.new.prior.scheduledQuote",
    "invoicesPage.new.prior.draft",
    "invoicesPage.new.prior.draftQuote",
    "invoicesPage.new.prior.open",
    "invoicesPage.new.prior.openQuote",
    "invoicesPage.new.prior.quote",
    "invoicesPage.new.prior.quoteBilled",
    "invoicesPage.new.prior.hint",
    "invoicesPage.new.prior.sendNow",
    "invoicesPage.new.prior.link",
    "invoicesPage.new.prior.sendFailed",
  ];
  const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  test.each(KEYS)(
    "REQ-474: %s exists in both and interpolates the same",
    (k) => {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(vars(es[k])).toBe(vars(en[k]));
    },
  );
  test("REQ-474: the demo's warning reads 'Ana Pérez already has INV-001 ($180.00) scheduled for Q-001'", () => {
    const fill = (tpl: string) =>
      tpl.replace(
        /\{(\w+)\}/g,
        (_, k) =>
          ({
            name: "Ana Pérez",
            number: "INV-001",
            amount: "$180.00",
            quote: "Q-001",
          })[k as "name"],
      );
    expect(fill(en["invoicesPage.new.prior.scheduledQuote"])).toBe(
      "Ana Pérez already has INV-001 ($180.00) scheduled for Q-001.",
    );
    expect(fill(es["invoicesPage.new.prior.scheduledQuote"])).toBe(
      "Ana Pérez ya tiene INV-001 ($180.00) programada para Q-001.",
    );
  });
});

describe("REQ-474 the island wires it", () => {
  test("REQ-474: the modal gets the page's invoices and reads priorBillingFor for the picked client", () => {
    expect(island).toMatch(/<NewInvoiceModal[\s\S]{0,300}invoices=\{/);
    expect(island).toContain("priorBillingFor(");
    expect(island).toContain('data-cy="new-invoice-prior"');
  });
  test("REQ-474: 'Link to Q-001' makes the invoice quote-linked — the body sends the linked quoteId, so the REQ-233 cap applies", () => {
    expect(island).toContain("quoteId: linkedQuoteId ?? undefined");
    expect(island).not.toContain("quoteId: quoteId ?? undefined");
    expect(island).toContain('data-cy="new-invoice-prior-link"');
    expect(island).toContain('data-cy="new-invoice-prior-send"');
  });
});
