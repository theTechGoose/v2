/**
 * PDF p6 (Invoice Edits) over the REAL API — the invoice document must:
 *   - carry all the quote's information (job name, description, line items, total)
 *   - carry the wizard-captured term grid (start / time to complete / payment /
 *     warranty) — product decision 2026-08-25: the invoice mirrors the
 *     agreement's Términos grid and payment schedule
 *   - NOT include the numbered legal clauses
 *   - NOT include any signature block
 *   - link to the signed quote (the agreement) once it is accepted
 *   - be editable (PUT /invoices/:id)
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedQuote,
} from "./helpers/api";

describe("invoice parity with the quote", () => {
  let s: ApiSession;
  let quoteId: string;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125550913");
    quoteId = await seedQuote(s, { jobName: "Backyard Junk Removal" });
    const inv = await s.post("/invoices", { quoteId });
    if (inv.status >= 400 || !inv.body?.id) {
      throw new Error(
        `invoice from quote failed: ${inv.status} ${JSON.stringify(inv.body)}`,
      );
    }
    invoiceId = inv.body.id;
  });

  it("public invoice carries the quote's info", async () => {
    const { status, body } = await anonymous().get(
      `/invoices/${invoiceId}/public`,
    );
    expect(status).toBe(200);
    expect(body.jobName).toBe("Backyard Junk Removal");
    expect(body.lineItems?.length).toBeGreaterThan(0);
    expect(body.amount).toBe(55000); // `amount` = the app's integer-cents field
    expect(body.description ?? body.jobDetails).toBeTruthy();
  });

  it("public invoice carries the wizard term grid but NO legal clauses and NO signature block", async () => {
    const { body } = await anonymous().get(`/invoices/${invoiceId}/public`);
    // The wizard-captured terms (start / wraps / payment_terms / warranty)
    // feed the invoice's Términos grid + payment-schedule milestones.
    expect(Array.isArray(body.terms)).toBe(true);
    // The 14 numbered legal clauses live only on the signed agreement.
    expect(body.clauses).toBeUndefined();
    expect(body.legalClauses).toBeUndefined();
    expect(body.signature).toBeUndefined();
    expect(body.signatureBlock).toBeUndefined();
    expect(body.contractorSignature).toBeUndefined();
    expect(body.customerSignature).toBeUndefined();
  });

  it("links to the signed quote once it is accepted", async () => {
    // The one ceremony: the customer accept-signs the quote on /q.
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    expect(accept.status).toBeLessThan(400);

    const { body } = await anonymous().get(`/invoices/${invoiceId}/public`);
    expect(body.signedQuoteUrl).toBe(`/q/${quoteId}`);
  });

  it("is editable via PUT /invoices/:id", async () => {
    const put = await s.put(`/invoices/${invoiceId}`, {
      lineItems: [
        { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
        {
          description: "Extra debris haul",
          quantity: 1,
          unit: "job",
          price: 5000,
        },
      ],
      amount: 60000,
    });
    expect(put.status).toBeLessThan(400);
    const { body } = await s.get(`/invoices/${invoiceId}`);
    expect(body.lineItems).toHaveLength(2);
    expect(body.amount).toBe(60000);
  });
});

// REQ-023 — NW-14 / NW-15: the backend already derives an invoice from a
// quote when the body carries quoteId; the assistant never sent it. Pin the
// derivation the seeded review relies on (green on arrival).
describe("REQ-023 NW-14/15 POST /invoices with only quoteId derives the bill from the quote", () => {
  it("REQ-023 amount, customer, jobName and lineItems come from the quote", async () => {
    const s = await contractor("+15125550969");
    const quoteId = await seedQuote(s, { jobName: "Deck Staining" });
    const quote = await s.get(`/quotes/${quoteId}`);
    const inv = await s.post("/invoices", { quoteId });
    expect(inv.status).toBeLessThan(400);
    expect(inv.body?.quoteId).toBe(quoteId);
    expect(inv.body?.customerId).toBe(quote.body?.customerId);
    expect(inv.body?.jobName).toBe("Deck Staining");
    expect(inv.body?.amount).toBe(55000);
    expect(inv.body?.lineItems?.length).toBeGreaterThan(0);
  });
});
