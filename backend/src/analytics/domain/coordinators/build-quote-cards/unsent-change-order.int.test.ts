/**
 * REQ-1030 (LOOP-007 cycle 2, q2-14) — the /quotes pipeline said
 *   "CO-001 is waiting on Maria Gonzalez."
 * about a change order the assistant had MADE but never sent (REQ-652: a chat
 * change order reaches the customer only on an explicit send). The card's
 * changeOrderFold counted every status === "pending" order as "waiting on the
 * customer"; nothing on a ChangeOrder says whether it was sent.
 *
 * Real stores, in-memory KV, the real ApplyChatChangeOrder and the real
 * SendChangeOrderAlert (only the email/SMS transports are captured).
 */
import { assertEquals } from "#std/assert";
import { BuildQuoteCards } from "./mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

async function seed() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Owner",
    email: "owner@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert("u-1", {
    businessName: "Gonzalez Remodel LLC",
    commsLanguage: "en",
  } as never);
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const changeOrders = new ChangeOrderStore();
  const maria = await customers.create("u-1", {
    name: "Maria Gonzalez",
    email: "maria@test.dev",
    phoneNumber: "+15125550973",
  } as never);
  const draft = await quotes.create("u-1", {
    summary: "Kitchen remodel — Maria Gonzalez",
    jobName: "Kitchen remodel",
    customerId: maria.id,
    lineItems: [{
      description: "Cabinets",
      quantity: 1,
      unit: "job",
      price: 1_200_000,
    }],
    estimatedTotal: 1_200_000,
  });
  // Q-001 is signed; its invoice is open — the change order goes on it.
  const quote = await quotes.update(draft.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  await invoices.create("u-1", {
    quoteId: quote.id,
    customerId: maria.id,
    amount: 1_200_000,
    jobName: "Kitchen remodel",
  } as never);

  const sentEmails: SendEmailInput[] = [];
  const texts: string[] = [];
  const email = new EmailService();
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const sms = new SmsService();
  sms.send = (input: { to: string; body: string }) => {
    texts.push(input.body);
    return Promise.resolve({ ok: true } as never);
  };
  const alert = new SendChangeOrderAlert(
    changeOrders,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    invoices,
  );
  const chat = new ApplyChatChangeOrder(
    quotes,
    invoices,
    changeOrders,
    customers,
    alert,
  );
  const cards = new BuildQuoteCards(
    quotes,
    new ViewStore(),
    customers,
    changeOrders,
  );
  return { quote, chat, cards, sentEmails, texts };
}

/** The assistant makes CO-001 on Q-001 — nothing in the ask says "send". */
async function makeUnsent(s: Awaited<ReturnType<typeof seed>>) {
  const made = await s.chat.run({
    userId: "u-1",
    lang: "en",
    boundQuoteId: s.quote.id,
    description: "Upgraded countertops",
    deltaAmountCents: 280_000,
    userText:
      "Make a change order for Q-001 adding $2,800 for upgraded countertops",
  });
  return made;
}

Deno.test("REQ-1030 (LOOP-007 q2-14): a change order the assistant made but never sent is NOT 'waiting on the customer' on its /quotes card — it is listed as unsent", async () => {
  const s = await seed();
  try {
    const made = await makeUnsent(s);
    assertEquals(
      {
        kind: made.outcome?.kind,
        number: (made.outcome as { changeOrderNumber?: string })
          ?.changeOrderNumber,
        sent: (made.outcome as { sent?: boolean })?.sent,
      },
      { kind: "change_order", number: "CO-001", sent: false },
      `precondition (REQ-652): CO-001 is made and not sent — ${made.text}`,
    );
    assertEquals(
      s.sentEmails.length + s.texts.length,
      0,
      "precondition: nothing was emailed or texted",
    );

    const [card] = await s.cards.run("u-1");
    assertEquals(
      card.pendingChangeOrders,
      [],
      "CO-001 was never sent to Maria, so the card must not say it is waiting on her",
    );
    assertEquals(
      (card as { unsentChangeOrders?: string[] }).unsentChangeOrders,
      ["CO-001"],
      "the unsent change order is still named on the card (not hidden)",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1030 (LOOP-007 q2-14): after 'Send CO-001' the change order moves from unsent to waiting on the customer", async () => {
  const s = await seed();
  try {
    await makeUnsent(s);
    const sent = await s.chat.send({
      userId: "u-1",
      lang: "en",
      changeOrderNumber: "CO-001",
    });
    assertEquals(
      (sent?.outcome as { sent?: boolean } | undefined)?.sent,
      true,
      `precondition: 'Send CO-001' sent it — ${sent?.text}`,
    );

    const [card] = await s.cards.run("u-1");
    assertEquals(
      card.pendingChangeOrders,
      ["CO-001"],
      "now it IS waiting on Maria",
    );
    assertEquals(
      (card as { unsentChangeOrders?: string[] }).unsentChangeOrders,
      [],
      "and is no longer listed as unsent",
    );
  } finally {
    await resetKv();
  }
});
