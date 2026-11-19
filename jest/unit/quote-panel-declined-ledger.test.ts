/**
 * REQ-1053 (LOOP-007 cycle 2, issue q2-43) — a declined quote still offered
 * "Remaining to invoice $6,450.00" and a live "Create next invoice".
 *
 * ledgerSummary() (shared/documents/linked-view.ts) treats every status but
 * "draft" as issued, so a quote the customer declined (status "lost", set by
 * POST /api/quotes/:id/decline) keeps its "remaining" row and
 * canCreateNextInvoice=true — while the invoice form's CLOSED_QUOTE and
 * quote-lock already treat it as closed. Extends REQ-686 (drafts).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const base = {
  agreementTotalCents: 645000,
  invoicedCents: 0,
  billedCents: 0,
  paidCents: 0,
  invoicedUnpaidCents: 0,
  remainingToInvoiceCents: 645000,
  overpaidCents: 0,
  scheduledCents: 0,
};

describe("REQ-1053 q2-43 ledgerSummary: a declined / void quote has nothing to invoice", () => {
  for (const status of ["lost", "declined", "void", "canceled", "cancelled"]) {
    it(`REQ-1053 status '${status}' → no 'Remaining to invoice' row and no 'Create next invoice'`, () => {
      const s = lv().ledgerSummary({
        ...base,
        quote: { id: "q1", status, version: 1, accepted: false },
      });
      expect(s.rows.map((r: { key: string }) => r.key)).not.toContain(
        "remaining",
      );
      expect(s.canCreateNextInvoice).toBe(false);
    });
  }

  it("REQ-1053 a lostAt stamp alone also closes the quote", () => {
    const s = lv().ledgerSummary({
      ...base,
      quote: {
        id: "q1",
        status: "sent",
        version: 1,
        accepted: false,
        lostAt: "2026-11-18T12:00:00.000Z",
      },
    });
    expect(s.rows.map((r: { key: string }) => r.key)).not.toContain(
      "remaining",
    );
    expect(s.canCreateNextInvoice).toBe(false);
  });

  it("REQ-1053 the disabled reason says the quote was declined, not 'fully invoiced'", () => {
    const s = lv().ledgerSummary({
      ...base,
      quote: { id: "q1", status: "lost", version: 1, accepted: false },
    });
    expect(s.fullyInvoicedKey).toBe("quotes.ledger.declinedNoInvoice");
  });

  it("REQ-1053 a sent (open) quote keeps its remaining row and Create next invoice", () => {
    const s = lv().ledgerSummary({
      ...base,
      quote: { id: "q1", status: "sent", version: 1, accepted: false },
    });
    expect(s.rows).toContainEqual({ key: "remaining", cents: 645000 });
    expect(s.canCreateNextInvoice).toBe(true);
  });
});
