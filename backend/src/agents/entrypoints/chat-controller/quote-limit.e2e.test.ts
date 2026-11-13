/**
 * REQ-766 (demo-loop cycle 5v2, issue m17 "Plan lists disagree with what Free allows") — the
 * verifier's situation on the booted app, over HTTP: an account picks Monster Free (POST /me/plan,
 * as the wizard does), makes its five quotes, then asks the assistant for a sixth. The chat drafts
 * nothing: no quote stored, no card; the reply says the month's five are used and Monster is
 * unlimited. The stub LLM stands in for the model's create_quote call.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMResponse } from "@agents/domain/business/llm/base/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9766;
const BASE = `http://localhost:${PORT}`;

Deno.test("REQ-766 m17 e2e: on Monster Free, the assistant's sixth quote of the month is not drafted and the reply says why", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const original = StubLLMClient.prototype.respond;
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const phone = "+15125550767";
    await (await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    })).body?.cancel();
    const stored = await new OtpStore().get(phone);
    const v = await fetch(`${BASE}/auth/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
    }).then((r) => r.json());
    const userId: string = v.userId;
    await new UserStore().update(userId, {
      name: "Linda Ruiz",
      email: "linda@test.dev",
      language: "en",
    });
    await new BusinessIdentityStore().upsert(userId, {
      businessName: "Ruiz Cleaning",
      acceptedPaymentMethods: { check: { enabled: true } },
    });
    await new BusinessAddressStore().upsert(userId, {
      city: "Austin",
      state: "TX",
      postal: "78704",
    });
    const auth = {
      "content-type": "application/json",
      "x-session-id": v.sessionId,
    };

    const pick = await fetch(`${BASE}/me/plan`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ planId: "free" }),
    });
    assertEquals(pick.status, 200, await pick.text());
    for (let n = 1; n <= 5; n++) {
      const res = await fetch(`${BASE}/quotes`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          summary: `House clean ${n}`,
          lineItems: [{
            description: "Deep clean",
            quantity: 1,
            unit: "ea",
            price: 30_000,
          }],
        }),
      });
      assertEquals(res.status, 200, `quote ${n}`);
      await res.body?.cancel();
    }

    StubLLMClient.prototype.respond = (): Promise<LLMResponse> =>
      Promise.resolve({
        text: "Here's your quote.",
        action: {
          type: "create_quote",
          payload: {
            summary: "Move-out deep clean",
            lineItems: [{
              description: "Move-out deep clean, 3 bed 2 bath",
              amountCents: 45_000,
            }],
          },
        },
      });
    const res = await fetch(`${BASE}/agents/chat`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ content: "quote a move-out deep clean, $450" }),
    });
    assert(res.ok, `POST /agents/chat → ${res.status}`);
    const turn = await res.json() as {
      newMessages: { role: string; kind: string; content: string }[];
    };

    assertEquals(
      (await new QuoteStore().listByUser(userId)).length,
      5,
      "no sixth quote is stored",
    );
    assertEquals(
      turn.newMessages.filter((m) => m.kind === "action_card").length,
      0,
      "no draft card",
    );
    const reply = turn.newMessages.filter((m) =>
      m.role === "assistant" && m.kind === "text"
    ).map((m) => m.content).join("\n");
    assertEquals(reply, t("en", "chatCoordinator.quoteLimit", { limit: 5 }));
  } finally {
    StubLLMClient.prototype.respond = original;
    await server.stop();
    await resetKv();
  }
});
