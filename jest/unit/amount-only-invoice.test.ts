/**
 * REQ-486 (demo-loop cycle 3, issue m32) — a New invoice with "What's it for"
 * and an Amount but no line rows is a supported bill (the typed total), so it
 * must not warn "No line items", and the POST body turns that label + amount
 * into one itemized row so the invoice and the /i page show what it was for.
 *   shared/documents/invoice-form.ts — missingInfo, buildInvoiceBody
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const EMPTY_BILL_TO = {
  name: "",
  businessName: "",
  email: "",
  phoneNumber: "",
  address: "",
};

function form(extra: Record<string, unknown> = {}) {
  return {
    lineItems: [],
    amountCents: 32000,
    discountCents: 0,
    discountReason: "",
    taxRateBp: 0,
    netDays: 0,
    issuedDate: "2026-11-12",
    jobName: "Gutter cleaning",
    description: "",
    serviceAddress: "",
    paymentInstructions: "",
    billTo: EMPTY_BILL_TO,
    ...extra,
  };
}

describe("REQ-486 m32 amount-only invoice", () => {
  it("REQ-486 m32 missingInfo does not warn noLineItems when an amount is entered", () => {
    const { missingInfo } = mod();
    const out = missingInfo({
      billTo: { name: "Ann", email: "ann@x.com", address: "1 Main" },
      serviceAddress: "1 Main",
      lineItems: [],
      amountCents: 32000,
    });
    expect(out).not.toContain("noLineItems");
    expect(out).toEqual([]);
  });

  it("REQ-486 m32 missingInfo still warns noLineItems and noAmount on an empty bill", () => {
    const { missingInfo } = mod();
    const out = missingInfo({
      billTo: { name: "Ann", email: "ann@x.com", address: "1 Main" },
      serviceAddress: "1 Main",
      lineItems: [],
      amountCents: 0,
    });
    expect(out).toEqual(["noLineItems", "noAmount"]);
  });

  it("REQ-486 m32 buildInvoiceBody turns What's it for + amount into one line item", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody(
      form({ discountCents: 2000, taxRateBp: 825 }),
      {
        requestId: "r-1",
        status: "sent",
      },
    );
    expect(body.lineItems).toEqual([
      { description: "Gutter cleaning", quantity: 1, price: 32000 },
    ]);
    expect(body.subtotalCents).toBe(32000);
    // 32000 − 2000 = 30000 · tax 2475
    expect(body.amount).toBe(32475);
    expect(body.jobName).toBe("Gutter cleaning");
  });

  it("REQ-486 m32 the synthesized line falls back to the description when What's it for is blank", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody(
      form({ jobName: "  ", description: " Spring cleanup " }),
      { requestId: "r-2", status: "draft" },
    );
    expect(body.lineItems).toEqual([
      { description: "Spring cleanup", quantity: 1, price: 32000 },
    ]);
  });

  it("REQ-486 m32 no line is invented without a label, without an amount, or on a quote-drawn invoice", () => {
    const { buildInvoiceBody } = mod();
    const opts = { requestId: "r-3", status: "draft" as const };
    expect(buildInvoiceBody(form({ jobName: "" }), opts)).not.toHaveProperty(
      "lineItems",
    );
    expect(buildInvoiceBody(form({ amountCents: 0 }), opts)).not.toHaveProperty(
      "lineItems",
    );
    // a progress bill on a quote keeps the quote's own lines (backend derives them)
    expect(buildInvoiceBody(form({ quoteId: "q1" }), opts)).not.toHaveProperty(
      "lineItems",
    );
  });

  it("REQ-486 m32 typed line rows still win over the amount", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody(
      form({ lineItems: [{ description: "Labor", quantity: 2, price: 5000 }] }),
      { requestId: "r-4", status: "draft" },
    );
    expect(body.lineItems).toEqual([
      { description: "Labor", quantity: 2, price: 5000 },
    ]);
    expect(body.amount).toBe(10000);
  });
});
