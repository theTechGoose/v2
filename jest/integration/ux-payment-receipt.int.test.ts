/**
 * RED (TDD) — UX-30 over real HTTP: the promised payment receipt must
 * actually go out to the customer (and be auditable in the comms log).
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-30 "[PAYMENTS/TRUST] The promised payment receipt never goes out. The
 *         customer's claim confirmation says 'Confirmará cuando llegue el
 *         dinero — y te enviaremos un recibo.' After the contractor
 *         confirmed, no receipt SMS/email was dispatched (comms log
 *         checked). Broken promise at the exact moment trust is built."
 *
 * The promises, verbatim in the dictionaries:
 *   lang/es.json:1945 publicInvoiceClaim.thanksBody
 *     "… Confirmará cuando llegue el dinero — y te enviaremos un recibo."
 *   lang/es.json:1885 publicInvoice.claimed.body
 *     "Te enviaremos un recibo cuando {who} confirme que el dinero llegó."
 *   lang/es.json:1911 publicInvoice.received.body
 *     "… Un recibo en PDF está en tu correo."
 *
 * WHY nothing is auditable today (verified against prod source):
 *   ConfirmPayment (backend/src/paperwork/domain/coordinators/
 *   confirm-payment/mod.ts) fires its receipt email (:104-128) and receipt
 *   SMS (:129-158) through EmailService/SmsService DIRECTLY and never calls
 *   LogPaperworkMessage — unlike every other outbound paperwork dispatch
 *   (send-paperwork-sms/mod.ts:161-171, send-paperwork-email/mod.ts:262,
 *   send-accepted-alert/mod.ts:95,123, send-signed-confirmation/mod.ts:298,
 *   363 — the P-30 precedent required exactly this logging). So the receipt
 *   is invisible to the comms trail ("every outbound is queryable per
 *   document", roadmap p.8) and the audited session found NO receipt.
 *
 * Live probe (2026-08-19, phone +15125556220): seedInvoice(sent) →
 * anonymous POST /invoices/:id/claim-payment {method:"zelle"} → 200 →
 * contractor POST /invoices/:id/confirm-payment → 200 {ok:true, paymentId}
 * → invoice status "paid" — and after 10s of polling GET /messages held
 * ZERO rows (forInvoice=0, toCustomer=0).
 *
 * DESIRED: after confirm-payment a receipt comm to the CUSTOMER is logged —
 * channel "text" or "email", addressed to the customer's phone or email,
 * referencing the invoice.
 *
 * Phones used (reserved block +15125556200…6299):
 *   +15125556220 contractor, +15125556221 customer.
 */
import {
  anonymous,
  ApiSession,
  seedCustomer,
  seedInvoice,
} from "./helpers/api";

const CONTRACTOR_PHONE = "+15125556220";
const CUSTOMER_PHONE = "+15125556221";
const CUSTOMER_EMAIL = "ux30.cust@blackhole.postmarkapp.com";

type LoggedMessage = {
  channel?: string;
  content?: string;
  subject?: string;
  toAddress?: string;
  paperworkId?: string;
  paperworkType?: string;
};

async function allMessages(s: ApiSession): Promise<LoggedMessage[]> {
  const { body } = await s.get("/messages");
  return Array.isArray(body) ? body : body?.items ?? [];
}

describe("UX-30: confirming a claimed payment sends the promised receipt to the customer", () => {
  let s: ApiSession;
  let invoiceId: string;

  beforeAll(async () => {
    s = new ApiSession();
    const v = await s.post("/auth/verify", {
      phoneNumber: CONTRACTOR_PHONE,
      code: "000000",
    });
    expect(v.status).toBeLessThan(400);
    // Real identity so the receipt has a sender to speak as.
    await s.put("/me", {
      name: "Rafa Recibos",
      email: "ux30.jest@blackhole.postmarkapp.com",
      language: "es",
    });
    await s.put("/profile/identity", { businessName: "Recibos LLC" });

    // Customer reachable on BOTH channels — either receipt channel counts.
    const customerId = await seedCustomer(s, {
      name: "María Pagadora",
      phoneNumber: CUSTOMER_PHONE,
      email: CUSTOMER_EMAIL,
    });
    invoiceId = await seedInvoice(s, {
      customerId,
      jobName: "Patio de adoquines",
      amount: 370000,
      status: "sent",
    });

    // Customer side: the public claim ("El cliente pagó por Zelle") — this
    // is the moment the UI promises "y te enviaremos un recibo".
    const claim = await anonymous().post(
      `/invoices/${invoiceId}/claim-payment`,
      {
        method: "zelle",
        claimedBy: "María Pagadora",
      },
    );
    expect(claim.status).toBeLessThan(400);
    expect(claim.body?.ok).toBe(true);

    // Contractor side: "Listo, lo recibí →".
    const confirm = await s.post(`/invoices/${invoiceId}/confirm-payment`);
    expect(confirm.status).toBe(200);
    expect(confirm.body?.ok).toBe(true);
  }, 30_000);

  it("UX-30: [anchor — green today] the money loop itself closes (invoice → paid)", async () => {
    const inv = await s.get(`/invoices/${invoiceId}`);
    expect(inv.status).toBeLessThan(400);
    expect(inv.body?.status).toBe("paid");
  });

  it(
    "UX-30: a receipt comm to the CUSTOMER is logged (channel text or email)",
    async () => {
      // The receipt dispatch may be fire-and-forget (PDF render first) — poll.
      let receipt: LoggedMessage | undefined;
      for (let i = 0; i < 20 && !receipt; i++) {
        const rows = await allMessages(s);
        receipt = rows.find((m) =>
          (m.channel === "text" || m.channel === "email") &&
          (m.toAddress === CUSTOMER_PHONE || m.toAddress === CUSTOMER_EMAIL) &&
          JSON.stringify(m).includes(invoiceId)
        );
        if (!receipt) await new Promise((r) => setTimeout(r, 500));
      }
      // RED today: ConfirmPayment never logs its receipt dispatch — after the
      // full claim→confirm loop the comms log holds nothing for this invoice.
      expect(receipt).toBeDefined();
      // And it must actually read as a receipt, not as a re-send of the bill.
      const copy = [receipt?.subject, receipt?.content].filter(Boolean).join(
        "\n",
      );
      expect(copy).toMatch(/recib|receipt|pago|payment/i);
    },
    25_000,
  );
});
