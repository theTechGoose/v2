import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-766 (demo-loop cycle 5v2, issue m17): the verifier's situation over real HTTP. An account
// picks Monster Free (POST /me/plan, as the wizard does) and creates quotes: the first five of the
// month are made; the sixth is refused with 402 quote_limit and is not stored. A Monster pick
// lifts the cap.

@Module({ imports: [UsersModule, CrmModule, PaperworkModule] })
class TestApp {}

const PORT = 9047;
const base = `http://localhost:${PORT}`;

async function login(
  phone: string,
): Promise<{ sessionId: string; userId: string }> {
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
  return { sessionId: v.sessionId, userId: v.userId };
}

Deno.test("REQ-766 m17 e2e: a Monster Free account's sixth POST /quotes this month is 402 quote_limit and stores nothing", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sessionId: sid, userId } = await login("+15125550766");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const pick = await fetch(`${base}/me/plan`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ planId: "free" }),
    });
    assertEquals(pick.status, 200, await pick.text());
    const body = (n: number) =>
      JSON.stringify({
        summary: `House clean ${n}`,
        lineItems: [{
          description: "Deep clean",
          quantity: 1,
          unit: "ea",
          price: 30_000,
        }],
      });
    for (let n = 1; n <= 5; n++) {
      const res = await fetch(`${base}/quotes`, {
        method: "POST",
        headers: auth,
        body: body(n),
      });
      assertEquals(res.status, 200, `quote ${n}: ${await res.text()}`);
    }
    const sixth = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: auth,
      body: body(6),
    });
    assertEquals(sixth.status, 402);
    assertEquals(await sixth.json(), {
      ok: false,
      reason: "quote_limit",
      limit: 5,
      used: 5,
    });
    assertEquals(
      (await new QuoteStore().listByUser(userId)).length,
      5,
      "the sixth is not stored",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-778 (demo-loop cycle dv1, issue d8): Raphael — "The free plan limit is five quotes." /quotes
// says so before New quote is tapped: GET /quotes/allowance is the same QuoteAllowance answer.
Deno.test("REQ-778 dv1 d8 e2e: GET /quotes/allowance is ok under the cap and quote_limit at five on Monster Free", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const { sessionId: sid } = await login("+15125550778");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const allowance = async () => {
      const res = await fetch(`${base}/quotes/allowance`, { headers: auth });
      assertEquals(res.status, 200);
      return await res.json();
    };
    await (await fetch(`${base}/me/plan`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ planId: "free" }),
    })).body?.cancel();
    assertEquals(await allowance(), { ok: true });
    for (let n = 1; n <= 5; n++) {
      await (await fetch(`${base}/quotes`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          summary: `Lawn ${n}`,
          lineItems: [{
            description: "Mow",
            quantity: 1,
            unit: "ea",
            price: 8_000,
          }],
        }),
      })).body?.cancel();
    }
    assertEquals(await allowance(), {
      ok: false,
      reason: "quote_limit",
      limit: 5,
      used: 5,
    });
    const anon = await fetch(`${base}/quotes/allowance`);
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
  } finally {
    await server.stop();
    await resetKv();
  }
});
