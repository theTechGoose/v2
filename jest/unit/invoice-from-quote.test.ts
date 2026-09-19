/**
 * PDF p6 (Invoice Edits) — build out the invoice to have ALL the information
 * of the quote EXCEPT the numbered Terms items, NO signature block, but a
 * link to the accepted agreement (the quote itself) once it is accepted.
 *
 * Post Quote+Contract merge: buildInvoiceFromQuote takes ONE arg — the quote
 * carries its own acceptance (isAccepted), no separate signed contract exists.
 *
 * Target: shared/quote-flow/invoice-from-quote.ts
 */
import { buildInvoiceFromQuote } from "../../shared/quote-flow/invoice-from-quote";

const quote = {
  id: "q1",
  jobName: "Backyard Junk Removal",
  summary: "Removing junk from a backyard",
  description: "Removing junk from a backyard and making sure no trash remains",
  customer: {
    name: "Green Goblin",
    email: "green@example.com",
    phone: "+15403331334",
  },
  lineItems: [
    {
      description: "Removing junk from a backyard",
      quantity: 1,
      unit: "job",
      price: 55000,
    },
  ],
  estimatedTotal: 55000,
  terms: [
    { n: 1, text: "Start: next week" },
    { n: 2, text: "Payment upon completion" },
    { n: 3, text: "Warranty: 6 months" },
  ],
};

describe("buildInvoiceFromQuote", () => {
  it("carries over the quote's identifying info, line items and total", () => {
    const inv = buildInvoiceFromQuote(quote);
    expect(inv.jobName).toBe("Backyard Junk Removal");
    expect(inv.customer).toEqual(quote.customer);
    expect(inv.lineItems).toEqual(quote.lineItems);
    expect(inv.totalCents).toBe(55000);
    expect(inv.description).toBe(quote.description);
  });

  it("does NOT carry the numbered Terms list", () => {
    const inv = buildInvoiceFromQuote(quote) as Record<string, unknown>;
    expect(inv.terms).toBeUndefined();
  });

  it("has NO signature block fields", () => {
    const inv = buildInvoiceFromQuote(quote) as Record<string, unknown>;
    expect(inv.signature).toBeUndefined();
    expect(inv.signatureBlock).toBeUndefined();
    expect(inv.contractorSignature).toBeUndefined();
    expect(inv.customerSignature).toBeUndefined();
  });

  it("links to the signed agreement (/q/<id>) once the quote is accepted", () => {
    const inv = buildInvoiceFromQuote({
      ...quote,
      status: "accepted",
      acceptedAt: "2026-05-23T00:00:00Z",
    });
    expect(inv.signedQuoteUrl).toBe("/q/q1");
  });

  it("links off the acceptance stamp alone (isAccepted), even if the status lags", () => {
    const inv = buildInvoiceFromQuote({
      ...quote,
      acceptedAt: "2026-05-23T00:00:00Z",
    });
    expect(inv.signedQuoteUrl).toBe("/q/q1");
  });

  it("omits the signed-quote link when nothing is signed yet", () => {
    const inv = buildInvoiceFromQuote(quote);
    expect(inv.signedQuoteUrl).toBeUndefined();
  });

  it("the dead legacy 'approved' status does NOT count as accepted", () => {
    const inv = buildInvoiceFromQuote({ ...quote, status: "approved" });
    expect(inv.signedQuoteUrl).toBeUndefined();
  });
});

describe("REQ-023 NW-14/15 buildInvoiceFromQuote output is a ready POST /invoices body", () => {
  // p11: "If I select an existing quote it should already know who the
  // customer is." The derived invoice must carry the quote's customerId so
  // the assistant never asks for the customer again.
  it("REQ-023 emits quoteId, customerId and lineItems", () => {
    const out = buildInvoiceFromQuote({
      id: "q-1",
      status: "accepted",
      acceptedAt: "2026-09-01T00:00:00Z",
      jobName: "Deck Staining",
      customerId: "c-9",
      lineItems: [{ description: "Deck", quantity: 1, unit: "job", price: 45000 }],
      estimatedTotal: 45000,
    } as Parameters<typeof buildInvoiceFromQuote>[0]);
    expect(out.quoteId).toBe("q-1");
    expect(out.customerId).toBe("c-9");
    expect(out.lineItems).toHaveLength(1);
    expect(out.jobName).toBe("Deck Staining");
  });
});
