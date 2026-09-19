/**
 * REQ-018 — NW-27 / NW-32 (p18, p29): the contractor says "payment received".
 *
 * Backend contract pin: POST /payments with an explicit {invoiceId, amount,
 * method, receivedAt} flips the invoice to paid when the balance hits zero
 * (ComputeInvoiceBalance) and lands a row on /payments — no customer claim
 * needed. This passes on arrival (the backend is built); the FE never posted
 * a payment, which is what the Cypress case covers.
 */
import { type ApiSession, contractor, seedInvoice } from "./helpers/api";

const today = new Date().toISOString().slice(0, 10);

describe("REQ-018 NW-27 POST /payments records a contractor-side receipt", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550961");
  });

  it("REQ-018 a full payment flips the invoice to paid (paidAt set) and lists on /payments with its method", async () => {
    const invoiceId = await seedInvoice(s, { amount: 50000, status: "sent", issuedDate: today });
    const now = new Date().toISOString();
    const pay = await s.post("/payments", { invoiceId, amount: 50000, method: "zelle", receivedAt: now });
    expect(pay.status).toBeLessThan(400);

    const inv = await s.get(`/invoices/${invoiceId}`);
    expect(inv.body?.status).toBe("paid");
    expect(typeof inv.body?.paidAt).toBe("string");

    const rows = await s.get(`/payments?invoiceId=${invoiceId}`);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].method).toBe("zelle");
    expect(rows.body[0].amount).toBe(50000);
  });

  it("REQ-018 a partial payment records the row but leaves the invoice unpaid", async () => {
    const invoiceId = await seedInvoice(s, { amount: 50000, status: "sent", issuedDate: today });
    const pay = await s.post("/payments", {
      invoiceId,
      amount: 20000,
      method: "cash",
      receivedAt: new Date().toISOString(),
    });
    expect(pay.status).toBeLessThan(400);

    const inv = await s.get(`/invoices/${invoiceId}`);
    expect(inv.body?.status).not.toBe("paid");
    const rows = await s.get(`/payments?invoiceId=${invoiceId}`);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].amount).toBe(20000);
  });
});
