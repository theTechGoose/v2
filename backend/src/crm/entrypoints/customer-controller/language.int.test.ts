/**
 * REQ-715 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue m31 (with c2-M29, c3-m43, c4-M34): a
 * customer had no language — "¿cómo le digo que Carmen habla español? No veo
 * campo de idioma del cliente." (pair 6).
 *
 * Integration over HTTP, app booted: POST /customers keeps `language`,
 * PUT /customers/:id changes it, "" clears it (the field is gone, not ""),
 * and anything but en | es is a 400 that changes nothing.
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

Deno.test("REQ-715 m31: a customer's language is saved on create, changed and cleared on edit, and only en | es is accepted", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125557150");
    const headers = { "content-type": "application/json", "x-session-id": sid };
    const created = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Carmen Núñez", language: "es" }),
    }).then((r) => r.json());
    assertEquals(created.language, "es", JSON.stringify(created));

    const read = await fetch(`${BASE}/customers/${created.id}`, { headers })
      .then((r) => r.json());
    assertEquals(read.language, "es", "GET returns the saved language");

    const put = (body: unknown) =>
      fetch(`${BASE}/customers/${created.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });

    const toEn = await put({ language: "en" }).then((r) => r.json());
    assertEquals(toEn.language, "en");

    const refused = await put({ language: "fr" });
    assertEquals(refused.status, 400);
    await refused.body?.cancel();
    const still = await fetch(`${BASE}/customers/${created.id}`, { headers })
      .then((r) => r.json());
    assertEquals(still.language, "en", "a refused language changes nothing");

    const cleared = await put({ language: "" }).then((r) => r.json());
    assertEquals("language" in cleared, false, JSON.stringify(cleared));
    const after = await fetch(`${BASE}/customers/${created.id}`, { headers })
      .then((r) => r.json());
    assertEquals("language" in after, false, "cleared means no language");
    assertEquals(after.name, "Carmen Núñez", "the rest of the record stays");

    const listed = await fetch(`${BASE}/customers`, { headers })
      .then((r) => r.json());
    assertEquals(listed.length, 1);
  } finally {
    await server.stop();
    await resetKv();
  }
});
