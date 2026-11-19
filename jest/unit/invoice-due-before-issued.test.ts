/**
 * REQ-962 (LOOP-007 cycle 1, q1-39) — an invoice is never due before it is
 * issued. INV-002 was issued Nov 19 with a typed due date of Nov 1; it went
 * to the customer as "— due November 1, 2026" and was overdue at birth.
 *
 * The one rule lives in shared/documents/invoice-form.ts: `dueBeforeIssued`
 * compares the yyyy-mm-dd strings, and `buildInvoiceBody` never sends a due
 * date before its issue date.
 * Lazy-required so a missing export reds each test for its own reason.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

describe("REQ-962 a due date before the issue date", () => {
  it("REQ-962 dueBeforeIssued refuses an earlier due date, allows the same day and later", () => {
    const { dueBeforeIssued } = mod();
    expect(typeof dueBeforeIssued).toBe("function");
    expect(dueBeforeIssued("2026-11-19", "2026-11-01")).toBe(true);
    expect(dueBeforeIssued("2026-11-19", "2026-11-18")).toBe(true);
    expect(dueBeforeIssued("2026-11-19", "2026-11-19")).toBe(false);
    expect(dueBeforeIssued("2026-11-19", "2026-12-19")).toBe(false);
    expect(dueBeforeIssued("2026-12-31", "2027-01-01")).toBe(false);
  });

  it("REQ-962 buildInvoiceBody never sends a due date before the issue date (issued 2026-11-19, typed due 2026-11-01)", () => {
    const { buildInvoiceBody } = mod();
    const body = buildInvoiceBody({
      customerId: "cus_1",
      jobName: "Gutter clean",
      description: "",
      lineItems: [],
      amountCents: 25000,
      discountCents: 0,
      discountReason: "",
      taxRateBp: 0,
      netDays: 30,
      issuedDate: "2026-11-19",
      dueDate: "2026-11-01",
      serviceAddress: "",
      paymentInstructions: "",
      billTo: {},
    }, { requestId: "req-962", status: "sent" });
    expect(body.issuedDate).toBe("2026-11-19");
    expect(typeof body.dueDate).toBe("string");
    expect(body.dueDate >= body.issuedDate).toBe(true);
  });
});
