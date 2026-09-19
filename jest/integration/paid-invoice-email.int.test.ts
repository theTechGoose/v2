/**
 * REQ-020 — NW-29 (p28): "When an invoice is paid it must also be emailed to
 * the Unicorn with 'Paid' on it so everyone is on the same page."
 *
 * Over the REAL API: a recorded payment that closes the balance (POST
 * /payments, the REQ-018 path) must leave an EMAIL row in the comms trail
 * for that invoice whose subject says Paid — the invoice stamped PAID, not
 * a receipt. In dev the mailer short-circuits but still reports ok, so the
 * trail is the observable.
 */
import { type ApiSession, contractor, seedCustomer, seedInvoice } from "./helpers/api";

type LoggedMessage = {
  channel?: string;
  subject?: string;
  content?: string;
  toAddress?: string;
  paperworkId?: string;
};

async function messagesFor(s: ApiSession, invoiceId: string): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  const rows: LoggedMessage[] = Array.isArray(body) ? body : body?.items ?? [];
  return rows.filter((m) => m.paperworkId === invoiceId);
}

describe("REQ-020 NW-29 a payment that closes the balance emails the invoice marked PAID", () => {
  let s: ApiSession;
  let invoiceId: string;
  const CUSTOMER_EMAIL = "paid.cust@blackhole.postmarkapp.com";

  beforeAll(async () => {
    s = await contractor("+15125550963");
    await s.put("/me", { name: "Paid Contractor", email: "paid.jest@blackhole.postmarkapp.com", language: "en" });
    await s.put("/profile/identity", { businessName: "Paid LLC", commsLanguage: "en" });
    const customerId = await seedCustomer(s, {
      name: "Unicorn Customer",
      email: CUSTOMER_EMAIL,
      phoneNumber: "+15125550964",
    });
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: "Deck Staining",
      amount: 45000,
      status: "sent",
      issuedDate: new Date().toISOString().slice(0, 10),
    });
  });

  it("REQ-020 the comms trail holds an email to the customer for the invoice whose subject says Paid", async () => {
    const pay = await s.post("/payments", {
      invoiceId,
      amount: 45000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });
    expect(pay.status).toBeLessThan(400);
    const inv = await s.get(`/invoices/${invoiceId}`);
    expect(inv.body?.status).toBe("paid");

    let paidEmail: LoggedMessage | undefined;
    for (let i = 0; i < 20 && !paidEmail; i++) {
      const rows = await messagesFor(s, invoiceId);
      paidEmail = rows.find((m) =>
        m.channel === "email" && m.toAddress === CUSTOMER_EMAIL &&
        /\b(paid|pagad[ao])\b/i.test(m.subject ?? "")
      );
      if (!paidEmail) await new Promise((r) => setTimeout(r, 250));
    }
    // (Jest expect takes one argument — the message lives in the test name.)
    expect(paidEmail).toBeTruthy();
    expect(paidEmail!.subject).toMatch(/paid/i);
    expect(paidEmail!.subject).not.toMatch(/receipt/i);
  });
});
