/**
 * REQ-281 (demo M34): a customer's "I paid by Zelle" claim shows on
 * /payments under "Needs attention" until the contractor confirms or rejects
 * it.
 *
 * Cause (demo-rca.md M34): /payments was built only from recorded Payment
 * rows. A claim is not a Payment — it lives on the invoice (status
 * "claimed" + paymentIntent) until confirm-payment records one — so the
 * page showed "NEEDS ATTENTION 0 · IN TRANSIT $0" and the empty hero while
 * a claim waited.
 *
 * Proposes front-end/lib/payment-claims.ts:
 *   pendingClaims(invoices, customerNames, now): PaymentClaim[]
 * and wires it into front-end/islands/PaymentsPage.tsx as the attention
 * track, with Confirm / Reject calling the existing endpoints.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Lazy so a missing module reds only the tests that use it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = () => require("../../front-end/lib/payment-claims");

const NOW = new Date("2026-11-11T15:00:00Z");

function inv(over: Record<string, unknown>) {
  return {
    id: "inv-aaaaaaaa-1",
    userId: "u1",
    customerId: "c1",
    amount: 50000,
    dueDate: "2026-11-20",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    status: "sent",
    ...over,
  };
}

describe("REQ-281 M34 pendingClaims: a claimed invoice is a payment that needs attention", () => {
  const names = new Map([["c1", "María Pagadora"], ["c2", "Bob Smith"]]);

  it("REQ-281 a Zelle claim becomes one attention item carrying the claim's amount, client, method, reference and invoice number", () => {
    const claims = lib().pendingClaims(
      [
        inv({
          id: "inv-1",
          number: "INV-007",
          status: "claimed",
          paymentIntent: {
            method: "zelle",
            amount: 42000,
            reference: "ZL-889",
            claimedAt: "2026-11-10T15:00:00Z",
            claimedBy: "Maria P.",
          },
        }),
      ],
      names,
      NOW,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      invoiceId: "inv-1",
      invoiceRef: "INV-007",
      client: "María Pagadora",
      initials: "MP",
      method: "zelle",
      amount: 42000,
      reference: "ZL-889",
      claimedBy: "Maria P.",
      claimedAt: "2026-11-10T15:00:00Z",
      daysAgo: 1,
    });
  });

  it("REQ-281 only claimed invoices count — sent, viewed, paid, void and draft ones do not", () => {
    const claims = lib().pendingClaims(
      ["sent", "viewed", "paid", "void", "draft", "scheduled"].map((
        status,
        i,
      ) => inv({ id: `inv-${i}`, status })),
      names,
      NOW,
    );
    expect(claims).toEqual([]);
  });

  it("REQ-281 a claimed invoice with no paymentIntent still shows, at the invoice amount with method 'other'", () => {
    const [c] = lib().pendingClaims(
      [inv({
        id: "inv-x",
        status: "claimed",
        amount: 12345,
        updatedAt: "2026-11-11T10:00:00Z",
      })],
      names,
      NOW,
    );
    expect(c).toMatchObject({
      invoiceId: "inv-x",
      amount: 12345,
      method: "other",
      daysAgo: 0,
    });
  });

  it("REQ-281 an unknown method on the claim maps to 'other' (the page's method tables are closed)", () => {
    const [c] = lib().pendingClaims(
      [inv({
        status: "claimed",
        paymentIntent: {
          method: "bitcoin",
          amount: 1,
          claimedAt: "2026-11-11T00:00:00Z",
        },
      })],
      names,
      NOW,
    );
    expect(c.method).toBe("other");
  });

  it("REQ-281 claims are newest first; an unknown customer reads '—'", () => {
    const claims = lib().pendingClaims(
      [
        inv({
          id: "old",
          status: "claimed",
          paymentIntent: {
            method: "check",
            amount: 1,
            claimedAt: "2026-11-01T00:00:00Z",
          },
        }),
        inv({
          id: "new",
          customerId: "nobody",
          status: "claimed",
          paymentIntent: {
            method: "venmo",
            amount: 2,
            claimedAt: "2026-11-11T00:00:00Z",
          },
        }),
      ],
      names,
      NOW,
    );
    expect(claims.map((c: { invoiceId: string }) => c.invoiceId)).toEqual([
      "new",
      "old",
    ]);
    expect(claims[0].client).toBe("—");
  });

  it("REQ-281 tolerates a non-array invoices payload (a failed fetch) as no claims", () => {
    expect(lib().pendingClaims(undefined, names, NOW)).toEqual([]);
  });
});

describe("REQ-281 M34 PaymentsPage wires claims into the attention track", () => {
  const src = read("front-end/islands/PaymentsPage.tsx");

  it("REQ-281 the attention count/total come from pendingClaims over the loaded invoices", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*pendingClaims[^}]*\}\s*from\s*"\.\.\/lib\/payment-claims\.ts"/,
    );
    expect(src).toMatch(/pendingClaims\(\s*s\.invoices/);
    // the old always-empty filter is gone
    expect(src).not.toMatch(
      /enriched\.filter\(\(p\)\s*=>\s*p\.status === "attention"\)/,
    );
  });

  it("REQ-281 each claim card confirms or rejects through the existing endpoints and then reloads the page data", () => {
    expect(src).toContain('data-cy="payment-claim"');
    expect(src).toContain('data-cy="payment-claim-confirm"');
    expect(src).toContain('data-cy="payment-claim-reject"');
    expect(src).toMatch(/\/api\/invoices\/\$\{[^}]+\}\/confirm-payment/);
    expect(src).toMatch(/\/api\/invoices\/\$\{[^}]+\}\/reject-claim/);
  });

  it("REQ-281 the docstring no longer calls attention 'reserved for future'", () => {
    expect(src).not.toMatch(/attention:\s*reserved for future/);
  });
});

describe("REQ-281 M34 claim copy exists in both languages", () => {
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));
  const keys = [
    "paymentsPage.claim.label",
    "paymentsPage.claim.note",
    "paymentsPage.claim.noteRef",
    "paymentsPage.claim.confirm",
    "paymentsPage.claim.reject",
    "paymentsPage.claim.failed",
    "paymentsPage.unit.claim",
  ];
  it.each(keys)("REQ-281 %s is in en and es", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k].length).toBeGreaterThan(0);
    expect(es[k].length).toBeGreaterThan(0);
  });
});
