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

Deno.test("REQ-364 (demo p15-16, cycle 1) GET /clients — a lead made minutes ago and an invoice sent minutes ago are not in Today's loop", async () => {
  await withServer(async (port) => {
    const sid = await login(port, "+15125551364");
    const H = { ...J, "x-session-id": sid };
    const guy = await fetch(`http://localhost:${port}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Guy Justadded" }) }).then((r) => r.json());
    await (await fetch(`http://localhost:${port}/quotes`, { method: "POST", headers: H, body: JSON.stringify({ customerId: guy.id, summary: "Fence repair", lineItems: [] }) })).body?.cancel();
    const olga = await fetch(`http://localhost:${port}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Olga Owes" }) }).then((r) => r.json());
    await (await fetch(`http://localhost:${port}/invoices`, { method: "POST", headers: H, body: JSON.stringify({ contractId: "k", customerId: olga.id, dueDate: "2099-01-01", status: "pending", amount: 250_00 }) })).body?.cancel();
    const page = await fetch(`http://localhost:${port}/clients`, { headers: H }).then((r) => r.json());
    const statusOf = Object.fromEntries(page.items.map((c: { name: string; status: string }) => [c.name, c.status]));
    assertEquals(statusOf, { "Guy Justadded": "lead", "Olga Owes": "owes" }, "the demo's shape: a fresh lead and a fresh owes");
    assertEquals(page.loop, [], "nothing has been quiet long enough to check in on — the strip shows loopBar.empty");
  });
});

Deno.test("REQ-320 (demo m15, cycle 1) GET /clients — one signed quote, its invoice still owed: summary.activeJobs 1, counts.active 1 and the active chip lists the customer, who also owes", async () => {
  await withServer(async (port) => {
    const sid = await login(port, "+15125551352");
    const H = { ...J, "x-session-id": sid };
    const c = await fetch(`http://localhost:${port}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Ana Pérez", email: "ana@example.com" }) }).then((r) => r.json());
    const q = await fetch(`http://localhost:${port}/quotes`, {
      method: "POST", headers: H,
      body: JSON.stringify({ customerId: c.id, summary: "Patio", lineItems: [], status: "sent", estimatedTotal: 280_00, terms: [{ stepId: "payment_terms", value: "Due Now" }] }),
    }).then((r) => r.json());
    // REQ-460: the customer signs a SENT quote — POST /quotes makes a draft.
    await (await fetch(`http://localhost:${port}/quotes/${q.id}`, { method: "PUT", headers: H, body: JSON.stringify({ status: "sent" }) })).body?.cancel();
    const out = await fetch(`http://localhost:${port}/quotes/${q.id}/accept`, { method: "POST", headers: J, body: JSON.stringify({ name: "Ana Pérez" }) }).then((r) => r.json());
    assertEquals(out.ok, true);
    const page = await fetch(`http://localhost:${port}/clients`, { headers: H }).then((r) => r.json());
    assertEquals(page.summary.activeJobs, 1, "hero: 1 signed job in flight");
    assertEquals(page.summary.owedCents, 280_00, "and $280 currently owed");
    assertEquals([page.counts.active, page.counts.owes], [1, 1], "the Active jobs chip and the Owes chip both hold her");
    const active = await fetch(`http://localhost:${port}/clients?status=active`, { headers: H }).then((r) => r.json());
    assertEquals(active.items.map((x: { name: string }) => x.name), ["Ana Pérez"]);
  });
});
