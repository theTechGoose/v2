/**
 * RED (TDD) integration specs over the REAL API (frontend proxy :5280 → :4280).
 * They pin DESIRED behavior; today's server answers the buggy way, so they fail.
 *
 * P-41 [INVOICES] "Integrity gaps in adjustments."
 *   - A discount applied AFTER the customer claimed payment silently changed
 *     the invoice $3,200 → $3,100 (no warning). Desired: adjusting an invoice
 *     with a pending (unconfirmed) payment claim is BLOCKED (4xx) or returns an
 *     explicit machine-readable warning field.
 *   - A customer-APPROVED change order still accepts PUT/DELETE. Desired: an
 *     approved change order is immutable — PUT and DELETE both 409.
 *
 * P-32 [QUOTES] "The receipts strip counts self-notifications as customer
 *   sends." Backend half: one `POST /quotes/:id/email` + one accept logs the
 *   customer send AND the accepted-alert to the contractor's OWN email + OWN
 *   phone against the quote's paperworkId. Desired: the document's customer-
 *   facing receipts must not include the contractor's own phone/email.
 *
 * PROBE NOTES (current server behavior, captured live for the green agent):
 *   - POST /invoices/:id/claim-payment {method,claimedBy} → 200 {ok,invoiceId};
 *     invoice.status→"claimed", paymentIntent {method,amount,claimedAt,claimedBy}.
 *   - POST /invoices/:id/discount while claimed → 200 (SILENT); amount reduced,
 *     NO warning field, paymentIntent.amount left stale. (this is the bug)
 *   - POST /change-orders/:id/approve {name} → 200 {ok:true}; CO status→approved.
 *   - PUT  /invoices/:id/change-orders/:coId on an APPROVED CO → 200 (resets it
 *     to "pending"). DELETE → 200 {ok:true}. (both should be 409)
 *   - GET /messages (no query) → every message across the user's conversations;
 *     each carries { channel, toAddress, paperworkId, content, ... }. The accept
 *     self-alerts arrive fire-and-forget (~<2s after accept) tagged with the
 *     quote's paperworkId + toAddress = contractor email / phone. The customer-
 *     receipt filtering can also live purely FE (shared/quote-flow/receipts.ts);
 *     this test pins the backend invariant that the self-alerts must not be
 *     surfaced as the document's customer receipts.
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedInvoice,
  seedQuote,
} from "./helpers/api";

/** Truthy on any of the plausible machine-readable "we warned you" fields. */
function warningField(body: unknown): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  return !!(
    b.warning ?? b.warnings ?? b.requiresConfirmation ?? b.requiresWarning ??
    b.claimPending ?? b.blocked ?? b.needsConfirmation
  );
}

describe("P-41 discount while a payment claim is pending", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125552820");
  });

  it("P-41 a discount does not silently change a claimed invoice — blocked or warned", async () => {
    const invoiceId = await seedInvoice(s, { amount: 320000 });

    // Customer claims the full $3,200 (unconfirmed — the contractor has not
    // pressed "I got it" yet).
    const claim = await anonymous().post(`/invoices/${invoiceId}/claim-payment`, {
      method: "zelle",
      claimedBy: "Green Goblin",
    });
    expect(claim.status).toBeLessThan(400);

    // The contractor now tries to knock $100 off.
    const r = await s.post(`/invoices/${invoiceId}/discount`, {
      discountCents: 10000,
      reason: "Repeat client",
    });

    const blocked = r.status >= 400;
    const warned = r.status < 400 && warningField(r.body);
    // Desired: NEVER a silent 200 that just applies the discount.
    expect(blocked || warned).toBe(true);

    // If the server chose to BLOCK, the total must be untouched.
    if (blocked) {
      const { body } = await s.get(`/invoices/${invoiceId}`);
      expect(body.amount).toBe(320000);
    }
  });
});

