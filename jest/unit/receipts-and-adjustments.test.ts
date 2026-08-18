/**
 * RED (TDD) unit specs for two NEW shared/quote-flow modules that do not exist
 * yet — "Cannot find module" is the intended red until the green agent adds
 * them. Both encapsulate logic the FE + backend need for P-32 and P-41.
 *
 * P-32 [QUOTES] "The receipts strip counts self-notifications as customer
 *   sends." One send + accept logs THREE comms-trail messages against the
 *   quote's paperworkId: the customer email (keep), the contractor's OWN email
 *   (accepted-alert CC) and the contractor's OWN phone SMS (accepted-alert) —
 *   both self-notifications. And no "viewed by customer" receipt renders even
 *   though viewedAt exists server-side.
 *
 * P-41 [INVOICES] "Integrity gaps in adjustments." A discount applied while a
 *   customer's payment claim is still unconfirmed changes the total silently;
 *   an already-approved change order still offers Edit/Delete.
 *
 * ---------------------------------------------------------------------------
 * EXPECTED EXPORT CONTRACTS (for the green agent)
 *
 * shared/quote-flow/receipts.ts
 *   interface TrailMessage { channel?: string; toAddress?: string;
 *                            paperworkId?: string; [k: string]: unknown }
 *   interface ContractorContact { email?: string | null; phone?: string | null }
 *   interface CustomerReceipt { channel: "email" | "text"; to: string }
 *   // Project the per-document comms trail into CUSTOMER-facing send receipts.
 *   // Keeps only channel email/text with a toAddress; DROPS any message
 *   // addressed to the contractor's OWN email/phone (self-notifications);
 *   // dedups by `${channel}:${to}`. When `paperworkId` is given, filters the
 *   // trail to that document first (mirrors QuotesPage l.257).
 *   function classifyReceipts(messages: TrailMessage[],
 *                             contractor: ContractorContact,
 *                             paperworkId?: string): CustomerReceipt[]
 *
 *   interface ViewedSource { viewedAt?: string | null;
 *                            lastOpenAt?: string | null; opens?: number }
 *   interface ViewedReceipt { kind: "viewed"; at?: string }
 *   // A "viewed by the customer" receipt when the doc has been opened
 *   // (viewedAt / lastOpenAt present, or opens > 0); else null.
 *   function buildViewedReceipt(source: ViewedSource): ViewedReceipt | null
 *
 * shared/quote-flow/adjustment-guards.ts
 *   interface PaymentClaim { status?: string; confirmedAt?: string | null;
 *                            amount?: number; claimedAt?: string;
 *                            [k: string]: unknown }
 *   interface AdjustDecision { allowed: boolean; requiresWarning?: boolean;
 *                              reason?: string }
 *   // An invoice carrying an UNCONFIRMED payment claim can't be silently
 *   // adjusted: returns { allowed:false } (block) OR
 *   // { allowed:true, requiresWarning:true } (warn). No claim → { allowed:true }.
 *   function canAdjustInvoice(input: { claims?: PaymentClaim[];
 *                                      paymentIntent?: PaymentClaim | null }): AdjustDecision
 *   // A change order is mutable only while it is not yet approved.
 *   function isChangeOrderMutable(co: { status?: string }): boolean
 * ---------------------------------------------------------------------------
 */
import {
  buildViewedReceipt,
  classifyReceipts,
} from "../../shared/quote-flow/receipts";
import {
  canAdjustInvoice,
  isChangeOrderMutable,
} from "../../shared/quote-flow/adjustment-guards";

// Real comms-trail shapes, copied from `GET /api/messages` after ONE
// `POST /quotes/:id/email` + `POST /quotes/:id/accept` (see int probe): the
// customer email, then the accepted-alert to the contractor's OWN email and
// OWN phone.
const CONTRACTOR = { email: "roberto@blackhole.postmarkapp.com", phone: "+15125552811" };
const CUSTOMER_EMAIL = "maria.cliente@blackhole.postmarkapp.com";
const QUOTE_ID = "17e407d1-7ca5-4f47-bc2f-d575c9f26b44";

function trail() {
  return [
    {
      channel: "email",
      toAddress: CUSTOMER_EMAIL,
      paperworkId: QUOTE_ID,
      content: `quote ${QUOTE_ID} emailed to ${CUSTOMER_EMAIL}`,
    },
    {
      channel: "email",
      toAddress: CONTRACTOR.email, // accepted-alert CC to self
      paperworkId: QUOTE_ID,
      content: `quote ${QUOTE_ID} approved — completion email to ${CONTRACTOR.email}`,
    },
    {
      channel: "text",
      toAddress: CONTRACTOR.phone, // accepted-alert SMS to the contractor's OWN phone
      paperworkId: QUOTE_ID,
      content: `quote ${QUOTE_ID} approved — completion text`,
    },
  ];
}

