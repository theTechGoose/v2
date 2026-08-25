/**
 * UX-36 + UX-37 over the REAL API (dev stack :5280 → :4280) — merged-world
 * edition. The Contract entity is gone: the quote IS the Quote + Agreement,
 * accepting it on /q is THE one signature ceremony, and the accept endpoint
 * itself runs the milestone auto-billing (SendSignedConfirmation.run).
 *
 *   UX-37 (resolved by construction) — there is no second document or
 *         second ceremony. The public quote payload carries the acceptance
 *         evidence, and a second accept is a 409, not a fresh pad.
 *   UX-36 — accepting a deal that was already invoiced (and paid) in full
 *         must never re-bill: the reconcile bills only the unbilled
 *         remainder, so the sum of the deal's non-canceled invoices never
 *         exceeds the agreement total.
 *
 * Happy path pinned too: accepting an un-invoiced 50/50 deal creates the
 * milestone pair (1/2 sent + 2/2 scheduled) exactly once.
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

/** Tiny valid PNG data URL — same shape PublicSignQuote submits. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

const FIFTY_FIFTY_TERMS = [
  { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
];

type DealInvoice = {
  id: string;
  amount?: number;
  status?: string;
  quoteId?: string;
  installmentIndex?: number;
  installmentTotal?: number;
};

async function fetchDealInvoices(
  s: ApiSession,
  quoteId: string,
): Promise<DealInvoice[]> {
  const { status, body } = await s.get("/invoices");
  expect(status).toBe(200);
  return (body as DealInvoice[]).filter((i) => i.quoteId === quoteId);
}

describe("UX-36/UX-37 accept billing over the live money loop", () => {
  let s: ApiSession;
  let customerId: string;

  beforeAll(async () => {
    s = await contractor("+15125556610");
    customerId = await seedCustomer(s, {
      name: CUSTOMER_NAME,
      email: "reyna.solis.jest@blackhole.postmarkapp.com",
      phoneNumber: "+15125556611",
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — accepting an un-invoiced 50/50 deal bills the milestone pair
  // -------------------------------------------------------------------------

  it("accepting an un-invoiced 50/50 deal creates the milestone pair exactly once", async () => {
    const quoteId = await seedQuote(s, {
      customerId,
      summary: "Paver patio installation 20x15",
      jobName: "Paver Patio",
      description: "Install a 20x15 paver patio",
      lineItems: [
        { description: "Paver patio", quantity: 1, unit: "job", price: TOTAL },
      ],
      estimatedTotal: TOTAL,
      terms: FIFTY_FIFTY_TERMS,
    });

    // The one ceremony: the customer accept-signs on /q. Billing is awaited
    // by the endpoint, so the invoices exist by the time 200 lands.
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: CUSTOMER_NAME,
      signature: SIGNATURE_PNG,
    });
    expect(accept.status).toBeLessThan(400);
    expect(accept.body.ok).toBe(true);

    const deal = await fetchDealInvoices(s, quoteId);
    const live = deal.filter(
      (i) => i.status !== "void" && i.status !== "canceled",
    );
    expect(
      live
        .map((i) => ({
          amount: i.amount,
          status: i.status,
          idx: i.installmentIndex,
          of: i.installmentTotal,
        }))
        .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0)),
    ).toEqual([
      { amount: HALF, status: "sent", idx: 1, of: 2 },
      { amount: HALF, status: "scheduled", idx: 2, of: 2 },
    ]);

    // UX-37 by construction: a second accept is a conflict, never a second
    // ceremony — and the billing does not run twice (acceptedNotifiedAt).
    const again = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: "Someone Else",
      signature: SIGNATURE_PNG,
    });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("already_accepted");

    const after = await fetchDealInvoices(s, quoteId);
    const billed = after
      .filter((i) => i.status !== "void" && i.status !== "canceled")
      .reduce((sum, i) => sum + (i.amount ?? 0), 0);
    expect(billed).toBe(TOTAL);
  });

  // -------------------------------------------------------------------------
  // UX-37 — the public payload carries the acceptance evidence
  // -------------------------------------------------------------------------

  it("UX-37 the public quote renders the persisted acceptance instead of a fresh pad", async () => {
    const quoteId = await seedQuote(s, {
      customerId,
      summary: "Fence repair",
      estimatedTotal: 50000,
      lineItems: [
        { description: "Fence repair", quantity: 1, unit: "job", price: 50000 },
      ],
      terms: FIFTY_FIFTY_TERMS,
    });
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: CUSTOMER_NAME,
      signature: SIGNATURE_PNG,
    });
    expect(accept.status).toBeLessThan(400);

    const { status, body } = await anonymous().get(`/quotes/${quoteId}/public`);
    expect(status).toBe(200);
    expect(body.status).toBe("accepted");
    expect(body.acceptedName).toBe(CUSTOMER_NAME);
    expect(typeof body.acceptedAt).toBe("string");
    // P-40: the captured signature mark renders back on the accepted page.
    expect(body.acceptedSignature).toBe(SIGNATURE_PNG);
    // The agreement half of the merged document is on the payload too.
    expect(Array.isArray(body.terms)).toBe(true);
    expect(body.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: "payment_terms", value: "50 / 50" }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // UX-36 — pay in full first, then accept: nothing new is billed
  // -------------------------------------------------------------------------

  it("UX-36 accepting a fully-paid deal bills nothing new", async () => {
    const quoteId = await seedQuote(s, {
      customerId,
      summary: "Deck restain",
      estimatedTotal: TOTAL,
      lineItems: [
        { description: "Deck restain", quantity: 1, unit: "job", price: TOTAL },
      ],
      terms: FIFTY_FIFTY_TERMS,
    });

    // ---- invoice the full amount first (what the contractor did in the
    // live repro), then run the probed money loop: claim → confirm.
    const inv = await s.post("/invoices", {
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
    const paidInvoiceId = inv.body.id as string;

    const claim = await anonymous().post(
      `/invoices/${paidInvoiceId}/claim-payment`,
      { method: "zelle", claimedBy: CUSTOMER_NAME },
    );
    expect(claim.status).toBeLessThan(400);
    expect(claim.body.ok).toBe(true);
    const confirm = await s.post(`/invoices/${paidInvoiceId}/confirm-payment`);
    expect(confirm.status).toBeLessThan(400);
    expect(confirm.body.ok).toBe(true);

    // ---- the (only) ceremony, AFTER the deal was fully paid ----
    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      name: CUSTOMER_NAME,
      signature: SIGNATURE_PNG,
    });
    expect(accept.status).toBeLessThan(400);
    expect(accept.body.ok).toBe(true);

    // ---- audit the deal's invoices ----
    const deal = await fetchDealInvoices(s, quoteId);
    const billed = deal
      .filter((i) => i.status !== "void" && i.status !== "canceled")
      .reduce((sum, i) => sum + (i.amount ?? 0), 0);
    expect(billed).toBeLessThanOrEqual(TOTAL);

    const phantomMilestones = deal.filter(
      (i) =>
        i.id !== paidInvoiceId &&
        (i.installmentTotal ?? 0) >= 2 &&
        i.status !== "void" &&
        i.status !== "canceled",
    );
    // A correct reconcile creates nothing for a fully-paid deal.
    expect(
      phantomMilestones.map((i) => ({ amount: i.amount, status: i.status })),
    ).toEqual([]);
    expect(
      deal.filter((i) => i.amount === HALF && i.id !== paidInvoiceId),
    ).toEqual([]);
  });
});
