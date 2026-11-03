/** REQ-135 — GET /clients answers one page, with the chip counts and the roster's totals. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}
const PORT = 9131;
const J = { "content-type": "application/json" };

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(PORT); } finally { await server.stop(); await resetKv(); }
}
async function login(port: number, phone = "+15125551351"): Promise<string> {
  await (await fetch(`http://localhost:${port}/auth/send-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone }) })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone, code: stored!.code }) }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-135 GET /clients — 30 customers: page 1 of 25, page 2 of 5, total 30; q narrows; status chips; counts and summary", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const H = { ...J, "x-session-id": sid };
    for (let i = 1; i <= 30; i++) {
      await (await fetch(`http://localhost:${port}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: `Client ${String(i).padStart(2, "0")}`, email: `c${i}@example.com` }) })).body?.cancel();
    }
    const p1 = await fetch(`http://localhost:${port}/clients`, { headers: H }).then((r) => r.json());
    assertEquals([p1.items.length, p1.page, p1.pageSize, p1.total, p1.totalPages], [25, 1, 25, 30, 2]);
    assertEquals(p1.items[0].name, "Client 01");
    assertEquals(typeof p1.items[0].status, "string", "a CustomerCard, derived fields and all");
    assertEquals(p1.counts.all, 30);
    assertEquals(p1.summary.totalClients, 30);
    assertEquals(Array.isArray(p1.loop), true);
    const p2 = await fetch(`http://localhost:${port}/clients?page=2`, { headers: H }).then((r) => r.json());
    assertEquals([p2.items.length, p2.page, p2.items[0].name], [5, 2, "Client 26"]);
    const small = await fetch(`http://localhost:${port}/clients?page=3&pageSize=10`, { headers: H }).then((r) => r.json());
    assertEquals([small.items.length, small.totalPages, small.items[0].name], [10, 3, "Client 21"]);
    const q = await fetch(`http://localhost:${port}/clients?q=c7%40example`, { headers: H }).then((r) => r.json());
    assertEquals([q.items.length, q.total, q.counts.all, q.summary.totalClients], [1, 1, 1, 30]);
    assertEquals(q.items[0].name, "Client 07");
    // thirty fresh customers share one status (the cards derive it): that chip holds them all, another chip is an empty page with the counts intact
    const st = p1.items[0].status as string;
    const same = await fetch(`http://localhost:${port}/clients?status=${st}`, { headers: H }).then((r) => r.json());
    assertEquals([same.total, same.counts[st]], [30, 30]);
    const other = st === "owes" ? "lead" : "owes";
    const none = await fetch(`http://localhost:${port}/clients?status=${other}`, { headers: H }).then((r) => r.json());
    assertEquals([none.items.length, none.total, none.totalPages, none.counts[st]], [0, 0, 1, 30]);
  });
});
