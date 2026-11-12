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

async function seed(
  commsLanguage: "en" | "es",
  smsResult: { ok: boolean; reason?: string } = { ok: true },
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
    phoneNumber: "+15125550973",
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
  email.send = (input: SendEmailInput) => {
    sent.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  sms.send = (input: { to: string; body: string }) => {
    texts.push(input.body);
    return Promise.resolve(smsResult as never);
  };
  const flow = new SendChangeOrderAlert(
    new ChangeOrderStore(),
    new CustomerStore(),
    new UserStore(),
    new BusinessIdentityStore(),
    email,
    sms,
    new InvoiceStore(),
  );
  return { flow, coId: co.id, sent, texts };
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
