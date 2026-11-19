/**
 * REQ-1119 (LOOP-007 cycle 3, q3-47) — POST/PUT /customers refuse a key the
 * customer DTO does not declare. QA posted `phone` (not `phoneNumber`): 200,
 * saved, returned by GET /customers, and ignored by every screen — the
 * customer page read "Phone —" and the send sheet "needs a phone". The same
 * spread let a body inject `deletedAt` into the stored record.
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

const PORT = 47000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(phone = "+15125551119"): Promise<Record<string, string>> {
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
  return { "content-type": "application/json", "x-session-id": v.sessionId };
}

for (
  const [label, extra] of [
    ["phone '843-555-0111'", { phone: "843-555-0111" }],
    ["phone '512-555-0123 ext 4'", { phone: "512-555-0123 ext 4" }],
    ["deletedAt", { deletedAt: "2026-01-01T00:00:00.000Z" }],
  ] as const
) {
  Deno.test({
    name:
      `REQ-1119 q3-47 POST /customers with the undeclared key ${label} answers 400, nothing saved`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () =>
      withServer(async () => {
        const headers = await login();
        const r = await fetch(`${BASE}/customers`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Lupe Garza", ...extra }),
        });
        const text = await r.text();
        const list = await fetch(`${BASE}/customers`, { headers }).then((x) =>
          x.json()
        );
        assertEquals(
          r.status,
          400,
          `answered ${r.status} ${text}; stored ${JSON.stringify(list)}`,
        );
        assertEquals(list.length, 0, JSON.stringify(list));
      }),
  });
}

Deno.test({
  name:
    "REQ-1119 q3-47 PUT /customers/:id with the undeclared key `phone` answers 400 and stores nothing under it",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () =>
    withServer(async () => {
      const headers = await login();
      const ok = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Lupe Garza" }),
      }).then((r) => r.json());
      const r = await fetch(`${BASE}/customers/${ok.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ phone: "843-555-0111" }),
      });
      const text = await r.text();
      const after = await fetch(`${BASE}/customers/${ok.id}`, { headers })
        .then((x) => x.json());
      assertEquals(
        r.status,
        400,
        `answered ${r.status} ${text}; stored ${JSON.stringify(after)}`,
      );
      assertEquals("phone" in after, false, JSON.stringify(after));
    }),
});
