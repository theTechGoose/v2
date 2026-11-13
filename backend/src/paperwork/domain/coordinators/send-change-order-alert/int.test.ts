/**
 * REQ-398 — demo-loop cycle 2, issue p13-j: the change-order link carries the
 * language it was sent in (`/co/<id>?lang=<commsLanguage>`), matching REQ-342
 * for quotes. /co reads ?lang= first and its EN | ES toggle flips it from
 * there.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { SendChangeOrderAlert } from "./mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";

async function seed(
  commsLanguage: "en" | "es",
  smsResult: { ok: boolean; reason?: string } = { ok: true },
  opts: {
    customerPhone?: string;
    contractorLanguage?: "en" | "es";
    realSms?: boolean;
    /** REQ-698: the bus the alert announces the send on */
    bus?: EventBus;
    /** REQ-698: the customer's email bounces */
    emailFails?: boolean;
  } = {},
) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Test Contractor",
    email: "me@test.dev",
    ...(opts.contractorLanguage ? { language: opts.contractorLanguage } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert("u-1", {
    businessName: "Pintura LLC",
    commsLanguage,
  } as never);
  const customer = await new CustomerStore().create("u-1", {
    name: "Juan",
    email: "juan@test.dev",
    phoneNumber: opts.customerPhone ?? "+15125550973",
  } as never);
  const inv = await new InvoiceStore().create("u-1", {
    customerId: customer.id,
    amount: 960_000,
    jobName: "Cocina",
  } as never);
  const co = await new ChangeOrderStore().create("u-1", inv.id, {
    description: "Repisas",
    deltaAmountCents: 85_000,
    customerId: customer.id,
    originalAmountCents: 960_000,
  });
  const email = new EmailService();
  const sms = new SmsService();
  const sent: SendEmailInput[] = [];
  const texts: string[] = [];
  const textedTo: string[] = [];
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    if (opts.emailFails && input.to === "juan@test.dev") {
      return Promise.resolve({ ok: false, reason: "bounced" });
    }
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  if (!opts.realSms) {
    sms.send = (input: { to: string; body: string }) => {
      texts.push(input.body);
      textedTo.push(input.to);
      return Promise.resolve(smsResult as never);
    };
  }
  const flow = new SendChangeOrderAlert(
    new ChangeOrderStore(),
    new CustomerStore(),
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    new InvoiceStore(),
    opts.bus,
  );
  return { flow, coId: co.id, invoiceId: inv.id, sent, texts, textedTo };
}

for (const lang of ["es", "en"] as const) {
  Deno.test(`REQ-398 p13-j: a change order sent in ${lang} links /co/<id>?lang=${lang} in the customer's email and SMS`, async () => {
    const { flow, coId, sent, texts } = await seed(lang);
    try {
      await flow.run(coId);
      const link = `/co/${coId}?lang=${lang}`;
      const toCustomer = sent.find((m) => m.to === "juan@test.dev");
      assert(toCustomer, "the customer got the email");
      assertStringIncludes(toCustomer.htmlBody ?? "", link);
      const customerSms = texts.find((t) => t.includes(coId));
      assert(customerSms, "an SMS carries the link");
      assertStringIncludes(customerSms, link);
      assert(
        texts.every((t) =>
          !t.includes(`/co/${coId} `) && !t.endsWith(`/co/${coId}`)
        ),
        "no bare /co link leaves",
      );
    } finally {
      await resetKv();
    }
  });
}

/**
 * REQ-456 (demo-loop cycle 3, M25): the alert reports what reached the
 * CUSTOMER, channel by channel, so the chat can say "Sent CO-001 to Juan by
 * email (…) — text failed (…)" instead of "I've sent you the link to share".
 */
