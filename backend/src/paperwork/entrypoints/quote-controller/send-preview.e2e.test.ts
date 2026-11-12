/**
 * REQ-461 — demo-loop cycle 3, issue m8: GET /quotes/:id/send-preview
 * renders what the client gets (email subject + body, text) in the picked
 * language, over HTTP, without sending.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 9461;
const base = `http://localhost:${PORT}`;

async function login(phone = "+15125554610"): Promise<{ sid: string }> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return { sid: v.sessionId };
}

Deno.test("REQ-461 (m8) GET /quotes/:id/send-preview renders the email and the text in the picked language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sid } = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const me = await new UserStore().findByPhone("+15125554610");
    await new UserStore().update(me!.id, { name: "Rosa Diaz" });
    const customer = await fetch(`${base}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Juan Perez",
        email: "juan@example.com",
        phoneNumber: "+15125551234",
      }),
    }).then((r) => r.json());
    const quote = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "Paint",
        jobName: "Bathroom paint",
        lineItems: [{
          description: "Paint",
          quantity: 1,
          unit: "ea",
          price: 50000,
        }],
        estimatedTotal: 50000,
      }),
    }).then((r) => r.json());

    const res = await fetch(
      `${base}/quotes/${quote.id}/send-preview?channel=both&lang=es`,
      { headers: auth },
    );
    assertEquals(res.status, 200);
    const p = await res.json();
    assertEquals(p.lang, "es");
    assert(p.email.subject.startsWith("Cotización"), p.email.subject);
    assertStringIncludes(p.email.html, "<html");
    assertStringIncludes(p.sms.body, "?lang=es");

    const sms = await fetch(
      `${base}/quotes/${quote.id}/send-preview?channel=sms&lang=en`,
      { headers: auth },
    )
      .then((r) => r.json());
    assertEquals(sms.lang, "en");
    assertEquals(sms.email, undefined);
    assertStringIncludes(sms.sms.body, "?lang=en");

    // Nothing went out: the quote is still a draft with no delivery.
    const after = await fetch(`${base}/quotes/${quote.id}`, { headers: auth })
      .then((r) => r.json());
    assertEquals(after.status ?? "draft", "draft");
    assertEquals(after.sentAt, undefined);
    assertEquals(after.lastDelivery, undefined);

    const anon = await fetch(
      `${base}/quotes/${quote.id}/send-preview?channel=both&lang=en`,
    );
    await anon.body?.cancel();
    assert(
      anon.status === 401 || anon.status === 403,
      `anon status ${anon.status}`,
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
