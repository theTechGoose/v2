/**
 * Pipeline stats truth over the REAL API — RED (TDD) tests for problems.md:
 *
 *   P-14 "The user's first quote is misreported as WON. Minutes after sending
 *        (nobody signed) … it already counts as '1 trabajo activo' …
 *        Desired: a sent-but-unsigned quote counts as AWAITING … NOT
 *        decided/won, and NOT an active job; the two pages agree."
 *   P-15 "The onboarding sample quote pollutes real pipeline stats. …
 *        Desired: sample quotes are excluded from ALL pipeline/money
 *        aggregates and open-tracking …"
 *
 * Endpoints exercised (probed live 2026-08-18):
 *   POST /agents/conversations/sample-quote → { quoteId, created } — the
 *        idempotent onboarding sample ($3,700, summary
 *        "onboarding-sample-v1 · Paver Patio Installation", status "sent",
 *        no customer, no sentAt).
 *   GET  /analytics/dashboard → { customers, quotes: { total, draft, sent,
 *        accepted }, quotedValueCents, awaitingResponse, invoices, revenue,
 *        payments } (all money INTEGER cents).
 *   GET  /analytics/quotes/win-rate?days=90 → { windowDays, decided, won,
 *        lost, winRate } — nothing may count a quote as decided
 *        as won, signed or not.
 *   GET  /invoices/forecast/this-week → { thisWeekCents, thisWeek, … }.
 *   GET  /jobs → Job[] — today a merely SENT quote with a customer is a job
 *        ("Awaiting signature").
 *   GET  /quotes → QuoteCard[] with derived `stage` — today an unsigned
 *        drafted terms flip stage to "won".
 *
 * Fresh phone per describe (reserved block +15125552700-99); each run wipes
 * the user first (GET /me/wipe) so counts stay deterministic across reruns.
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedQuote,
} from "./helpers/api";

/** Login → wipe → login again: a guaranteed-fresh user for stats. */
async function freshContractor(phone: string): Promise<ApiSession> {
  const pre = await contractor(phone);
  await pre.get("/me/wipe");
  return await contractor(phone);
}

describe("P-15 the onboarding sample stays out of every pipeline aggregate", () => {
  let s: ApiSession;
  let sampleId: string;

  beforeAll(async () => {
    s = await freshContractor("+15125552710");
    const r = await s.post("/agents/conversations/sample-quote");
    expect(r.status).toBeLessThan(400);
    sampleId = r.body?.quoteId;
    expect(sampleId).toBeTruthy();
  });

  it("P-15 dashboard money aggregates are $0 with only the sample present", async () => {
    const { status, body } = await s.get("/analytics/dashboard");
    expect(status).toBe(200);
    // Today: quotedValueCents === 370000 — the sample's $3,700 presented as
    // real money "in manos de los clientes". Desired: 0.
    expect(body.quotedValueCents).toBe(0);
    // Supplementary pins (already true today; must STAY true after the fix):
    const wr = await s.get("/analytics/quotes/win-rate?days=90");
    expect(wr.body.decided).toBe(0);
    expect(wr.body.won).toBe(0);
    const fc = await s.get("/invoices/forecast/this-week");
    expect(fc.body.thisWeekCents).toBe(0);
  });

  it("P-15 the sample never counts as a quote awaiting response", async () => {
    const { body } = await s.get("/analytics/dashboard");
    // Today: quotes.sent === 1 and awaitingResponse === 1 — the sample is
    // reported as a real quote waiting on a customer. Desired: 0 / 0.
    expect(body.awaitingResponse).toBe(0);
    expect(body.quotes.sent).toBe(0);
  });

  it("P-15 GET /quotes never returns the sample as an unmarked real quote", async () => {
    const { status, body } = await s.get("/quotes");
    expect(status).toBe(200);
    const cards = Array.isArray(body) ? body : [];
    // Desired: the sample is either excluded server-side OR explicitly
    // flagged isSample so the UI can localize/badge it and keep it out of
    // stats. Today the card comes back flag-less with the internal slug in
    // `summary` ("onboarding-sample-v1 · …").
    const sampleCards = cards.filter((c: { id?: string }) => c.id === sampleId);
    for (const c of sampleCards) {
      expect(c.isSample).toBe(true);
    }
    // And no REAL-looking card may leak the internal slug unmarked.
    const leakedUnmarked = cards.filter(
      (c: { summary?: string; isSample?: boolean }) =>
        String(c.summary ?? "").includes("onboarding-sample") &&
        c.isSample !== true,
    );
    expect(leakedUnmarked).toEqual([]);
  });
});

