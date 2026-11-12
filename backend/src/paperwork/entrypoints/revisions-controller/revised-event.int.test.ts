/**
 * REQ-564 — demo-loop cycle 4, issue m35, over HTTP: publishing a revision
 * (POST /quotes/:id/publish, POST /invoices/:id/publish) emits a `revised`
 * event, so the notifications feed — which drives the topbar ticker and
 * Activity — says "Q-001 Version 2 published to Ann Lee".
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
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

const PORT = 9733;
const BASE = `http://localhost:${PORT}`;
async function drain(res: Response) {
  await res.body?.cancel();
}
async function login(phone = "+15125550201"): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  // the sender needs a name for the send paths
  await drain(
    await fetch(`${BASE}/me`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-session-id": v.sessionId,
      },
      // the feed renders in the viewer's language (P-59): read it in English
      body: JSON.stringify({ name: "Rafa Castro", language: "en" }),
    }),
  );
  return v.sessionId;
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
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
async function post(
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function put(
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}
async function get(path: string, headers: Record<string, string> = {}) {
  return await fetch(`${BASE}${path}`, { headers }).then((r) => r.json());
}
async function mkCustomer(sid: string, name = "Ann Lee") {
  return await post("/customers", auth(sid), {
    name,
    email: "ann@example.com",
    address: "1 Main St",
  }).then((r) => r.json());
}
async function mkQuote(
  sid: string,
  customerId: string,
  extra: Record<string, unknown> = {},
) {
  return await post("/quotes", auth(sid), {
    summary: "Roof replacement",
    customerId,
    lineItems: [{
      description: "Shingles",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    estimatedTotal: 100000,
    ...extra,
  }).then((r) => r.json());
}

type FeedRow = {
  type: string;
  title: string;
  titleKey?: string;
  entityType?: string;
  entityId?: string;
};
async function feed(sid: string): Promise<FeedRow[]> {
  return await get("/notifications", auth(sid));
}

Deno.test('REQ-564 (cycle 4, m35): publishing a quote revision puts "Q-001 Version 2 published to Ann Lee" in the feed', async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), {
        lineItems: [{ ...q.lineItems[0] }, {
          description: "Under-cabinet lighting",
          quantity: 1,
          unit: "ea",
          price: 50000,
        }],
        estimatedTotal: 150000,
      }),
    );
    const res = await post(`/quotes/${q.id}/publish`, auth(sid), {});
    assertEquals(res.status, 200);
    const published = await res.json();
    assertEquals(published.version, 2);
    const rows = (await feed(sid)).filter((n) =>
      n.titleKey === "notify.quote.revised"
    );
    assertEquals(rows.length, 1, "one 'revised' row for the publish");
    assertEquals(rows[0].title, "Q-001 Version 2 published to Ann Lee");
    assertEquals(rows[0].entityType, "quote");
    assertEquals(rows[0].entityId, q.id);
    // newest first: the ticker reads the publish, not an older "Quote sent"
    const newest = (await feed(sid))[0];
    assertEquals(newest.titleKey, "notify.quote.revised");
    // a refused publish (nothing pending) writes nothing
    await drain(await post(`/quotes/${q.id}/publish`, auth(sid), {}));
    assertEquals(
      (await feed(sid)).filter((n) => n.titleKey === "notify.quote.revised")
        .length,
      1,
    );
  });
});

Deno.test('REQ-564 (cycle 4, m35): publishing an invoice revision puts "INV-001 Version 2 published to Ann Lee" in the feed', async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const inv = await post("/invoices", auth(sid), {
      customerId: c.id,
      amount: 100000,
      status: "sent",
    }).then((r) => r.json());
    assertEquals(inv.number, "INV-001");
    const edited = await put(`/invoices/${inv.id}`, auth(sid), {
      amount: 120000,
    }).then((r) => r.json());
    assert(edited.pendingRevision, "a sent invoice's edit waits as a revision");
    const res = await post(`/invoices/${inv.id}/publish`, auth(sid), {});
    assertEquals(res.status, 200);
    assertEquals((await res.json()).version, 2);
    const rows = (await feed(sid)).filter((n) =>
      n.titleKey === "notify.invoice.revised"
    );
    assertEquals(rows.length, 1);
    assertEquals(rows[0].title, "INV-001 Version 2 published to Ann Lee");
    assertEquals(rows[0].entityType, "invoice");
    assertEquals(rows[0].entityId, inv.id);
  });
});
