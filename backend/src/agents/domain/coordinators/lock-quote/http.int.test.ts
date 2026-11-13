/**
 * REQ-710 (demo-loop cycle 5, M4) over the booted app — pair 6's path: an
 * English-app contractor types the quote in Spanish, clicks "Lock it in"
 * (POST /agents/conversations/:id/lock-quote), previews the send in English
 * (GET /quotes/:id/send-preview?lang=en) and the customer opens the English
 * document (GET /quotes/:id/public, what /q?lang=en renders). Before, all
 * three kept the Spanish: "Quote Q-001 from Ortega Handyman Services —
 * Reparación de puerta", "Carmen Núñez's Reparación de puerta Agreement",
 * "Reparación de puerta de cocina $175.00".
 *
 * The app's LLM is the StubLLMClient its injector builds; the test scripts its
 * prototype (deno test runs each file in its own worker).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { localizeLineItems } from "#quote-flow/quote-translations.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

const SUMMARY =
  "Reparación de puerta de cocina y cambio de llave del fregadero";
const EN_OF: Record<string, string> = {
  "Reparación de puerta": "door repair",
  [SUMMARY]: "Kitchen door repair and sink faucet replacement",
  "Reparación de puerta de cocina": "Kitchen door repair",
  "Cambio de llave del fregadero": "Kitchen sink faucet replacement",
};

async function login(phone: string): Promise<string> {
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
  return v.sessionId;
}

Deno.test("REQ-710 (cycle 5, M4) pair 6 over HTTP: a Spanish quote locked from an English app reads English in the send preview and on the customer's English page", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const original = StubLLMClient.prototype.respond;
  const asked: string[] = [];
  StubLLMClient.prototype.respond = (req: LLMRequest) => {
    asked.push(req.systemPrompt ?? "");
    if (
      !/You translate construction scope-of-work/.test(req.systemPrompt ?? "")
    ) {
      return Promise.resolve({ text: "" });
    }
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /bullet lines into English/.test(req.systemPrompt ?? "");
    return Promise.resolve({
      text: JSON.stringify({
        texts: texts.map((t) => toEn ? (EN_OF[t] ?? t) : `${t} (es)`),
      }),
    });
  };
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125554710");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${BASE}${path}`, {
        method,
        headers: auth,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await r.json();
      if (!r.ok) {
        throw new Error(
          `${method} ${path} → ${r.status} ${JSON.stringify(json)}`,
        );
      }
      return json;
    };
    // Pair 6: the app is in English.
    await call("PUT", "/me", { language: "en", name: "Luis Ortega" });
    const quote = await call("POST", "/quotes", {
      summary: SUMMARY,
      jobName: "Reparación de puerta",
      lineItems: [
        {
          description: "Reparación de puerta de cocina",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
        {
          description: "Cambio de llave del fregadero",
          quantity: 1,
          unit: "ea",
          price: 17_500,
        },
      ],
      estimatedTotal: 35_000,
    });
    const conv = await call("POST", "/agents/conversations", {
      quoteId: quote.id,
    });
    await call("POST", `/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });

    // The send dialog's English preview.
    const preview = await call(
      "GET",
      `/quotes/${quote.id}/send-preview?channel=email&lang=en`,
    );
    assert(preview.email, JSON.stringify(preview));
    assert(
      preview.email.subject.includes("Door Repair"),
      `English subject: ${preview.email.subject}`,
    );
    assert(
      !/Reparaci[oó]n/i.test(preview.email.subject),
      `Spanish in the English subject: ${preview.email.subject}`,
    );

    // What /q?lang=en renders.
    const pub = await fetch(`${BASE}/quotes/${quote.id}/public`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(pub.lang, "es");
    assertEquals(pub.jobNameByLang?.en, "Door Repair");
    assertEquals(
      localizeLineItems(pub.lineItems, "en", pub.lang).map((li) =>
        li.description
      ),
      ["Kitchen door repair", "Kitchen sink faucet replacement"],
    );
    assertEquals(
      localizeLineItems(pub.lineItems, "es", pub.lang).map((li) =>
        li.description
      ),
      ["Reparación de puerta de cocina", "Cambio de llave del fregadero"],
    );
    assert(
      asked.every((p) =>
        !/bullet lines into neutral Latin-American Spanish/.test(p)
      ),
      "the typed Spanish was sent to the model to be made Spanish",
    );
  } finally {
    StubLLMClient.prototype.respond = original;
    await server.stop();
    await resetKv();
  }
});
