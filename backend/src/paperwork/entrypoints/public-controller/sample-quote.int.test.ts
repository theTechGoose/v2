/**
 * REQ-256 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue onboarding-dashboard-settings-p2: a Spanish account's sample
 * opened as "Q-001 · Versión 1 · Enviada", "Paver Patio Installation" in
 * English, "PARA —".
 *
 * Integration over HTTP, app booted: the onboarding endpoint makes the sample,
 * and the public projection the /q page renders carries what it needs — the
 * sample flag, no Q- number, a draft that opening does not flip to "viewed",
 * and the content in both languages.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertNotEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule, AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

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

Deno.test("REQ-256 the public sample is flagged, unnumbered, a draft that opening leaves a draft, in both languages", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125552561");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await (await fetch(`${BASE}/profile/identity`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ businessName: "Plomería Rivera" }),
    })).body?.cancel();
    const made = await fetch(`${BASE}/agents/conversations/sample-quote`, {
      method: "POST",
      headers: auth,
      body: "{}",
    }).then((r) => r.json());
    assertEquals(made.created, true);

    // opened twice — the second read sees whatever the first open did
    await (await fetch(`${BASE}/quotes/${made.quoteId}/public`)).body?.cancel();
    const pub = await fetch(`${BASE}/quotes/${made.quoteId}/public`).then((r) =>
      r.json()
    );

    assertEquals(pub.isSample, true);
    assertEquals(pub.status, "draft");
    assertEquals(pub.state, "draft");
    assert(
      !/^Q-\d+/.test(pub.number ?? ""),
      `sample took a number: ${pub.number}`,
    );
    assert(
      pub.jobNameByLang?.en && pub.jobNameByLang?.es,
      JSON.stringify(pub.jobNameByLang),
    );
    assertNotEquals(pub.jobNameByLang.en, pub.jobNameByLang.es);
    assert(
      !/paver|adoquin/i.test(JSON.stringify(pub)),
      "a plumber's sample is not a paver patio",
    );
    for (const li of pub.lineItems) {
      assert(
        li.descriptionByLang?.en && li.descriptionByLang?.es,
        JSON.stringify(li),
      );
    }
  } finally {
    await server.stop();
    await resetKv();
  }
});
