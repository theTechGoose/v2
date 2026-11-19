/**
 * REQ-1141 (LOOP-007 cycle 3, q3-73) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green." QA posted a
 * 308-character customer name; it was saved (200) and filled the phone screen.
 *
 * Integration over HTTP, app booted: POST /customers with a name over 120
 * characters is a 400 customer.nameTooLong that saves nothing; PUT cannot
 * lengthen a name past it either; exactly 120 is kept.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  const sent = await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });
  await sent.body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-1141 q3-73: POST /customers with a 308-character name is 400 customer.nameTooLong and saves nothing; PUT cannot lengthen a name past 120; exactly 120 is kept", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125557141");
    const headers = { "content-type": "application/json", "x-session-id": sid };

    const long = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "<b>x</b>" + "Z".repeat(300) }),
    });
    const longBody = await long.text();
    assertEquals(long.status, 400, `a 308-character name must be refused: ${longBody.slice(0, 200)}`);
    assertEquals(longBody.includes("customer.nameTooLong"), true, longBody.slice(0, 200));
    const none = await fetch(`${BASE}/customers`, { headers }).then((r) => r.json());
    assertEquals(none.length, 0, "the refused name saved nothing");

    const max = "M".repeat(120);
    const ok = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: max }),
    }).then((r) => r.json());
    assertEquals(ok.name, max, "exactly 120 characters is kept whole");

    const put = await fetch(`${BASE}/customers/${ok.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: "N".repeat(121) }),
    });
    const putBody = await put.text();
    assertEquals(put.status, 400, `a 121-character edit must be refused: ${putBody.slice(0, 200)}`);
    assertEquals(putBody.includes("customer.nameTooLong"), true, putBody.slice(0, 200));
    const still = await fetch(`${BASE}/customers/${ok.id}`, { headers }).then((r) => r.json());
    assertEquals(still.name, max, "a refused edit changes nothing");
  } finally {
    await server.stop();
    await resetKv();
  }
});
