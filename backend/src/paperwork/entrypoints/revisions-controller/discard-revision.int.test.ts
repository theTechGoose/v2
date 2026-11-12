/**
 * REQ-395 — demo-loop cycle 2, issue M12, over HTTP: a pending revision that
 * equals the live quote is no revision at all, and an unwanted draft revision
 * can be discarded (POST /quotes/:id/discard-revision).
 */
import "#reflect-metadata";
import { assertEquals, assertNotEquals } from "#std/assert";
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

const PORT = 9617;
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
      body: JSON.stringify({ name: "Rafa Castro" }),
    }),
  );
  return v.sessionId;
}
function auth(sid: string) {
  return { "content-type": "application/json", "x-session-id": sid };
}
const json = { "content-type": "application/json" };
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

const lighting = {
  description: "Under-cabinet lighting",
  quantity: 1,
  unit: "ea",
  price: 50000,
};
const shingles = {
  description: "Shingles",
  quantity: 1,
  unit: "job",
  price: 100000,
};

Deno.test("REQ-395 (demo M12): editing a sent quote back to what the customer already sees leaves nothing pending — no badge, nothing to publish", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    // add a line → a real pending revision
    const added = await put(`/quotes/${q.id}`, auth(sid), {
      lineItems: [shingles, lighting],
      estimatedTotal: 150000,
    }).then((r) => r.json());
    assertEquals(added.pendingRevision?.lineItems?.length, 2);
    // take it out again → the revision equals the live quote
    const back = await put(`/quotes/${q.id}`, auth(sid), {
      lineItems: [shingles],
      estimatedTotal: 100000,
    }).then((r) => r.json());
    assertEquals(
      back.pendingRevision,
      undefined,
      "a revision equal to the live version is not stored",
    );
    const stored = await get(`/quotes/${q.id}`, auth(sid));
    assertEquals(stored.pendingRevision, undefined);
    assertEquals(stored.version, 1);
    const nothing = await post(`/quotes/${q.id}/publish`, auth(sid), {});
    assertEquals(nothing.status, 409);
    await drain(nothing);
  });
});

Deno.test("REQ-395 (demo M12): POST /quotes/:id/discard-revision drops the pending revision and leaves the live version alone; a signed quote refuses", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id);
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    await drain(
      await put(`/quotes/${q.id}`, auth(sid), {
        lineItems: [shingles, lighting],
        estimatedTotal: 150000,
      }),
    );
    const res = await post(`/quotes/${q.id}/discard-revision`, auth(sid), {});
    assertEquals(res.status, 200);
    const discarded = await res.json();
    assertEquals(discarded.pendingRevision, undefined);
    assertEquals(discarded.estimatedTotal, 100000);
    assertEquals(discarded.version, 1);
    const stored = await get(`/quotes/${q.id}`, auth(sid));
    assertEquals(stored.pendingRevision, undefined);
    assertEquals(stored.lineItems.length, 1);
    // nothing left → a second discard is harmless
    const again = await post(`/quotes/${q.id}/discard-revision`, auth(sid), {});
    assertEquals(again.status, 200);
    await drain(again);
    // another owner cannot discard it
    const other = await login("+15125550299");
    const foreign = await post(
      `/quotes/${q.id}/discard-revision`,
      auth(other),
      {},
    );
    assertNotEquals(foreign.status, 200);
    await drain(foreign);
    // a signed quote is locked
    const accept = await post(`/quotes/${q.id}/accept`, json, {
      name: "Ann",
      version: 1,
    });
    assertEquals(accept.status, 200);
    await drain(accept);
    const locked = await post(
      `/quotes/${q.id}/discard-revision`,
      auth(sid),
      {},
    );
    assertEquals(locked.status, 409);
    assertEquals((await locked.json()).reason, "locked_signed");
  });
});
