import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-241 (demo issue quote-invoice-money-m1) — on the booted app: an owner
 * who opened the onboarding sample, then made their first real quote, gets
 * Q-001 for it; the sample reads "SAMPLE"/"MUESTRA", not a Q- number.
 */
@Module({ imports: [AgentsModule, PaperworkModule] })
class TestApp {}

const PORT = 9241;
const J = { "content-type": "application/json" };

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(base: string, phone: string): Promise<string> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-241 e2e: after POST /sample-quote the first real quote is Q-001 and the sample has no Q- number", async () => {
  await withServer(async (base) => {
    const sid = await login(base, "+15125552410");
    const auth = { ...J, "x-session-id": sid };
    const sample = await fetch(`${base}/agents/conversations/sample-quote`, {
      method: "POST",
      headers: auth,
      body: "{}",
    }).then((r) => r.json());
    assertEquals(sample.created, true);

    const res = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ summary: "Deck repair", lineItems: [] }),
    });
    assertEquals(res.ok, true);
    const real = await res.json();
    assertEquals(real.number, "Q-001");

    const sampleRow = await fetch(`${base}/quotes/${sample.quoteId}`, {
      headers: auth,
    }).then((r) => r.json());
    // REQ-256 supersedes REQ-241's "SAMPLE"/"MUESTRA" mark (reconciled on
    // demo-fixes): the sample carries no number at all, never a Q- one.
    assertEquals(sampleRow.number, undefined);
  });
});
