/**
 * REQ-710 (demo-loop cycle 5, M4) over the booted app: pair 9 issued INV-002
 * from "Nueva factura" (POST /invoices, no quote) with the line "Retiro de
 * refrigerador y lavadora"; on /i?lang=en the title was English but the line
 * stayed Spanish. The customer's page data — GET /invoices/:id/public — now
 * carries each standalone line's English text, which /i renders through
 * localizeLineItems.
 *
 * The app's LLM is the StubLLMClient its injector builds; the test scripts its
 * prototype (deno test runs each file in its own worker).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
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

const EN: Record<string, string> = {
  "Retiro de electrodomésticos": "appliance removal",
  "Retiro de refrigerador y lavadora":
    "Removal of refrigerator and washing machine",
  "Retiro de estufa": "Stove removal",
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

Deno.test("REQ-710 (cycle 5, M4) a standalone invoice's Spanish line reaches the public page with its English text (pair 9), and a line edited through PUT is translated afresh", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const original = StubLLMClient.prototype.respond;
  StubLLMClient.prototype.respond = (req: LLMRequest) => {
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    return Promise.resolve({
      text: JSON.stringify({ texts: texts.map((t) => EN[t] ?? t) }),
    });
  };
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125554971");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await (await fetch(`${BASE}/me`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    const inv = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        jobName: "Retiro de electrodomésticos",
        lineItems: [{
          description: "Retiro de refrigerador y lavadora",
          quantity: 1,
          unit: "job",
          price: 20_000,
        }],
        amount: 20_000,
        dueDate: "2026-12-30",
        status: "sent",
        billTo: { name: "Jorge Ruiz", email: "jorge.ruiz@example.com" },
        paymentInstructions: "Zelle: +1 (512) 555-0108 · Efectivo",
      }),
    }).then((r) => r.json());
    const pub = await fetch(`${BASE}/invoices/${inv.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pub.jobDetails.jobNameByLang?.en, "Appliance Removal");
    assertEquals(pub.jobDetails.lineItems[0].descriptionByLang, {
      es: "Retiro de refrigerador y lavadora",
      en: "Removal of refrigerator and washing machine",
    });
    // what /i renders for ?lang=en and ?lang=es
    assertEquals(
      localizeLineItems(pub.jobDetails.lineItems, "en")[0].description,
      "Removal of refrigerator and washing machine",
    );
    assertEquals(
      localizeLineItems(pub.jobDetails.lineItems, "es")[0].description,
      "Retiro de refrigerador y lavadora",
    );

    // A draft's line edited in the invoice editor (PUT /invoices/:id with
    // only the lines) is translated afresh — nothing else would re-translate
    // it, and the English page would keep the new Spanish line.
    const draft = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        jobName: "Retiro de electrodomésticos",
        lineItems: [{
          description: "Retiro de refrigerador y lavadora",
          quantity: 1,
          unit: "job",
          price: 20_000,
        }],
        amount: 20_000,
        dueDate: "2026-12-30",
        billTo: { name: "Jorge Ruiz", email: "jorge.ruiz@example.com" },
      }),
    }).then((r) => r.json());
    const put = await fetch(`${BASE}/invoices/${draft.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        lineItems: [{
          description: "Retiro de estufa",
          quantity: 1,
          unit: "job",
          price: 20_000,
        }],
      }),
    });
    const putBody = await put.text();
    assertEquals(put.status, 200, putBody);
    const edited = await fetch(`${BASE}/invoices/${draft.id}/public`).then((
      r,
    ) => r.json());
    assertEquals(edited.jobDetails.lineItems[0].descriptionByLang, {
      es: "Retiro de estufa",
      en: "Stove removal",
    });
  } finally {
    StubLLMClient.prototype.respond = original;
    await server.stop();
    await resetKv();
  }
});
