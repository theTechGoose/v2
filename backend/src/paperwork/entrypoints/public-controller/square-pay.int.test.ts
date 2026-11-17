/**
 * REQ-803 — the public invoice's card payment through the business's OWN Square (the fake
 * here): the config is off until the business connects; the checkout is a Square payment link
 * for the exact balance on the business's token and location, with the way back to /i/:id; a
 * stale balance or version is 409 with the current one; coming back paid records exactly one
 * card Payment whose reference is the Square payment id (RecordCardPayment, the same path
 * Stripe uses); unpaid records nothing; reading again records nothing more; no Square is 404.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fakeSquareWorld, squareEnv } from "@core/data/square-gateway/mod.ts";
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
import { SquareSettingsStore } from "@users/domain/data/square-settings-store/mod.ts";

// REQ-318: this file pins "off the real deploy" for the Square seam only, never by flipping the
// process-wide DENO_DEPLOY (parallel files share it; see square-gateway's `squareEnv`)
squareEnv.reader = {
  get: (k) => (k.startsWith("DENO_DEPLOY") ? undefined : Deno.env.get(k)),
};

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9804;
const BASE = `http://localhost:${PORT}`;
const J = { "content-type": "application/json" };

async function login(phone = "+15125558040"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(fn: (sid: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  // off the real deploy already (the lane never sets it); NOT deleted here — the env is the
  // process's, and deleting it would race a parallel file that sets it on purpose (REQ-286)
  await resetKv();
  fakeSquareWorld().reset();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(await login());
  } finally {
    await server.stop();
    await resetKv();
  }
}

const H = (sid: string) => ({ ...J, "x-session-id": sid });

async function seed(sid: string, amount = 6500) {
  const customer = await fetch(`${BASE}/customers`, {
    method: "POST",
    headers: H(sid),
    body: JSON.stringify({
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    }),
  }).then((r) => r.json());
  return await fetch(`${BASE}/invoices`, {
    method: "POST",
    headers: H(sid),
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Roof repair",
      amount,
      issuedDate: "2026-11-01",
      dueDate: "2026-11-30",
    }),
  }).then((r) => r.json());
}

async function connect(sid: string) {
  await (await fetch(`${BASE}/profile/identity`, {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify({
      businessName: "Acme Roofing",
      acceptedPaymentMethods: {
        card: { enabled: true, instructions: "Call us with your card" },
      },
    }),
  })).body?.cancel();
  const r = await fetch(`${BASE}/me/square`, {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify({ accessToken: "EAAAfake_acme" }),
  });
  const text = await r.text();
  assertEquals(r.status, 200, text);
}

async function checkout(
  invoiceId: string,
  body: Record<string, unknown>,
  origin = "http://localhost:7777",
) {
  const r = await fetch(`${BASE}/invoices/${invoiceId}/square/checkout`, {
    method: "POST",
    headers: { ...J, origin },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

const publicOf = (id: string, q = "") =>
  fetch(`${BASE}/invoices/${id}/public${q}`).then((r) => r.json());

async function paymentsOf(sid: string, invoiceId: string) {
  return (await fetch(`${BASE}/payments`, { headers: H(sid) }).then((r) =>
    r.json()
  ) as Array<
    { invoiceId: string; method: string; reference?: string; amount: number }
  >).filter((p) => p.invoiceId === invoiceId);
}

Deno.test("REQ-803 GET /invoices/:id/square — off until the business connects Square; then the merchant, the environment and the balance, never the token; the manual card chip is dropped", async () => {
  await withServer(async (sid) => {
    const inv = await seed(sid);
    const off = await fetch(`${BASE}/invoices/${inv.id}/square`).then((r) =>
      r.json()
    );
    assertEquals(off, { available: false });
    await connect(sid);
    const text = await fetch(`${BASE}/invoices/${inv.id}/square`).then((r) =>
      r.text()
    );
    assertEquals(text.includes("EAAAfake"), false, "no token in public");
    const on = JSON.parse(text);
    assertEquals(
      [
        on.available,
        on.provider,
        on.merchantName,
        on.amountCents,
        on.environment,
        on.fake,
      ],
      [true, "square", "Acme Roofing", 6500, "sandbox", true],
    );
    assertEquals(typeof on.version, "number");
    // the Stripe config stays off (one provider at a time)
    const stripe = await fetch(`${BASE}/invoices/${inv.id}/card`).then((r) =>
      r.json()
    );
    assertEquals(stripe, { available: false });
    const pub = await publicOf(inv.id);
    assertEquals(
      (pub.acceptedMethods as Array<{ method: string }>).some((m) =>
        m.method === "card"
      ),
      false,
      "the manual card chip is gone while Square is on",
    );
  });
});

Deno.test("REQ-803 POST /invoices/:id/square/checkout — a Square payment link for the exact balance on the business's token and location, back to /i/:id?square=return; the same tap again reuses it", async () => {
  await withServer(async (sid) => {
    await connect(sid);
    const inv = await seed(sid);
    const res = await checkout(inv.id, { amountCents: 6500, version: 1 });
    assertEquals(res.status, 200, JSON.stringify(res.body));
    assertEquals(res.body.ok, true);
    assert(
      String(res.body.url).startsWith("/api/dev/square/checkout/sqlink_fake_"),
      res.body.url,
    );
    const linkId = String(res.body.url).split("/").pop()!;
    const link = fakeSquareWorld().links.get(linkId)!;
    assertEquals(
      [
        link.amountCents,
        link.currency,
        link.locationId,
        link.redirectUrl,
        link.account,
      ],
      [
        6500,
        "USD",
        "LFAKE_acme_main",
        `http://localhost:7777/i/${inv.id}?square=return`,
        "acme",
      ],
      "on the business's own Square, back to the invoice",
    );
    assert(link.name.startsWith("Invoice INV-"), link.name);
    assert(link.name.endsWith(" · Acme Roofing"), link.name);

    const again = await checkout(inv.id, { amountCents: 6500, version: 1 });
    assertEquals(again.body.url, res.body.url, "one link for the same balance");
    assertEquals(fakeSquareWorld().links.size, 1);
  });
});

Deno.test("REQ-803 POST /invoices/:id/square/checkout — a stale balance or version is 409 with the current one; no Square is 404; bad body 400", async () => {
  await withServer(async (sid) => {
    const before = await seed(sid);
    const none = await checkout(before.id, { amountCents: 6500, version: 1 });
    assertEquals(none.status, 404);
    assertEquals(none.body.reason, "card_unavailable");

    await connect(sid);
    const inv = await seed(sid);
    const staleAmount = await checkout(inv.id, {
      amountCents: 5000,
      version: 1,
    });
    assertEquals(staleAmount.status, 409);
    assertEquals(
      [staleAmount.body.reason, staleAmount.body.balanceCents],
      ["stale_balance", 6500],
    );
    assertEquals(typeof staleAmount.body.version, "number");
    const staleVersion = await checkout(inv.id, {
      amountCents: 6500,
      version: 99,
    });
    assertEquals(staleVersion.status, 409);
    assertEquals(staleVersion.body.reason, "stale_balance");
    assertEquals(fakeSquareWorld().links.size, 0, "Square was never asked");

    const bad = await checkout(inv.id, { amountCents: "lots" });
    assertEquals(bad.status, 400);
    const missing = await checkout("no-such-invoice", { amountCents: 1 });
    assertEquals(missing.status, 404);
  });
});

Deno.test("REQ-803 coming back from Square — paid: exactly one card Payment with the Square payment id, the invoice paid; unpaid records nothing; a second return records nothing more", async () => {
  await withServer(async (sid) => {
    await connect(sid);
    const inv = await seed(sid);
    const res = await checkout(inv.id, { amountCents: 6500, version: 1 });
    const linkId = String(res.body.url).split("/").pop()!;

    // cancelled / not yet paid: the return records nothing, the button stays
    const unpaid = await publicOf(inv.id, "?square=return");
    assertEquals(unpaid.status, "sent");
    assertEquals(unpaid.balanceCents, 6500);
    assertEquals((await paymentsOf(sid, inv.id)).length, 0);

    // paid on Square
    const { paymentId } = fakeSquareWorld().pay(linkId);
    const paid = await publicOf(inv.id, "?square=return");
    assertEquals(paid.status, "paid");
    assertEquals(paid.balanceCents, 0);
    const rows = await paymentsOf(sid, inv.id);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].method, rows[0].reference, rows[0].amount], [
      "card",
      paymentId,
      6500,
    ]);
    const office = await fetch(`${BASE}/invoices/${inv.id}`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(office.status, "paid");

    // the second return, and a plain reload: nothing more
    await publicOf(inv.id, "?square=return");
    await publicOf(inv.id);
    assertEquals((await paymentsOf(sid, inv.id)).length, 1);

    // and a paid invoice refuses a new checkout before Square is asked
    const after = await checkout(inv.id, { amountCents: 6500, version: 1 });
    assertEquals(after.status, 409);
    assertEquals(after.body.reason, "already_paid");
    assertEquals(fakeSquareWorld().links.size, 1);
  });
});

Deno.test("REQ-803 a customer who paid and never came back — the next plain load of the invoice records it", async () => {
  await withServer(async (sid) => {
    await connect(sid);
    const inv = await seed(sid);
    const res = await checkout(inv.id, { amountCents: 6500, version: 1 });
    const linkId = String(res.body.url).split("/").pop()!;
    fakeSquareWorld().pay(linkId);
    const pub = await publicOf(inv.id);
    assertEquals(pub.status, "paid");
    assertEquals((await paymentsOf(sid, inv.id)).length, 1);
  });
});

Deno.test("REQ-803 the return address: on the real deploy the site's own origin, never the caller's Origin header", async () => {
  await withServer(async (sid) => {
    await connect(sid);
    const inv = await seed(sid);
    const res = await checkout(
      inv.id,
      { amountCents: 6500, version: 1 },
      "https://evil.example",
    );
    // off the real deploy the caller's origin (a dev box / a test port) is used
    const linkId = String(res.body.url).split("/").pop()!;
    assertEquals(
      fakeSquareWorld().links.get(linkId)!.redirectUrl,
      `https://evil.example/i/${inv.id}?square=return`,
    );
  });
  const { squareReturnOrigin } = await import("./square-return.ts");
  assertEquals(
    squareReturnOrigin("https://evil.example", {
      get: (k: string) => (k === "DENO_DEPLOY" ? "1" : undefined),
    }),
    "https://documonster.com",
  );
  assertEquals(
    squareReturnOrigin("https://evil.example", {
      get: (k: string) =>
        k === "DENO_DEPLOY"
          ? "1"
          : k === "APP_URL"
          ? "https://staging.documonster.com/"
          : undefined,
    }),
    "https://staging.documonster.com",
  );
  assertEquals(
    squareReturnOrigin("javascript:alert(1)", { get: () => undefined }),
    "http://localhost:5280",
  );
  assertEquals(
    squareReturnOrigin(undefined, { get: () => undefined }),
    "http://localhost:5280",
  );
});

Deno.test("REQ-803 the invoice email and text name card as a way to pay once Square is connected (card first), as they do for Stripe", async () => {
  await withServer(async (sid) => {
    await (await fetch(`${BASE}/profile/identity`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        businessName: "Acme Roofing",
        acceptedPaymentMethods: {
          zelle: { enabled: true, handle: "pay@acme.test" },
        },
      }),
    })).body?.cancel();
    const me = await fetch(`${BASE}/me`, { headers: H(sid) }).then((r) =>
      r.json()
    );
    const customer = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers: H(sid),
      body: JSON.stringify({
        name: "Ana Torres",
        email: "ana@blackhole.postmarkapp.com",
        phoneNumber: "+15127771234",
      }),
    }).then((r) => r.json());
    const inv = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: H(sid),
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Roof repair",
        amount: 6500,
        issuedDate: "2026-11-01",
        dueDate: "2026-11-30",
      }),
    }).then((r) => r.json());
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
      undefined,
      undefined,
      new StripeSettingsStore(),
      new SquareSettingsStore(),
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
      undefined,
      new StripeSettingsStore(),
      new SquareSettingsStore(),
    );
    await emailer.run(me.id, { kind: "invoice", resourceId: inv.id });
    assert(
      !(sent[0].htmlBody ?? "").includes(`data-pay-way="card"`),
      "no card row before Square",
    );
    const c = await fetch(`${BASE}/me/square`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({ accessToken: "EAAAfake_acme" }),
    });
    assertEquals(c.status, 200, await c.text());
    await emailer.run(me.id, { kind: "invoice", resourceId: inv.id });
    const html = sent[1].htmlBody ?? "";
    assertStringIncludes(html, `data-pay-way="card"`);
    assert(
      html.indexOf(`data-pay-way="card"`) <
        html.indexOf(`data-pay-way="zelle"`),
      "card first",
    );
    await texter.run(me.id, { kind: "invoice", resourceId: inv.id });
    assertStringIncludes(texts[0], "Pay online by card");
  });
});
