/**
 * PDF p6 (Invoice Edits) — build out the invoice to have ALL the information
 * of the quote EXCEPT the numbered Terms items, NO signature block, but a
 * link to the signed quote if one exists.
 *
 * Target: shared/quote-flow/invoice-from-quote.ts
 */
import { buildInvoiceFromQuote } from "../../shared/quote-flow/invoice-from-quote";

const quote = {
  id: "q1",
  jobName: "Backyard Junk Removal",
  summary: "Removing junk from a backyard",
  description: "Removing junk from a backyard and making sure no trash remains",
  customer: { name: "Green Goblin", email: "green@example.com", phone: "+15403331334" },
  lineItems: [
    { description: "Removing junk from a backyard", quantity: 1, unit: "job", price: 55000 },
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

  it("links to the signed quote when a signed contract exists", () => {
    const inv = buildInvoiceFromQuote(quote, {
      contractId: "c1",
      signedAt: "2026-05-23T00:00:00Z",
    });
    expect(inv.signedQuoteUrl).toContain("c1");
  });

  it("omits the signed-quote link when nothing is signed yet", () => {
    const inv = buildInvoiceFromQuote(quote);
    expect(inv.signedQuoteUrl).toBeUndefined();
  });
});
