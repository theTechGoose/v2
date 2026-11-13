/**
 * REQ-782 (demo-loop dv1, issue d10) — Raphael: "Card payments should be a link to a separate
 * portal." Through the booted app: Settings stores the business's card pay link on the card
 * method (https only — http / javascript: / host-less are 400 and nothing is stored), and the
 * public invoice projects it on the card row, where /i/:id turns it into "Pay by card".
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fakeStripeWorld } from "@core/data/stripe-gateway/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9782;
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

const LINK = "https://buy.stripe.com/test_acme";

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

Deno.test("REQ-782 PUT /profile/identity: the card pay link is https only — http, javascript: and host-less are 400 and nothing is stored; a good one is stored", async () => {
  await withServer(async (sid) => {
    const first = await putIdentity(sid, {
      businessName: "Acme Roofing",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme.test" },
      },
    });
    assertEquals(first.status, 200, await first.text());
    for (
      const [bad, code] of [
        ["http://buy.stripe.com/test_acme", "card_url_not_https"],
        ["javascript:alert(1)", "card_url_invalid"],
        ["buy.stripe.com/test_acme", "card_url_invalid"],
      ]
    ) {
      const r = await putIdentity(sid, {
        acceptedPaymentMethods: { card: { enabled: true, url: bad } },
      });
      const body = await r.json();
      assertEquals(r.status, 400, `${bad} → ${JSON.stringify(body)}`);
      assertEquals(body.error, code);
    }
    const mid = await fetch(url("/profile/identity"), { headers: H(sid) })
      .then((r) => r.json());
    assertEquals(mid.acceptedPaymentMethods.card, undefined, "nothing stored");

    const ok = await putIdentity(sid, {
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme.test" },
        card: { enabled: true, instructions: "", url: ` ${LINK} ` },
      },
    });
    assertEquals(ok.status, 200);
    const saved = await ok.json();
    assertEquals(saved.acceptedPaymentMethods.card.url, LINK);
    assertEquals(saved.acceptedPaymentMethods.zelle.handle, "pay@acme.test");
  });
});

Deno.test("REQ-782 GET /invoices/:id/public: the card row carries the business's card pay link", async () => {
  await withServer(async (sid) => {
    const put = await putIdentity(sid, {
      businessName: "Acme Roofing",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme.test" },
        card: {
          enabled: true,
          instructions: "Visa, Mastercard, Amex",
          url: LINK,
        },
      },
    });
    assertEquals(put.status, 200, await put.text());
    const inv = await seedInvoice(sid);
    const pub = await fetch(url(`/invoices/${inv.id}/public`)).then((r) =>
      r.json()
    );
    assertEquals(pub.acceptedMethods, [
      { method: "zelle", handle: "pay@acme.test" },
      { method: "card", handle: "Visa, Mastercard, Amex", url: LINK },
    ]);
  });
});
