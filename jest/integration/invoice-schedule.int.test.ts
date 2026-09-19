/**
 * REQ-022 — NW-31c (p28): "Upcoming — needs a 'send it later' button with a
 * date picker … Or a reminder text and email to the Dragon to approve that
 * the job is done and send the final invoice."
 *
 * Backend contract over the real API: a scheduled invoice whose send date is
 * due makes POST /cron/run-nudges emit a nudge (pin), that nudge reaches the
 * contractor as a notification (new), the same day never produces a second
 * one (new), and the send date can be changed with PUT (pin).
 */
import { type ApiSession, contractor, seedCustomer, seedInvoice } from "./helpers/api";

type Notif = { id: string; type: string; entityId?: string; title?: string; createdAt: string };

async function notificationsFor(s: ApiSession, invoiceId: string): Promise<Notif[]> {
  const { body } = await s.get("/notifications");
  const rows: Notif[] = Array.isArray(body) ? body : body?.items ?? [];
  return rows.filter((n) => n.entityId === invoiceId);
}

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("REQ-022 NW-31c scheduled invoices: the due-date nudge reaches the contractor; the date can move", () => {
  let s: ApiSession;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125550967");
    await s.put("/me", { name: "Schedule Contractor", language: "en" });
    const customerId = await seedCustomer(s, { name: "Later Customer", email: "later.customer@blackhole.postmarkapp.com", phoneNumber: "+15125550968" });
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: "Final Deck Invoice",
      amount: 80000,
      status: "scheduled",
      scheduledFor: iso(1),
      dueDate: iso(30),
    });
  });

  it("REQ-022 POST /cron/run-nudges picks up the invoice scheduled for tomorrow (contract pin)", async () => {
    const r = await s.post("/cron/run-nudges", {});
    expect(r.status).toBe(200);
    expect(r.body?.count).toBeGreaterThanOrEqual(1);
    const hit = (r.body?.results as Array<{ invoiceId: string }>).find((x) => x.invoiceId === invoiceId);
    expect(hit).toBeTruthy();
  });

  it("REQ-022 the nudge lands in the contractor's notifications as a due-to-send invoice", async () => {
    const rows = await notificationsFor(s, invoiceId);
    const nudge = rows.find((n) => n.type === "invoice_nudge_due");
    expect(nudge).toBeTruthy();
    expect(nudge!.title ?? "").toMatch(/send/i);
  });

  it("REQ-022 running the sweep again the same day does not duplicate the nudge", async () => {
    const r = await s.post("/cron/run-nudges", {});
    expect(r.status).toBe(200);
    const rows = await notificationsFor(s, invoiceId);
    expect(rows.filter((n) => n.type === "invoice_nudge_due")).toHaveLength(1);
  });

  it("REQ-022 PUT /invoices/:id { scheduledFor } moves the send date (contract pin)", async () => {
    const later = iso(10);
    const put = await s.put(`/invoices/${invoiceId}`, { scheduledFor: later });
    expect(put.status).toBeLessThan(400);
    const got = await s.get(`/invoices/${invoiceId}`);
    expect(got.body?.scheduledFor).toBe(later);
    expect(got.body?.status).toBe("scheduled");
  });
});
