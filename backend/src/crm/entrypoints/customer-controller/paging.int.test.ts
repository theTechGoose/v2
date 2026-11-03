/** REQ-135 — GET /customers: the array without a page asked for; one page with it. */
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
const PORT = 9132;
const J = { "content-type": "application/json" };

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally { await server.stop(); await resetKv(); }
}
async function login(port: number, phone = "+15125551352"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone }) })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone, code: stored!.code }) }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-135 GET /customers — the array without page; the envelope with it; q", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const H = { ...J, "x-session-id": sid };
    for (let i = 1; i <= 30; i++) {
      await (await fetch(`http://localhost:${port}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: `Client ${String(i).padStart(2, "0")}`, phoneNumber: `(540) 555-01${String(i).padStart(2, "0")}` }) })).body?.cancel();
    }
    const legacy = await fetch(`http://localhost:${port}/customers`, { headers: H }).then((r) => r.json());
    assertEquals(Array.isArray(legacy) && legacy.length, 30, "the array the quotes picker and the assistant read");
    const p2 = await fetch(`http://localhost:${port}/customers?page=2`, { headers: H }).then((r) => r.json());
    assertEquals([p2.items.length, p2.page, p2.pageSize, p2.total, p2.totalPages, p2.items[0].name], [5, 2, 25, 30, 2, "Client 26"]);
    const q = await fetch(`http://localhost:${port}/customers?q=5550107`, { headers: H }).then((r) => r.json());
    assertEquals([q.items.length, q.items[0].name, q.total], [1, "Client 07", 1]);
  });
});