describe("P-14 a sent-but-unsigned quote is awaiting — not won, not an active job", () => {
  let s: ApiSession;
  let quoteId: string;

  beforeAll(async () => {
    s = await freshContractor("+15125552711");
    const customerId = await seedCustomer(s, {
      name: "Green Goblin",
      email: "green.p14@blackhole.postmarkapp.com",
      phoneNumber: "+15125552760",
    });
    quoteId = await seedQuote(s, {
      customerId,
      summary: "Fence repair",
      jobName: "Fence Repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 85_000,
      }],
      estimatedTotal: 85_000, // the audit's $850 quote
    });
    const send = await s.post(`/quotes/${quoteId}/email`);
    expect(send.status).toBeLessThan(400);
    // Sent, with wizard terms drafted onto the quote, but NOBODY signed —
    // the assistant first-quote state.
    const patch = await s.put(`/quotes/${quoteId}`, {
      terms: [
        { stepId: "payment_terms", label: "Payment terms", value: "Due Now" },
      ],
    });
    expect(patch.status).toBeLessThan(400);
  });

  it("P-14 win-rate reports 0 decided / 0 won minutes after sending (nobody signed)", async () => {
    const { status, body } = await s.get("/analytics/quotes/win-rate?days=90");
    expect(status).toBe(200);
    // Nothing is decided until the customer accepts (signs).
    expect(body.decided).toBe(0);
    expect(body.won).toBe(0);
    expect(body.lost).toBe(0);
  });

  it("P-14 the /quotes card stays awaiting ('sent'), agreeing with the dashboard", async () => {
    const { body } = await s.get("/quotes");
    const card = (Array.isArray(body) ? body : []).find(
      (c: { id?: string }) => c.id === quoteId,
    );
    expect(card).toBeTruthy();
    // The freshly sent, unsigned quote stays in the awaiting track.
    expect(card.stage).toBe("sent");
    // …and the dashboard agrees it is awaiting with its $850:
    const dash = await s.get("/analytics/dashboard");
    expect(dash.body.awaitingResponse).toBe(1);
    expect(dash.body.quotedValueCents).toBe(85_000);
    expect(dash.body.quotes.accepted).toBe(0);
  });

  it("P-14 GET /jobs lists no active job for a sent-but-unsigned quote", async () => {
    const { status, body } = await s.get("/jobs");
    expect(status).toBe(200);
    // Today: one job ("Awaiting signature") — the dashboard's
    // "1 trabajo activo" while its own empty-state copy promises jobs appear
    // "en cuanto un cliente firme". Desired: no job until a signature.
    expect(body).toEqual([]);
  });

  it("P-14 the quote becomes won only when the customer signs", async () => {
    // Before the signature: still nothing decided (red today: won === 1).
    const before = await s.get("/analytics/quotes/win-rate?days=90");
    expect(before.body.won).toBe(0);
    expect(before.body.decided).toBe(0);

    const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
      signature: "Green Goblin",
      name: "Green Goblin",
    });
    expect(accept.status).toBeLessThan(400);

    // After the signature: exactly one decided, one won — and it is now a job.
    const after = await s.get("/analytics/quotes/win-rate?days=90");
    expect(after.body.decided).toBe(1);
    expect(after.body.won).toBe(1);
    const jobs = await s.get("/jobs");
    expect(Array.isArray(jobs.body)).toBe(true);
    expect(jobs.body.length).toBe(1);
  });
});
