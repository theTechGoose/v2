/**
 * REQ-497 (demo-loop cycle 3, m23) over the booted app: a Spanish contractor
 * issues a standalone invoice from "Nueva factura" (POST /invoices, no
 * quote). The customer's page data — GET /invoices/:id/public — carries the
 * title and concepts in both languages, so /i?lang=en reads English. Before,
 * INV-002 kept its Spanish title on /i?lang=en.
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

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

const EN: Record<string, string> = {
  "Reparación de cerca": "Fence repair",
  "Cambiar 3 postes": "Replace 3 posts",
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

Deno.test("REQ-497 (demo m23): a standalone invoice typed in Spanish reaches the public page with its English title and concepts", async () => {
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
    const sid = await login("+15125554970");
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
        jobName: "Reparación de cerca",
        description: "Cambiar 3 postes",
        amount: 600_00,
        dueDate: "2026-12-30",
        status: "sent",
      }),
    }).then((r) => r.json());
    const pub = await fetch(`${BASE}/invoices/${inv.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(pub.jobDetails.jobName, "Reparación de cerca");
    assertEquals(pub.jobDetails.jobNameByLang, {
      es: "Reparación de cerca",
      en: "Fence Repair",
    });
    assertEquals(pub.jobDetails.descriptionByLang, {
      es: "Cambiar 3 postes",
      en: "Replace 3 posts",
    });
  } finally {
    StubLLMClient.prototype.respond = original;
    await server.stop();
    await resetKv();
  }
});
