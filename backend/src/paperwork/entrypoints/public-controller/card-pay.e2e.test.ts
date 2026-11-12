/**
 * REQ-213 — the public invoice's card charge, on the fake Stripe: the config is off until the
 * business connects; a succeeded charge pays the invoice through the same path as the
 * contractor's confirmation (one Payment row, method card, the intent id as reference), and the
 * same intent twice records one payment; a declined card is 402; a stale balance is 409; a
 * 3-D Secure card is completed by re-reading the intent on the business's key.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  fakeStripeWorld,
  StripeGateway,
} from "@core/data/stripe-gateway/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9492;
const J = { "content-type": "application/json" };

async function login(port: number, phone = "+15125552130"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

async function withServer(fn: (port: number, sid: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("DENO_DEPLOY");
  Deno.env.delete("DENO_DEPLOYMENT_ID");
  await resetKv();
  fakeStripeWorld().reset();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT, await login(PORT));
  } finally {
    await server.stop();
    await resetKv();
  }
}

const H = (sid: string) => ({ ...J, "x-session-id": sid });

async function seed(port: number, sid: string, amount = 6500) {
  const customer = await fetch(`http://localhost:${port}/customers`, {
    method: "POST",
    headers: H(sid),
    body: JSON.stringify({
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    }),
  }).then((r) => r.json());
  const inv = await fetch(`http://localhost:${port}/invoices`, {
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
  return inv;
}

async function connect(port: number, sid: string) {
  await (await fetch(`http://localhost:${port}/profile/identity`, {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify({ businessName: "Acme Roofing" }),
  })).body?.cancel();
  const r = await fetch(`http://localhost:${port}/me/stripe`, {
    method: "PUT",
    headers: H(sid),
    body: JSON.stringify({
      publishableKey: "pk_test_fake_acme",
      secretKey: "sk_test_fake_acme",
    }),
  });
  const text = await r.text();
  assertEquals(r.status, 200, text);
}

async function tokenize(number: string, cvc = "123") {
  const f = new URLSearchParams({
    type: "card",
    "card[number]": number,
    "card[exp_month]": "12",
    "card[exp_year]": "2034",
    "card[cvc]": cvc,
    "billing_details[name]": "Ana Torres",
  });
  return (await new StripeGateway().createPaymentMethod("pk_test_fake_acme", f))
    .id;
}

Deno.test("REQ-213 GET /invoices/:id/card — off until the business connects; then the merchant, the key, the fake's api base and the balance", async () => {
  await withServer(async (port, sid) => {
    const inv = await seed(port, sid);
    const off = await fetch(`http://localhost:${port}/invoices/${inv.id}/card`)
      .then((r) => r.json());
    assertEquals(off, { available: false });
    await connect(port, sid);
    const on = await fetch(`http://localhost:${port}/invoices/${inv.id}/card`)
      .then((r) => r.json());
    assertEquals(on.available, true);
    assertEquals([
      on.publishableKey,
      on.mode,
      on.fake,
      on.apiBase,
      on.merchantName,
      on.logoUrl,
      on.amountCents,
      on.currency,
    ], [
      "pk_test_fake_acme",
      "test",
      true,
      "/api/dev/stripe",
      "Acme Roofing",
      null,
      6500,
      "usd",
    ]);
    assertEquals(typeof on.version, "number");
    assertEquals(
      JSON.stringify(on).includes("sk_test"),
      false,
      "no secret on the public surface",
    );
    // the manual card chip is gone while Stripe is on
    const pub = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/public`,
    ).then((r) => r.json());
    assertEquals(
      (pub.acceptedMethods as Array<{ method: string }>).some((m) =>
        m.method === "card"
      ),
      false,
    );
  });
});

Deno.test("REQ-213 POST /invoices/:id/card — a succeeded charge pays the invoice: one Payment row, method card, the intent as reference; the same intent again records nothing new", async () => {
  await withServer(async (port, sid) => {
    await connect(port, sid);
    const inv = await seed(port, sid);
    const pm = await tokenize("4242424242424242");
    const res = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          paymentMethodId: pm,
          amountCents: 6500,
          version: 1,
        }),
      },
    );
    const body = await res.json();
    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals([body.ok, body.status, body.balanceCents], [
      true,
      "succeeded",
      0,
    ]);
    assert(String(body.paymentIntentId).startsWith("pi_fake_"));
    const intent = fakeStripeWorld().intents.get(body.paymentIntentId)!;
    assertEquals([intent.amount, intent.metadata.invoiceId, intent.account], [
      6500,
      inv.id,
      "acct_fake_acme",
    ], "charged on the business's own account");

    const after = await fetch(`http://localhost:${port}/invoices/${inv.id}`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(after.status, "paid");
    assertEquals(after.paidCents, 6500);
    const payments = await fetch(`http://localhost:${port}/payments`, {
      headers: H(sid),
    }).then((r) => r.json());
    const rows = (payments as Array<
      {
        invoiceId: string;
        method: string;
        reference?: string;
        amount: number;
      }
    >).filter((p) => p.invoiceId === inv.id);
    assertEquals(rows.length, 1);
    assertEquals([rows[0].method, rows[0].reference, rows[0].amount], [
      "card",
      body.paymentIntentId,
      6500,
    ]);

    // the completion path with the same intent: nothing doubles
    const again = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card/complete`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({ paymentIntentId: body.paymentIntentId }),
      },
    ).then((r) => r.json());
    assertEquals([again.ok, again.status], [true, "succeeded"]);
    const rows2 =
      (await fetch(`http://localhost:${port}/payments`, { headers: H(sid) })
        .then((r) => r.json()) as Array<{ invoiceId: string }>).filter((p) =>
          p.invoiceId === inv.id
        );
    assertEquals(rows2.length, 1);
    // and a second charge on a paid invoice is refused before Stripe is asked
    const paid = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          paymentMethodId: await tokenize("4242424242424242"),
          amountCents: 6500,
        }),
      },
    );
    assertEquals(paid.status, 409);
    assertEquals((await paid.json()).reason, "already_paid");
    assertEquals(fakeStripeWorld().intents.size, 1);
  });
});

Deno.test("REQ-213 POST /invoices/:id/card — declined is 402 with Stripe's words and the invoice stays open; a stale balance is 409 with the current one; no Stripe is 404", async () => {
  await withServer(async (port, sid) => {
    const before = await seed(port, sid);
    const none = await fetch(
      `http://localhost:${port}/invoices/${before.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({ paymentMethodId: "pm_x", amountCents: 6500 }),
      },
    );
    assertEquals(none.status, 404);
    assertEquals((await none.json()).reason, "card_unavailable");

    await connect(port, sid);
    const inv = await seed(port, sid);
    const declined = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          paymentMethodId: await tokenize("4000000000000002"),
          amountCents: 6500,
        }),
      },
    );
    assertEquals(declined.status, 402);
    assertEquals(await declined.json(), {
      ok: false,
      reason: "declined",
      message: "Your card was declined.",
    });
    const still = await fetch(`http://localhost:${port}/invoices/${inv.id}`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(still.status, "sent");

    const stale = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          paymentMethodId: await tokenize("4242424242424242"),
          amountCents: 100,
        }),
      },
    );
    assertEquals(stale.status, 409);
    const sb = await stale.json();
    assertEquals([sb.reason, sb.balanceCents], ["stale_balance", 6500]);
    assertEquals(
      fakeStripeWorld().intents.size,
      0,
      "neither the declined nor the stale request left an intent behind",
    );
  });
});

Deno.test("REQ-213 POST /invoices/:id/card — 3-D Secure: requires_action with the client secret, then /complete re-reads the intent on the business's key and pays", async () => {
  await withServer(async (port, sid) => {
    await connect(port, sid);
    const inv = await seed(port, sid);
    const res = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({
          paymentMethodId: await tokenize("4000002500003155"),
          amountCents: 6500,
        }),
      },
    );
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals([body.ok, body.status, body.clientSecret], [
      false,
      "requires_action",
      `${body.paymentIntentId}_secret_fake`,
    ]);
    // not settled yet: completing now is not a payment
    const early = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card/complete`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({ paymentIntentId: body.paymentIntentId }),
      },
    ).then((r) => r.json());
    assertEquals([early.ok, early.status], [false, "requires_action"]);
    fakeStripeWorld().settle(body.paymentIntentId);
    const done = await fetch(
      `http://localhost:${port}/invoices/${inv.id}/card/complete`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({ paymentIntentId: body.paymentIntentId }),
      },
    ).then((r) => r.json());
    assertEquals([done.ok, done.status, done.balanceCents], [
      true,
      "succeeded",
      0,
    ]);
    const after = await fetch(`http://localhost:${port}/invoices/${inv.id}`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(after.status, "paid");
    // an intent that is not this invoice's is refused
    const other = await seed(port, sid);
    const wrong = await fetch(
      `http://localhost:${port}/invoices/${other.id}/card/complete`,
      {
        method: "POST",
        headers: J,
        body: JSON.stringify({ paymentIntentId: body.paymentIntentId }),
      },
    );
    assertEquals(wrong.status, 409);
  });
});