describe("P-32 classifyReceipts — only customer-facing deliveries survive", () => {
  it("P-32 drops the contractor's OWN email + OWN phone self-alerts", () => {
    const receipts = classifyReceipts(trail(), CONTRACTOR, QUOTE_ID);
    const addresses = receipts.map((r) => r.to);
    expect(addresses).not.toContain(CONTRACTOR.email);
    expect(addresses).not.toContain(CONTRACTOR.phone);
  });

  it("P-32 keeps the single genuine customer send", () => {
    const receipts = classifyReceipts(trail(), CONTRACTOR, QUOTE_ID);
    expect(receipts).toEqual([{ channel: "email", to: CUSTOMER_EMAIL }]);
  });

  it("P-32 dedups repeat customer sends by channel:to", () => {
    const msgs = [...trail(), {
      channel: "email",
      toAddress: CUSTOMER_EMAIL,
      paperworkId: QUOTE_ID,
      content: "resend",
    }];
    const receipts = classifyReceipts(msgs, CONTRACTOR, QUOTE_ID);
    expect(receipts.filter((r) => r.to === CUSTOMER_EMAIL)).toHaveLength(1);
  });

  it("P-32 scopes to the requested document's paperworkId", () => {
    const other = {
      channel: "email",
      toAddress: "someone-else@blackhole.postmarkapp.com",
      paperworkId: "another-doc",
      content: "unrelated",
    };
    const receipts = classifyReceipts([...trail(), other], CONTRACTOR, QUOTE_ID);
    expect(receipts.map((r) => r.to)).not.toContain(
      "someone-else@blackhole.postmarkapp.com",
    );
  });
});

describe("P-32 buildViewedReceipt — a 'viewed by customer' receipt when opened", () => {
  it("P-32 returns a viewed receipt when viewedAt exists", () => {
    const r = buildViewedReceipt({ viewedAt: "2026-08-18T11:20:28.919Z" });
    expect(r).toBeTruthy();
    expect(r!.kind).toBe("viewed");
  });

  it("P-32 returns a viewed receipt when the customer has opens", () => {
    const r = buildViewedReceipt({ opens: 2, lastOpenAt: "2026-08-18T11:20:28.919Z" });
    expect(r).toBeTruthy();
    expect(r!.kind).toBe("viewed");
  });

  it("P-32 returns null when the customer has never opened it", () => {
    expect(buildViewedReceipt({ opens: 0 })).toBeNull();
    expect(buildViewedReceipt({})).toBeNull();
  });
});

describe("P-41 canAdjustInvoice — guard against silently adjusting a pending claim", () => {
  it("P-41 an unconfirmed payment claim is NOT a silent-adjust — blocked or warned", () => {
    const d = canAdjustInvoice({
      claims: [{
        status: "claimed",
        amount: 320000,
        claimedAt: "2026-08-18T11:20:47.251Z",
        // no confirmedAt → the contractor has not confirmed the money landed
      }],
    });
    // Desired contract: either it is disallowed, or it demands an explicit
    // warning acknowledgement — never a silent { allowed:true }.
    expect(d.allowed === false || d.requiresWarning === true).toBe(true);
  });

  it("P-41 no claim → adjusting is freely allowed with no warning", () => {
    const d = canAdjustInvoice({ claims: [] });
    expect(d.allowed).toBe(true);
    expect(d.requiresWarning).toBeFalsy();
  });

  it("P-41 a CONFIRMED claim does not force a warning (guard is about UNconfirmed)", () => {
    const d = canAdjustInvoice({
      claims: [{
        status: "confirmed",
        amount: 320000,
        confirmedAt: "2026-08-18T12:00:00.000Z",
      }],
    });
    expect(d.allowed).toBe(true);
    expect(d.requiresWarning).toBeFalsy();
  });
});

describe("P-41 isChangeOrderMutable — approved orders are immutable", () => {
  it("P-41 an approved change order is NOT mutable", () => {
    expect(isChangeOrderMutable({ status: "approved" })).toBe(false);
  });

  it("P-41 a pending change order is still mutable", () => {
    expect(isChangeOrderMutable({ status: "pending" })).toBe(true);
  });
});
