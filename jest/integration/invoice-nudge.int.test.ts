/**
 * REQ-021 — NW-31a (p28): "Awaiting confirmation — has an 'Ok I got it'
 * button, but also needs a nudge button, because 'Ok I got it' marks it as
 * paid." The reminder cadence (POST /cron/invoice-reminder, day 3/7/14/30)
 * is the nudge's backend. Contract pin over the real API — the backend
 * accepts a CLAIMED invoice (green on arrival); the FE never called it,
 * which the Cypress cases cover.
 */
import { anonymous, type ApiSession, contractor, seedCustomer, seedInvoice } from "./helpers/api";

describe("REQ-021 NW-31a POST /cron/invoice-reminder nudges an awaiting-confirmation invoice", () => {
  let s: ApiSession;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125550965");
    await s.put("/me", { name: "Nudge Contractor", language: "en" });
    const customerId = await seedCustomer(s, {
      name: "Slow Payer",
      email: "slow.payer@blackhole.postmarkapp.com",
      phoneNumber: "+15125550966",
    });
    invoiceId = await seedInvoice(s, {
      customerId,
      amount: 30000,
      status: "sent",
      issuedDate: new Date().toISOString().slice(0, 10),
    });
    // The customer says "I sent it" → Awaiting confirmation.
    const claim = await anonymous().post(`/invoices/${invoiceId}/claim-payment`, {
      method: "zelle",
      claimedBy: "Slow Payer",
    });
    expect(claim.status).toBeLessThan(400);
  });

  it("REQ-021 day-3 nudge on a claimed invoice → 200, dispatched on a channel, recorded in reminderHistory", async () => {
    const r = await s.post("/cron/invoice-reminder", { invoiceId, day: 3 });
    expect(r.status).toBe(200);
    expect(r.body?.invoiceId).toBe(invoiceId);
    expect(r.body?.day).toBe(3);
    expect(Array.isArray(r.body?.channels) && r.body.channels.length).toBeTruthy();

    const inv = await s.get(`/invoices/${invoiceId}`);
    const history = (inv.body?.reminderHistory ?? []) as Array<{ day: number; channels: string[] }>;
    expect(history.some((h) => h.day === 3 && h.channels.length > 0)).toBe(true);
  });

  it("REQ-021 the same day never fires twice (cadence stays idempotent)", async () => {
    const again = await s.post("/cron/invoice-reminder", { invoiceId, day: 3 });
    expect(again.status).toBe(200);
    expect(again.body?.channels).toEqual([]);
  });

  it("REQ-021 the endpoint only knows the cadence days", async () => {
    const bad = await s.post("/cron/invoice-reminder", { invoiceId, day: 5 });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
