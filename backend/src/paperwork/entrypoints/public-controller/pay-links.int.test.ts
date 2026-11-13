/**
 * REQ-630 — every way the business gets paid, one tap away, through the booted app: Settings
 * stores "other payment links" by name + https URL (http / javascript: refused with 400, the
 * existing methods untouched), the public invoice projects them next to the app methods, a
 * customer who paid through one can say so ("I sent it" as `other`, the link's name as the
 * reference), and the invoice email and text name the same ways — the email with the amount in
 * the Venmo / Cash App links and a "Pay by card" row once Stripe is connected.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fakeStripeWorld } from "@core/data/stripe-gateway/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { StripeSettingsStore } from "@users/domain/data/stripe-settings-store/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9630;
const J = { "content-type": "application/json" };
const H = (sid: string) => ({ ...J, "x-session-id": sid });
const url = (p: string) => `http://localhost:${PORT}${p}`;

async function login(
  phone = "+15125556301",
): Promise<{ sid: string; userId: string }> {
  await (await fetch(url("/auth/send-otp"), {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(url("/auth/verify-otp"), {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return { sid: v.sessionId, userId: v.user?.id ?? v.userId };
}

async function withServer(fn: (sid: string, userId: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("DENO_DEPLOY");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  await resetKv();
  fakeStripeWorld().reset();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid, userId } = await login();
    await fn(sid, userId);
  } finally {
    await server.stop();
    await resetKv();
  }
}

const METHODS = {
  venmo: { enabled: true, handle: "@acme-roof" },
  cashapp: { enabled: true, cashtag: "$acmeroof" },
  zelle: { enabled: true, handle: "pay@acme.test" },
};

async function putIdentity(sid: string, body: unknown) {
  return await fetch(url("/profile/identity"), {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify(body),
  });
}

async function seedInvoice(sid: string, amount = 6500) {
  const customer = await fetch(url("/customers"), {
    method: "POST",
    headers: H(sid),
    body: JSON.stringify({
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
      phoneNumber: "+15127771234",
    }),
  }).then((r) => r.json());
  return await fetch(url("/invoices"), {
    method: "POST",
    headers: H(sid),
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Lawn care",
      amount,
      issuedDate: "2026-11-01",
      dueDate: "2026-11-30",
    }),
  }).then((r) => r.json());
}

Deno.test("REQ-630 PUT /profile/identity: payment links are a name + an https URL — http and javascript: are 400, nothing stored; a good list is stored with ids and the other methods stay", async () => {
  await withServer(async (sid) => {
    const first = await putIdentity(sid, {
      businessName: "A2Z Landscape",
      acceptedPaymentMethods: METHODS,
    });
    assertEquals(first.status, 200, await first.text());

    for (
      const bad of [
        "http://extrapay.example/a2z",
        "javascript:alert(1)",
        "extrapay.example",
      ]
    ) {
      const r = await putIdentity(sid, {
        acceptedPaymentMethods: {
          ...METHODS,
          links: [{ name: "Extra Pay", url: bad }],
        },
      });
      const body = await r.json();
      assertEquals(r.status, 400, `${bad} → ${JSON.stringify(body)}`);
      assert(/^pay_link_url_/.test(String(body.error)), JSON.stringify(body));
    }
    const noName = await putIdentity(sid, {
      acceptedPaymentMethods: {
        ...METHODS,
        links: [{ name: " ", url: "https://x.example" }],
      },
    });
    assertEquals(noName.status, 400);
    await noName.body?.cancel();

    const ok = await putIdentity(sid, {
      acceptedPaymentMethods: {
        ...METHODS,
        links: [{ name: " Extra Pay ", url: "https://extrapay.example/a2z" }],
      },
    });
    assertEquals(ok.status, 200);
    const saved = await ok.json();
    assertEquals(saved.acceptedPaymentMethods.venmo, METHODS.venmo);
    assertEquals(saved.acceptedPaymentMethods.links.length, 1);
    assertEquals(saved.acceptedPaymentMethods.links[0].name, "Extra Pay");
    assertEquals(
      saved.acceptedPaymentMethods.links[0].url,
      "https://extrapay.example/a2z",
    );
    assertEquals(saved.acceptedPaymentMethods.links[0].enabled, true);
    assert(saved.acceptedPaymentMethods.links[0].id, "a link gets an id");

    const back = await fetch(url("/profile/identity"), { headers: H(sid) })
      .then((r) => r.json());
    assertEquals(
      back.acceptedPaymentMethods.links,
      saved.acceptedPaymentMethods.links,
    );
  });
});

Deno.test("REQ-630 GET /invoices/:id/public: the app methods and the custom links in acceptedMethods; 'I sent it' through a link is a claim as other with the link's name", async () => {
  await withServer(async (sid) => {
    const put = await putIdentity(sid, {
      businessName: "A2Z Landscape",
      acceptedPaymentMethods: {
        ...METHODS,
        links: [
          { id: "xp", name: "Extra Pay", url: "https://extrapay.example/a2z" },
          {
            id: "off",
            name: "Old portal",
            url: "https://old.example",
            enabled: false,
          },
        ],
      },
    });
    assertEquals(put.status, 200, await put.text());
    const inv = await seedInvoice(sid);
    const pub = await fetch(url(`/invoices/${inv.id}/public`)).then((r) =>
      r.json()
    );
    assertEquals(pub.acceptedMethods, [
      { method: "venmo", handle: "@acme-roof" },
      { method: "zelle", handle: "pay@acme.test" },
      { method: "cashapp", handle: "$acmeroof" },
      {
        method: "link",
        id: "xp",
        name: "Extra Pay",
        url: "https://extrapay.example/a2z",
      },
    ]);

    const claim = await fetch(url(`/invoices/${inv.id}/claim-payment`), {
      method: "POST",
      headers: J,
      body: JSON.stringify({
        method: "other",
        reference: "Extra Pay",
        amountCents: 6500,
      }),
    });
    assertEquals(claim.status, 200, await claim.text());
    const office = await fetch(url(`/invoices/${inv.id}`), { headers: H(sid) })
      .then((r) => r.json());
    assertEquals(office.status, "claimed");
    assertEquals(office.paymentIntent.method, "other");
    assertEquals(office.paymentIntent.reference, "Extra Pay");
  });
});

Deno.test("REQ-630 the invoice email and text name the ways to pay — the amount in the app links, the custom link, Zelle, and card first once Stripe is connected", async () => {
  await withServer(async (sid, userId) => {
    await (await putIdentity(sid, {
      businessName: "A2Z Landscape",
      acceptedPaymentMethods: {
        ...METHODS,
        links: [{
          id: "xp",
          name: "Extra Pay",
          url: "https://extrapay.example/a2z",
        }],
      },
    })).body?.cancel();
    await (await fetch(url("/me"), {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({ name: "Alexander Jerez" }),
    })).body?.cancel();
    const inv = await seedInvoice(sid);

    const email = new EmailService();
    const sent: SendEmailInput[] = [];
    email.send = (input: SendEmailInput) => {
      sent.push(input);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    const sms = new SmsService();
    const texts: string[] = [];
    sms.send = (input: { to: string; body: string }) => {
      texts.push(input.body);
      return Promise.resolve({ ok: true, reason: "test_capture" });
    };
    const log = () =>
      new LogPaperworkMessage(new ConversationStore(), new MessageStore());
    const emailer = new SendPaperworkEmail(
      new QuoteStore(),
      new InvoiceStore(),
      new CustomerStore(),
      new UserStore(),
      new BusinessIdentityStore(),
      email,
      log(),
      undefined, // REQ-566 (demo-fixes): the event bus
      undefined, // REQ-679 (demo-fixes): the change-order store (defaulted)
      new StripeSettingsStore(),
    );
    const texter = new SendPaperworkSms(
      new QuoteStore(),
      new InvoiceStore(),
      new CustomerStore(),
      new UserStore(),
      new BusinessIdentityStore(),
      sms,
      new ShortLinkStore(),
      log(),
      undefined, // REQ-566 (demo-fixes): the event bus
      new StripeSettingsStore(),
    );

    const e1 = await emailer.run(userId, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(e1.ok, true, JSON.stringify(e1));
    const html = sent[0].htmlBody ?? "";
    assertStringIncludes(html, "data-pay-ways");
    assertStringIncludes(
      html,
      "https://venmo.com/acme-roof?txn=pay&amp;amount=65.00",
    );
    assertStringIncludes(html, "https://cash.app/$acmeroof/65.00");
    assertStringIncludes(html, "https://extrapay.example/a2z");
    assertStringIncludes(html, "pay@acme.test");
    assert(!html.includes(`data-pay-way="card"`), "no card row without Stripe");

    const t1 = await texter.run(userId, {
      kind: "invoice",
      resourceId: inv.id,
    });
    assertEquals(t1.ok, true, JSON.stringify(t1));
    assertStringIncludes(
      texts[0],
      "Pay online by Venmo, Cash App, Zelle or Extra Pay — all at the link.",
    );

    // Stripe connected → card is the first way in both
    const c = await fetch(url("/me/stripe"), {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        publishableKey: "pk_test_fake_a2z",
        secretKey: "sk_test_fake_a2z",
      }),
    });
    assertEquals(c.status, 200, await c.text());
    await emailer.run(userId, { kind: "invoice", resourceId: inv.id });
    const html2 = sent[1].htmlBody ?? "";
    assertStringIncludes(html2, `data-pay-way="card"`);
    assert(
      html2.indexOf(`data-pay-way="card"`) <
        html2.indexOf(`data-pay-way="venmo"`),
    );
    await texter.run(userId, { kind: "invoice", resourceId: inv.id });
    assertStringIncludes(
      texts[1],
      "Pay online by card, Venmo, Cash App, Zelle or Extra Pay",
    );

    // the paid email asks for nothing
    await emailer.run(userId, {
      kind: "invoice",
      resourceId: inv.id,
      variant: "paid",
    });
    assert(
      !(sent[2].htmlBody ?? "").includes("data-pay-ways"),
      "a paid email lists no ways to pay",
    );
  });
});
