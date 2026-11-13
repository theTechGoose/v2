/**
 * REQ-212 — /me/stripe: connect with a key pair (checked against Stripe, the fake here), read
 * the connection back with no secret in it, refuse a mismatched pair and a rejected key, forget.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fakeStripeWorld } from "@core/data/stripe-gateway/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9491;

async function login(port: number, phone = "+15125552120"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

const H = (sid: string) => ({
  "content-type": "application/json",
  "x-session-id": sid,
});

Deno.test("REQ-212 /me/stripe — not connected, then connected with the fake pair: the status names the account, the mode and the masked secret, never the secret", async () => {
  await withServer(async (port, sid) => {
    const before = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(before.connected, false);
    assertEquals(typeof before.merchant, "object");

    const res = await fetch(`http://localhost:${port}/me/stripe`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        publishableKey: "pk_test_fake_acme",
        secretKey: "sk_test_fake_acme",
      }),
    });
    const text = await res.text();
    assertEquals(res.status, 200, text);
    assertEquals(
      text.includes("sk_test_fake_acme"),
      false,
      "the secret never comes back",
    );
    const s = JSON.parse(text);
    assertEquals([
      s.connected,
      s.mode,
      s.fake,
      s.publishableKey,
      s.secretMasked,
      s.accountId,
      s.accountName,
    ], [
      true,
      "test",
      true,
      "pk_test_fake_acme",
      "sk_test_••••acme",
      "acct_fake_acme",
      "Acme (fake Stripe account)",
    ]);
    assertEquals(typeof s.connectedAt, "string");

    const read = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(read.accountName, "Acme (fake Stripe account)");
    assertEquals(read.connected, true);
  });
});

Deno.test("REQ-212 /me/stripe — the merchant preview is the business name and whether it has a logo", async () => {
  await withServer(async (port, sid) => {
    await (await fetch(`http://localhost:${port}/profile/identity`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({ businessName: "Acme Roofing" }),
    })).body?.cancel();
    const s = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(s.merchant, { name: "Acme Roofing", hasLogo: false });
  });
});

Deno.test("REQ-212 /me/stripe — a mismatched pair is 422 mode_mismatch; a key Stripe rejects is 422 stripe_rejected; nothing is stored", async () => {
  await withServer(async (port, sid) => {
    const mm = await fetch(`http://localhost:${port}/me/stripe`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        publishableKey: "pk_live_x",
        secretKey: "sk_test_fake_acme",
      }),
    });
    assertEquals(mm.status, 422);
    assertEquals((await mm.json()).error, "mode_mismatch");
    const bad = await fetch(`http://localhost:${port}/me/stripe`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        publishableKey: "pk_test_fake_bad",
        secretKey: "sk_test_fake_bad",
      }),
    });
    assertEquals(bad.status, 422);
    const body = await bad.json();
    assertEquals(body.error, "stripe_rejected");
    assert(
      typeof body.message === "string" && body.message.length > 0,
      "Stripe's words ride along",
    );
    const s = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(s.connected, false);
  });
});

Deno.test("REQ-212 /me/stripe — DELETE forgets the keys; no session is 401", async () => {
  await withServer(async (port, sid) => {
    await (await fetch(`http://localhost:${port}/me/stripe`, {
      method: "PUT",
      headers: H(sid),
      body: JSON.stringify({
        publishableKey: "pk_test_fake_acme",
        secretKey: "sk_test_fake_acme",
      }),
    })).body?.cancel();
    const gone = await fetch(`http://localhost:${port}/me/stripe`, {
      method: "DELETE",
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(gone.connected, false);
    const s = await fetch(`http://localhost:${port}/me/stripe`, {
      headers: H(sid),
    }).then((r) => r.json());
    assertEquals(s.connected, false);
    const anon = await fetch(`http://localhost:${port}/me/stripe`);
    await anon.body?.cancel();
    assertEquals(anon.status, 401);
  });
});

Deno.test("REQ-212 /dev/stripe — the fake tokenizes for a fake publishable key off the real deploy, in Stripe's shape", async () => {
  await withServer(async (port) => {
    const f = new URLSearchParams({
      type: "card",
      "card[number]": "4242424242424242",
      "card[exp_month]": "12",
      "card[exp_year]": "2034",
      "card[cvc]": "123",
      "billing_details[name]": "Ana",
    });
    const res = await fetch(
      `http://localhost:${port}/dev/stripe/v1/payment_methods`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: "Bearer pk_test_fake_acme",
        },
        body: f.toString(),
      },
    );
    const pm = await res.json();
    assertEquals(res.status, 200);
    assertEquals(pm.object, "payment_method");
    assertEquals([pm.card.brand, pm.card.last4], ["visa", "4242"]);
    const bad = await fetch(
      `http://localhost:${port}/dev/stripe/v1/payment_methods`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: "Bearer pk_test_fake_acme",
        },
        body: new URLSearchParams({
          type: "card",
          "card[number]": "4242424242424241",
          "card[exp_month]": "12",
          "card[exp_year]": "2034",
          "card[cvc]": "123",
        }).toString(),
      },
    );
    assertEquals(bad.status, 402);
    assertEquals((await bad.json()).error.code, "incorrect_number");
  });
});

Deno.test("REQ-804 /dev/stripe — on the real deploy the route is 404 unless STRIPE_DEMO_FAKE=1, then the fake tokenizes", async () => {
  const before = {
    DENO_DEPLOY: Deno.env.get("DENO_DEPLOY"),
    STRIPE_DEMO_FAKE: Deno.env.get("STRIPE_DEMO_FAKE"),
  };
  const form = new URLSearchParams({
    type: "card",
    "card[number]": "4242424242424242",
    "card[exp_month]": "12",
    "card[exp_year]": "2034",
    "card[cvc]": "123",
  }).toString();
  const post = (port: number) =>
    fetch(`http://localhost:${port}/dev/stripe/v1/payment_methods`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Bearer pk_test_fake_acme",
      },
      body: form,
    });
  try {
    await withServer(async (port) => {
      Deno.env.set("DENO_DEPLOY", "1");
      Deno.env.delete("STRIPE_DEMO_FAKE");
      const off = await post(port);
      await off.body?.cancel();
      assertEquals(off.status, 404);
      Deno.env.set("STRIPE_DEMO_FAKE", "1");
      const on = await post(port);
      const pm = await on.json();
      assertEquals(on.status, 200);
      assertEquals([pm.object, pm.card.last4], ["payment_method", "4242"]);
    });
  } finally {
    for (const [k, v] of Object.entries(before)) {
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  }
});
