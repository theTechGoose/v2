/**
 * REQ-304 — Raphael, 2026-11-12: "fix every issue the demo found."
 * Demo cycle 1 issue M28: the customer's page showed "Version 2 · Revised"
 * with no "what changed".
 *
 * Integration over HTTP, app booted: a sent quote is edited (a pending
 * revision) and published; the public projection the /q page renders then
 * carries `changesFromPrevious` — the current version against the filed
 * one before it. Version 1 carries none.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const json = { "content-type": "application/json" };

async function login(phone: string): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  await (await fetch(`${BASE}/me`, {
    method: "PUT",
    headers: { ...json, "x-session-id": v.sessionId },
    body: JSON.stringify({ name: "Rafa Castro" }),
  })).body?.cancel();
  return v.sessionId;
}

Deno.test("REQ-304 M28: GET /quotes/:id/public carries changesFromPrevious once a revision is published — none at Version 1", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125553041");
    const auth = { ...json, "x-session-id": sid };
    const customer = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Dana Pérez", email: "dana@example.com" }),
    }).then((r) => r.json());
    const quote = await fetch(`${BASE}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Deck rebuild",
        customerId: customer.id,
        lineItems: [{
          description: "Deck",
          quantity: 1,
          unit: "job",
          price: 100000,
        }],
        estimatedTotal: 100000,
      }),
    }).then((r) => r.json());
    await (await fetch(`${BASE}/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();

    const v1 = await fetch(`${BASE}/quotes/${quote.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(v1.version, 1);
    assertEquals(v1.changesFromPrevious, undefined);

    // the edit waits as a pending revision; publishing makes Version 2
    await (await fetch(`${BASE}/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ estimatedTotal: 120000 }),
    })).body?.cancel();
    const published = await fetch(`${BASE}/quotes/${quote.id}/publish`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ notify: false }),
    }).then((r) => r.json());
    assertEquals(published.version, 2);

    const v2 = await fetch(`${BASE}/quotes/${quote.id}/public`).then((r) =>
      r.json()
    );
    assertEquals(v2.version, 2);
    assertEquals(v2.estimatedTotal, 120000);
    assertEquals(v2.changesFromPrevious, {
      totalFromCents: 100000,
      totalToCents: 120000,
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
    });
  } finally {
    await server.stop();
    await resetKv();
  }
});
