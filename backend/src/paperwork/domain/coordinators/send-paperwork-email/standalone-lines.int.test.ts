/**
 * REQ-1127 — LOOP-007 cycle 3, issue q3-55 ("Invoice email lists line items
 * without their prices"). Through the real send flow: a standalone invoice
 * (no quote) with two REQ-921 service rows is emailed, and the captured
 * outbox htmlBody must carry both line totals, not only the subtotal.
 */
import { assert } from "#std/assert";
import { SendPaperworkEmail } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

async function setup(lang: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const customers = new CustomerStore();
  const invoices = new InvoiceStore();
  const identities = new BusinessIdentityStore();
  const email = new EmailService();
  const sent: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendPaperworkEmail(
    new QuoteStore(),
    invoices,
    customers,
    new UserStore(),
    identities,
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Dana Whitfield",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await identities.upsert("u-1", {
    businessName: "Whitfield Fence & Gate",
    commsLanguage: lang,
  });
  const customer = await customers.create("u-1", {
    name: "Rosa Delgado",
    email: "rosa@acme.test",
  });
  // the New-invoice (REQ-921) shape: service rows, jobName = joined names, no quote
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    jobName: "Gate repair, Hinge hardware",
    lineItems: [
      { description: "Gate repair", quantity: 1, unit: "ea", price: 18_010 },
      { description: "Hinge hardware", quantity: 1, unit: "ea", price: 4_520 },
    ],
    amount: 22_530,
    subtotalCents: 22_530,
  } as never);
  return { flow, inv, sent };
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1127 (q3-55) send-paperwork-email ${lang}: the sent email of a standalone two-line invoice carries both line prices`, async () => {
    const { flow, inv, sent } = await setup(lang);
    const r = await flow.run("u-1", { kind: "invoice", resourceId: inv.id });
    assert(r.ok, `send failed: ${JSON.stringify(r)}`);
    const html = sent[0].htmlBody;
    assert(html.includes("$225.30"), "the amount due is missing");
    assert(
      html.includes("$180.10"),
      `the sent invoice email never prices "Gate repair" ($180.10)`,
    );
    assert(
      html.includes("$45.20"),
      `the sent invoice email never prices "Hinge hardware" ($45.20)`,
    );
  });
}