Deno.test("REQ-456 M25: the change-order alert returns the CO number, the /co link and the customer's per-channel delivery", async () => {
  const { flow, coId } = await seed("en", {
    ok: false,
    reason: "invalid number",
  });
  try {
    const res = await flow.run(coId);
    assertEquals(res.customer, {
      number: "CO-001",
      approvalPath: `/co/${coId}?lang=en`,
      emailedTo: "juan@test.dev",
      smsFailureReason: "invalid number",
    });
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-456 M25: emailed and texted → both addresses are reported", async () => {
  const { flow, coId } = await seed("es");
  try {
    const res = await flow.run(coId);
    assertEquals(res.customer?.emailedTo, "juan@test.dev");
    assertEquals(res.customer?.textedTo, "+15125550973");
    assertEquals(res.customer?.approvalPath, `/co/${coId}?lang=es`);
  } finally {
    await resetKv();
  }
});

/**
 * REQ-588 (demo-loop cycle 4, M29): a change order texted to a reserved 555
 * number reported the raw lang key — "text: sms.fictionalNumber." — because
 * the alert stored SmsService's untranslated reason. The customer text now
 * goes through the guarded customer-SMS dispatch, which words the reason in
 * the contractor's UI language.
 */
for (
  const [lang, phrase] of [
    ["en", "reserved test number"],
    ["es", "número de prueba reservado"],
  ] as const
) {
  Deno.test(`REQ-588 M29: a CO texted to a 555 number reports a ${lang} sentence, never the sms.fictionalNumber key`, async () => {
    const { flow, coId } = await seed("en", { ok: true }, {
      customerPhone: "(512) 555-0123",
      contractorLanguage: lang,
      realSms: true,
    });
    try {
      const res = await flow.run(coId);
      // REQ-681 (cycle 5, m12): a 555 number is skipped, not "failed".
      const reason = res.customer?.smsSkippedReason ?? "";
      assert(!res.customer?.textedTo, "a 555 number is never texted");
      assert(!/^sms\./.test(reason), `raw lang key leaked: ${reason}`);
      assertStringIncludes(reason, phrase);
    } finally {
      await resetKv();
    }
  });
}

/**
 * REQ-698 (demo-loop cycle 5, m14): pair 5's CO-002, sent from the assistant,
 * never showed in "What we handled today" — the feed is built from
 * notifications and no change-order SEND event existed. Every CO send path
 * (assistant, chat edit, invoice controller) goes through this alert.
 */
Deno.test("REQ-698 (cycle 5, m14): a change order that reached the customer announces invoice 'change_order_sent' with its number, delta and customer", async () => {
  const bus = new EventBus();
  const events: DomainEvent[] = [];
  bus.subscribe((e) => {
    events.push(e);
  });
  const { flow, coId, invoiceId } = await seed("en", { ok: true }, { bus });
  try {
    await flow.run(coId);
    const sent = events.filter((e) => e.action === "change_order_sent");
    assertEquals(sent.length, 1);
    assertEquals(sent[0].entityType, "invoice");
    assertEquals(sent[0].entityId, invoiceId);
    assertEquals(sent[0].userId, "u-1");
    assertEquals(sent[0].data?.number, "CO-001");
    assertEquals(sent[0].data?.delta, "+$850.00");
    assertEquals(sent[0].data?.customerName, "Juan");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-698 (cycle 5, m14): a change order that reached nobody announces no send", async () => {
  const bus = new EventBus();
  const events: DomainEvent[] = [];
  bus.subscribe((e) => {
    events.push(e);
  });
  const { flow, coId } = await seed(
    "en",
    { ok: false, reason: "invalid number" },
    { bus, emailFails: true },
  );
  try {
    await flow.run(coId);
    assertEquals(events.filter((e) => e.action === "change_order_sent"), []);
  } finally {
    await resetKv();
  }
});

/**
 * REQ-681 (demo-loop cycle 5, m12): the send dialog already rules out texting
 * a number that can't take texts (REQ-569); the change-order alert now applies
 * the same shared predicate up front — no customer text is dispatched, and the
 * result says why it was skipped instead of reporting a failed text.
 */
Deno.test("REQ-681 m12 a CO to a 555 number never dispatches a customer text and reports smsSkippedReason", async () => {
  const { flow, coId, textedTo } = await seed("en", { ok: true }, {
    customerPhone: "(512) 555-0123",
  });
  try {
    const res = await flow.run(coId);
    assertEquals(
      textedTo.filter((to) => to !== "+15125550000"),
      [],
      "no customer text was dispatched (only the contractor's heads-up)",
    );
    assertEquals(res.customer?.textedTo, undefined);
    assertEquals(res.customer?.smsFailureReason, undefined);
    assertStringIncludes(
      res.customer?.smsSkippedReason ?? "",
      "reserved test number",
    );
    assertEquals(res.customer?.emailedTo, "juan@test.dev");
  } finally {
    await resetKv();
  }
});
