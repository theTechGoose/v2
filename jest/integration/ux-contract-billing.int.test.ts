/**
 * RED (TDD) — UX-36 + UX-37 over the REAL API (dev stack :5280 → :4280).
 *
 *   UX-36 "Signing the contract after the job was invoiced and paid
 *         DOUBLE-BILLS the customer." — after quote-accept → full invoice →
 *         claim → confirm → sign, the sum of the deal's non-canceled
 *         invoices must not exceed the agreement total.
 *   UX-37 "Two independent signature ceremonies exist for one agreement." —
 *         after the /q acceptance the linked contract's public payload must
 *         not describe an independently-pending document.
 *
 * Every endpoint below was probed with curl against the live stack on
 * 2026-08-19 (throwaway pair +15125556600/+15125556601). Probe evidence:
 *
 *   POST /auth/verify {code:"000000"}                    → 200 {ok:true,…}
 *   POST /quotes → 200 (status "draft"); POST /contracts {quoteId,customerId,
 *     totalAmount:370000, terms:[{stepId:"payment_terms",value:"50 / 50"}]}
 *     → 200, NO status key (the auto-draft shape the assistant creates)
 *   POST /quotes/:id/accept (anonymous)                  → 200 {ok:true}
 *   GET  /contracts/by-quote/:quoteId/public             → 200 {contractId}
 *   GET  /contracts/:id/public AFTER accept → still NO "status" key, no
 *     signedAt, and no quote-acceptance evidence of any kind (UX-37 red)
 *   POST /invoices {contractId,quoteId,customerId,amount:370000,
 *     status:"sent"}                                     → 200
 *   POST /invoices/:id/claim-payment {method:"zelle"} (anon) → 200 {ok:true}
 *   POST /invoices/:id/confirm-payment (contractor) → 200 {ok:true,paymentId}
 *   POST /contracts/:id/sign (anon) → 200 {ok:true} — a DRAFT contract signs
 *     directly, no status transition needed (signContract only guards
 *     status==="signed"; public-controller/mod.ts:727-780)
 *   GET  /invoices ~2s after sign — the UX-36 smoking gun:
 *     a7fe8626 sent      185000 1/2 due 2026-08-26
 *     803e79c3 scheduled 185000 2/2 due 2026-09-09 (scheduledFor 2026-09-02)
 *     eb15e6c1 paid      370000 1/1
 *     → sum of non-void invoices = 740000 on a 370000 agreement.
 *
 * The milestone auto-creation lives in
 * backend/src/paperwork/domain/coordinators/send-signed-confirmation/mod.ts
 * :136-185 (fired fire-and-forget from POST /contracts/:id/sign at
 * public-controller/mod.ts:772) — see jest/unit/ux-milestone-reconcile.test.ts
 * for the pure reconcile contract, and jest/unit/ux-doc-model.test.ts for the
 * UX-37 derived-state contract (both fix shapes).
 *
 * Phones used (this file only): +15125556610 (contractor), +15125556611
 * (customer).
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedQuote,
} from "./helpers/api";

const CUSTOMER_NAME = "Reyna Solis";
const TOTAL = 370000; // $3,700 — the live-repro agreement value
const HALF = 185000;

/** Tiny valid PNG data URL — same shape PublicSignContract submits. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

describe("UX-36/UX-37 contract billing over the live money loop", () => {
  let s: ApiSession;
  let customerId: string;
  let quoteId: string;
  let contractId: string;
  let paidInvoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125556610");
    customerId = await seedCustomer(s, {
      name: CUSTOMER_NAME,
      email: "reyna.solis.jest@blackhole.postmarkapp.com",
      phoneNumber: "+15125556611",
    });
    quoteId = await seedQuote(s, {
      customerId,
      summary: "Paver patio installation 20x15",
      jobName: "Paver Patio",
      description: "Install a 20x15 paver patio",
      lineItems: [
        { description: "Paver patio", quantity: 1, unit: "job", price: TOTAL },
      ],
      estimatedTotal: TOTAL,
    });
    // The draft agreement bound to the quote — the same shape the assistant
    // auto-creates at send time (probed: created with NO status key). The
    // "50 / 50" terms are what the live repro's contract carried and what
    // computeMilestoneAmounts turns into the $1,850 pair.
    const c = await s.post("/contracts", {
      quoteId,
      customerId,
      totalAmount: TOTAL,
      terms: [
        { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
      ],
    });
    expect(c.status).toBeLessThan(400);
    contractId = c.body.id as string;

    // Customer accepts on /q (typed-name signature — the first ceremony).
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: CUSTOMER_NAME,
      signature: CUSTOMER_NAME,
    });
    expect(accept.status).toBeLessThan(400);
  });

  // -------------------------------------------------------------------------
  // UX-37 — after /q accept the linked /c is not independently "pending"
  // -------------------------------------------------------------------------

  it("UX-37 GET /contracts/:id/public after quote-accept is not an independently-pending document", async () => {
    // Locate the deal's contract the way a public consumer can (probed 200).
    const byQuote = await anonymous().get(
      `/contracts/by-quote/${quoteId}/public`,
    );
    expect(byQuote.status).toBe(200);
    expect(byQuote.body.contractId).toBe(contractId);

    const { status, body } = await anonymous().get(
      `/contracts/${contractId}/public`,
    );
    expect(status).toBe(200);

    // Either fix shape satisfies this (see ux-doc-model.test.ts):
    //   A) quote-accept marked the linked contract signed, or
    //   B) the payload carries the quote-acceptance evidence so /c can render
    //      "you already accepted this on <date>" instead of a fresh pad.
    // RED today (probed): the payload has NO status key, no signedAt and no
    // quote-acceptance fields at all.
    const evidence = {
      status: body.status,
      signedAt: body.signedAt,
      quoteStatus: body.quoteStatus,
      quoteAcceptedAt: body.quoteAcceptedAt,
    };
    const acceptedRendering = body.status === "signed" ||
      ((body.quoteStatus === "approved" || body.quoteStatus === "accepted") &&
        !!body.quoteAcceptedAt);
    expect({ acceptedRendering, ...evidence }).toEqual(
      expect.objectContaining({ acceptedRendering: true }),
    );
  });

  // -------------------------------------------------------------------------
  // UX-36 — pay in full, then sign the still-live /c
  // -------------------------------------------------------------------------

  let dealInvoices: Array<{
    id: string;
    amount?: number;
    status?: string;
    contractId?: string;
    quoteId?: string;
    installmentIndex?: number;
    installmentTotal?: number;
  }> = [];

  async function fetchDealInvoices() {
    const { status, body } = await s.get("/invoices");
    expect(status).toBe(200);
    dealInvoices = (body as typeof dealInvoices).filter(
      (i) => i.contractId === contractId || i.quoteId === quoteId,
    );
    return dealInvoices;
  }

  it("UX-36 the paid-then-signed deal never exceeds the agreement total in non-canceled invoices", async () => {
    // ---- invoice the full amount (what the contractor did in the repro) ----
    const inv = await s.post("/invoices", {
      contractId,
      quoteId,
      customerId,
      amount: TOTAL,
      dueDate: new Date(Date.now() + 6 * 24 * 3600 * 1000)
        .toISOString().slice(0, 10),
      status: "sent",
      installmentIndex: 1,
      installmentTotal: 1,
    });
    expect(inv.status).toBeLessThan(400);
    paidInvoiceId = inv.body.id as string;

    // ---- customer claims, contractor confirms (probed money loop) ----
    const claim = await anonymous().post(
      `/invoices/${paidInvoiceId}/claim-payment`,
      { method: "zelle", claimedBy: CUSTOMER_NAME },
    );
    expect(claim.status).toBeLessThan(400);
    expect(claim.body.ok).toBe(true);
    const confirm = await s.post(`/invoices/${paidInvoiceId}/confirm-payment`);
    expect(confirm.status).toBeLessThan(400);
    expect(confirm.body.ok).toBe(true);

    // ---- the second ceremony on the still-live /c link ----
    // Probed: a draft contract signs directly — no status transition needed.
    const sign = await anonymous().post(`/contracts/${contractId}/sign`, {
      name: CUSTOMER_NAME,
      signature: SIGNATURE_PNG,
    });
    expect(sign.status).toBeLessThan(400);
    expect(sign.body.ok).toBe(true);

    // ---- audit the deal's invoices ----
    // SendSignedConfirmation runs fire-and-forget after the sign response
    // (public-controller/mod.ts:772); probed latency ≈1-2s. Poll up to 8s for
    // any NEW invoice; when the fix lands, none appear and the loop simply
    // runs out the clock before the (then-green) assertion.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await fetchDealInvoices();
      if (dealInvoices.length > 1) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const billed = dealInvoices
      .filter((i) => i.status !== "void" && i.status !== "canceled")
      .reduce((sum, i) => sum + (i.amount ?? 0), 0);
    // RED today (probed): billed === 740000 — the fully-paid $3,700 invoice
    // PLUS the fresh $1,850 (sent) + $1,850 (scheduled) milestone pair.
    expect(billed).toBeLessThanOrEqual(TOTAL);
  });

  it("UX-36 no new $1,850 milestone pair exists after signing a fully-paid deal", async () => {
    await fetchDealInvoices();
    const phantomMilestones = dealInvoices.filter(
      (i) =>
        i.id !== paidInvoiceId &&
        (i.installmentTotal ?? 0) >= 2 &&
        i.status !== "void" &&
        i.status !== "canceled",
    );
    // RED today (probed): two of them — HALF (1/2, sent) + HALF (2/2,
    // scheduled). A correct reconcile creates nothing for a fully-paid deal.
    expect(
      phantomMilestones.map((i) => ({ amount: i.amount, status: i.status })),
    ).toEqual([]);
    // Belt-and-braces: the exact live-repro amount must not have been billed.
    expect(
      dealInvoices.filter((i) => i.amount === HALF && i.id !== paidInvoiceId),
    ).toEqual([]);
  });
});