describe("P-41 an approved change order is immutable", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125552821");
  });

  async function approvedChangeOrder(): Promise<{ invoiceId: string; coId: string }> {
    const invoiceId = await seedInvoice(s, { amount: 320000 });
    const created = await s.post(`/invoices/${invoiceId}/change-orders`, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    });
    expect(created.status).toBeLessThan(400);
    const coId = created.body.id as string;
    const approve = await anonymous().post(`/change-orders/${coId}/approve`, {
      name: "Green Goblin",
    });
    expect(approve.status).toBeLessThan(400);
    // Confirm it really is approved before we try to mutate it.
    const list = await s.get(`/invoices/${invoiceId}/change-orders`);
    const co = (list.body as Array<{ id: string; status: string }>).find((c) => c.id === coId);
    expect(co?.status).toBe("approved");
    return { invoiceId, coId };
  }

  it("P-41 PUT on an approved change order is rejected with 409 and leaves it approved", async () => {
    const { invoiceId, coId } = await approvedChangeOrder();
    const r = await s.put(`/invoices/${invoiceId}/change-orders/${coId}`, {
      description: "Edited after approval",
      deltaAmountCents: 25000,
    });
    expect(r.status).toBe(409);
    const list = await s.get(`/invoices/${invoiceId}/change-orders`);
    const co = (list.body as Array<{ id: string; status: string }>).find((c) => c.id === coId);
    expect(co?.status).toBe("approved");
  });

  it("P-41 DELETE on an approved change order is rejected with 409", async () => {
    const { invoiceId, coId } = await approvedChangeOrder();
    const r = await s.del(`/invoices/${invoiceId}/change-orders/${coId}`);
    expect(r.status).toBe(409);
  });
});

describe("P-32 the quote's customer receipts exclude the contractor's self-alerts", () => {
  let s: ApiSession;
  let me: { email?: string; phoneNumber?: string };
  let quoteId: string;
  const CUSTOMER_EMAIL = "maria.int@blackhole.postmarkapp.com";

  async function messages(): Promise<
    Array<{ channel?: string; toAddress?: string; paperworkId?: string; content?: string }>
  > {
    const { body } = await s.get("/messages");
    return Array.isArray(body) ? body : [];
  }

  // Wait until the fire-and-forget accepted-alert has flushed to the trail —
  // keyed on the self address (STABLE across the fix: the contractor still gets
  // notified, only its receipt-tagging should change).
  async function waitForSelfAlert(selfAddrs: string[], timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let msgs = await messages();
    while (Date.now() < deadline) {
      const settled = msgs.some((m) =>
        selfAddrs.includes(m.toAddress ?? "") && /approv/i.test(String(m.content ?? ""))
      );
      if (settled) break;
      await new Promise((r) => setTimeout(r, 500));
      msgs = await messages();
    }
    return msgs;
  }

  beforeAll(async () => {
    s = await contractor("+15125552822");
    me = (await s.get("/me")).body;
    const customerId = await seedCustomer(s, {
      phoneNumber: "+15125552890",
      email: CUSTOMER_EMAIL,
      name: "Maria Cliente",
    });
    quoteId = await seedQuote(s, { customerId });
    // ONE customer-facing email send.
    await s.post(`/quotes/${quoteId}/email`);
    // Customer approves → fires the accepted-alert to the contractor (self).
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: "Maria Cliente",
    });
    expect(accept.status).toBeLessThan(400);
  }, 30000);

  it("P-32 the document's customer receipts do not include the contractor's own phone/email", async () => {
    const selfAddrs = [me.email, me.phoneNumber].filter(Boolean) as string[];
    const msgs = await waitForSelfAlert(selfAddrs);

    // The customer-facing receipts for THIS quote (mirrors QuotesPage's filter).
    const receipts = msgs.filter((m) =>
      m.paperworkId === quoteId &&
      (m.channel === "email" || m.channel === "text") &&
      !!m.toAddress
    );

    // The genuine send to the customer survives.
    expect(receipts.some((r) => r.toAddress === CUSTOMER_EMAIL)).toBe(true);

    // …but the accepted-alert to the contractor's OWN phone/email must NOT be
    // presented as a customer delivery. (RED today: both self-alerts carry the
    // quote's paperworkId + toAddress = contractor email/phone.)
    const selfReceipts = receipts.filter((r) => selfAddrs.includes(r.toAddress ?? ""));
    expect(selfReceipts).toEqual([]);
  }, 30000);
});
