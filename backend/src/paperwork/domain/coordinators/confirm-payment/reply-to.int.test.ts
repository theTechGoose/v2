/**
 * REQ-1017 (LOOP-007 q1, q1-104) / REQ-175 — the payment receipt is a
 * paperwork email from the contractor to a known customer, so it carries the
 * same `Reply-To: reply+<token>@<inbound domain>` the invoice emails carry:
 * a customer who replies to "Receipt for INV-…" lands in that customer's
 * Messages thread, not the business's From alias.
 *
 * The send goes through the real EmailService (a captured Postmark fetch),
 * so the assertion is on the Postmark payload's ReplyTo — the header the
 * customer's mail client actually uses.
 */
import { assert, assertEquals, assertMatch } from "#std/assert";
import { ConfirmPayment } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type PostmarkPayload,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import type { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import {
  inboundDomain,
  replyAddress,
} from "@paperwork/domain/business/inbound-reply/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-1017";

function rig() {
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const customers = new CustomerStore();
  // the real EmailService, its Postmark request captured
  const email = new EmailService();
  const posted: PostmarkPayload[] = [];
  email.apiKeyOverride = "test-token-1017";
  email.fetchOverride = (_url, init) => {
    posted.push(JSON.parse(String(init?.body)) as PostmarkPayload);
    return Promise.resolve(
      new Response(JSON.stringify({ MessageID: `m-${posted.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const sms = new SmsService();
  sms.send = () => Promise.resolve({ ok: true, sid: "SM-1017" });
  const commsLog = new LogPaperworkMessage(
    new CommConversationStore(),
    new CommMessageStore(),
  );
  commsLog.run = () => Promise.resolve(undefined);
  commsLog.outbox = () => Promise.resolve(undefined);
  const receiptPdf = new RenderReceiptPdf();
  receiptPdf.run = () => Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  const markPaid = new MarkInvoicePaid({} as SendPaperworkEmail, invoices);
  markPaid.run = () => Promise.resolve();
  const flow = new ConfirmPayment(
    invoices,
    payments,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    new ShortLinkStore(),
    receiptPdf,
    commsLog,
    new EventBus(),
    markPaid,
    new ComputeInvoiceBalance(invoices, payments, markPaid),
  );
  return { flow, invoices, customers, posted };
}

Deno.test("REQ-1017 / REQ-175 confirm-payment: the receipt email carries the customer's Reply-To reply+<token>@inbound domain, the same token the invoice emails use", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("INBOUND_MAIL_DOMAIN");
  await resetKv();
  const r = rig();
  try {
    const c = await r.customers.create(USER, {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const inv = await r.invoices.create(
      USER,
      {
        customerId: c.id,
        status: "claimed",
        amount: 450_00,
        lineItems: [{ description: "Gutters", quantity: 1, price: 450_00 }],
        paymentIntent: {
          method: "zelle",
          amount: 450_00,
          reference: "ZL-1017",
          claimedAt: new Date().toISOString(),
        },
      } as unknown as Parameters<InvoiceStore["create"]>[1],
    );

    const out = await r.flow.run(USER, inv.id);
    assertEquals(out.ok, true, "the payment is confirmed");

    const receipt = r.posted.find((p) => /Receipt for INV-/.test(p.Subject));
    assert(
      receipt,
      `a "Receipt for …" email reached Postmark (subjects: ${
        r.posted.map((p) => p.Subject).join(" | ")
      })`,
    );
    assertMatch(
      receipt.ReplyTo ?? "(no ReplyTo)",
      /^reply\+[a-z0-9]+@inbound\.documonster\.com$/,
      "the receipt's Postmark payload carries ReplyTo reply+<token>@inbound.documonster.com",
    );
    // the token is the one send-paperwork-email uses for this contractor +
    // customer (ReplyTokenStore mints once per pair, then reuses it)
    const token = await new ReplyTokenStore().forCustomer(USER, c.id);
    assertEquals(
      receipt.ReplyTo,
      replyAddress(token, inboundDomain()),
      "the receipt's Reply-To reuses the customer's reply token",
    );
  } finally {
    await resetKv();
  }
});
