/**
 * REQ-019 — NW-33 (p29): "Export this month" on /payments must download a
 * CSV of THIS month's payments. GET /invoices/export.csv only knew ?year=;
 * ?month= must narrow it to invoices paid in that month.
 */
import { type ApiSession, contractor, seedCustomer, seedInvoice } from "./helpers/api";

const BASE = process.env.API_BASE_URL ?? "http://localhost:5280/api";

async function csv(s: ApiSession, query: string): Promise<{ status: number; text: string; type: string }> {
  const res = await fetch(`${BASE}/invoices/export.csv?${query}`, {
    headers: { cookie: s.cookieHeaderValue() },
  });
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
}

describe("REQ-019 NW-33 GET /invoices/export.csv?year=&month= filters by the month paid", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550962");
    for (const [name, receivedAt] of [
      ["January Payer", "2026-01-15T12:00:00.000Z"],
      ["March Payer", "2026-03-15T12:00:00.000Z"],
    ]) {
      const customerId = await seedCustomer(s, { name, phoneNumber: undefined, email: undefined });
      const invoiceId = await seedInvoice(s, { customerId, amount: 12300, status: "sent", issuedDate: "2026-01-02" });
      const pay = await s.post("/payments", { invoiceId, amount: 12300, method: "cash", receivedAt });
      expect(pay.status).toBeLessThan(400);
    }
  });

  it("REQ-019 year only → both paid invoices", async () => {
    const r = await csv(s, "year=2026");
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/text\/csv/);
    expect(r.text).toContain("January Payer");
    expect(r.text).toContain("March Payer");
  });

  it("REQ-019 year + month → only the invoice paid in that month", async () => {
    const jan = await csv(s, "year=2026&month=1");
    expect(jan.status).toBe(200);
    expect(jan.text).toContain("January Payer");
    expect(jan.text).not.toContain("March Payer");

    const mar = await csv(s, "year=2026&month=03");
    expect(mar.text).toContain("March Payer");
    expect(mar.text).not.toContain("January Payer");
  });
});
