/**
 * REQ-212/213 — the Stripe gateway's in-process fake: the account, the payment method, the
 * intent (succeeds, declines, needs 3-D Secure), idempotency, and the real-deploy refusal.
 */
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { fakeStripeWorld, StripeError, StripeGateway } from "./mod.ts";

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const before = Object.fromEntries(
    Object.keys(vars).map((k) => [k, Deno.env.get(k)]),
  );
  for (const [k, v] of Object.entries(vars)) {
    v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(before)) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  });
}
const OFF = { DENO_DEPLOY: undefined, DENO_DEPLOYMENT_ID: undefined };

function cardForm(number: string, cvc = "123") {
  const f = new URLSearchParams();
  f.set("type", "card");
  f.set("card[number]", number);
  f.set("card[exp_month]", "12");
  f.set("card[exp_year]", "2034");
  f.set("card[cvc]", cvc);
  f.set("billing_details[name]", "Ana Torres");
  return f;
}

Deno.test("REQ-212 stripe-gateway fake — the account is named after the key; a bad key is 401", () =>
  withEnv(OFF, async () => {
    fakeStripeWorld().reset();
    const gw = new StripeGateway();
    assertEquals(gw.isFake("sk_test_fake_acme"), true);
    assertEquals(gw.isFake("sk_test_51real"), false);
    assertEquals(await gw.account("sk_test_fake_acme"), {
      id: "acct_fake_acme",
      name: "Acme (fake Stripe account)",
      mode: "test",
    });
    const e = await assertRejects(
      () => gw.account("sk_test_fake_bad"),
      StripeError,
    );
    assertEquals([e.status, e.code], [401, "invalid_api_key"]);
  }));

Deno.test("REQ-212 stripe-gateway — on the real deploy a fake key is refused before any call", () =>
  withEnv({ DENO_DEPLOY: "1" }, async () => {
    const gw = new StripeGateway();
    assertEquals(gw.isFake("sk_test_fake_acme"), false);
    const e = await assertRejects(
      () => gw.account("sk_test_fake_acme"),
      StripeError,
    );
    assertEquals([e.status, e.code], [400, "fake_key_refused"]);
  }));

Deno.test("REQ-213 stripe-gateway fake — a payment method from the publishable key: brand and last4; a bad number is 402", () =>
  withEnv(OFF, async () => {
    fakeStripeWorld().reset();
    const gw = new StripeGateway();
    const pm = await gw.createPaymentMethod(
      "pk_test_fake_acme",
      cardForm("4242424242424242"),
    );
    assertStringIncludes(pm.id, "pm_fake_");
    assertEquals([pm.brand, pm.last4], ["visa", "4242"]);
    const amex = await gw.createPaymentMethod(
      "pk_test_fake_acme",
      cardForm("378282246310005", "1234"),
    );
    assertEquals([amex.brand, amex.last4], ["amex", "0005"]);
    const e = await assertRejects(
      () =>
        gw.createPaymentMethod(
          "pk_test_fake_acme",
          cardForm("4242424242424241"),
        ),
      StripeError,
    );
    assertEquals([e.status, e.code], [402, "incorrect_number"]);
    const bad = await assertRejects(
      () =>
        gw.createPaymentMethod("pk_test_51real", cardForm("4242424242424242")),
      StripeError,
    );
    assertEquals(
      bad.code,
      "fake_only",
      "the fake never tokenizes for a real key",
    );
  }));

Deno.test("REQ-213 stripe-gateway fake — the intent succeeds, carries the amount and the metadata, and reads back; the same idempotency key is the same intent", () =>
  withEnv(OFF, async () => {
    fakeStripeWorld().reset();
    const gw = new StripeGateway();
    const pm = await gw.createPaymentMethod(
      "pk_test_fake_acme",
      cardForm("4242424242424242"),
    );
    const input = {
      amountCents: 6500,
      currency: "usd",
      paymentMethodId: pm.id,
      description: "INV-001 · Acme",
      metadata: { invoiceId: "inv-1", userId: "u-1" },
      idempotencyKey: "inv-1:1:" + pm.id,
    };
    const pi = await gw.createPaymentIntent("sk_test_fake_acme", input);
    assertStringIncludes(pi.id, "pi_fake_");
    assertEquals([
      pi.status,
      pi.amount,
      pi.currency,
      pi.metadata.invoiceId,
      pi.brand,
      pi.last4,
    ], ["succeeded", 6500, "usd", "inv-1", "visa", "4242"]);
    const again = await gw.createPaymentIntent("sk_test_fake_acme", input);
    assertEquals(again.id, pi.id);
    const read = await gw.retrievePaymentIntent("sk_test_fake_acme", pi.id);
    assertEquals(read.status, "succeeded");
    assertEquals(fakeStripeWorld().intents.size, 1);
  }));

Deno.test("REQ-213 stripe-gateway fake — 4000 0000 0000 0002 declines with Stripe's words; a method from another account is missing", () =>
  withEnv(OFF, async () => {
    fakeStripeWorld().reset();
    const gw = new StripeGateway();
    const pm = await gw.createPaymentMethod(
      "pk_test_fake_acme",
      cardForm("4000000000000002"),
    );
    const e = await assertRejects(
      () =>
        gw.createPaymentIntent("sk_test_fake_acme", {
          amountCents: 100,
          currency: "usd",
          paymentMethodId: pm.id,
          description: "",
          metadata: {},
          idempotencyKey: "k1",
        }),
      StripeError,
    );
    assertEquals([e.status, e.code, e.declineCode, e.message], [
      402,
      "card_declined",
      "generic_decline",
      "Your card was declined.",
    ]);
    const other = await assertRejects(
      () =>
        gw.createPaymentIntent("sk_test_fake_other", {
          amountCents: 100,
          currency: "usd",
          paymentMethodId: pm.id,
          description: "",
          metadata: {},
          idempotencyKey: "k2",
        }),
      StripeError,
    );
    assertEquals([other.status, other.code], [400, "resource_missing"]);
  }));

Deno.test("REQ-213 stripe-gateway fake — 4000 0025 0000 3155 needs 3-D Secure: requires_action with a client secret; settled, it reads succeeded", () =>
  withEnv(OFF, async () => {
    fakeStripeWorld().reset();
    const gw = new StripeGateway();
    const pm = await gw.createPaymentMethod(
      "pk_test_fake_acme",
      cardForm("4000002500003155"),
    );
    const pi = await gw.createPaymentIntent("sk_test_fake_acme", {
      amountCents: 100,
      currency: "usd",
      paymentMethodId: pm.id,
      description: "",
      metadata: {},
      idempotencyKey: "k3",
    });
    assertEquals(pi.status, "requires_action");
    assertEquals(pi.clientSecret, `${pi.id}_secret_fake`);
    fakeStripeWorld().settle(pi.id);
    assertEquals(
      (await gw.retrievePaymentIntent("sk_test_fake_acme", pi.id)).status,
      "succeeded",
    );
  }));
