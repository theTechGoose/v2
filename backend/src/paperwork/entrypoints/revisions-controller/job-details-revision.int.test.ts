/**
 * REQ-561 — demo-loop cycle 4, issue M28, over HTTP: the job-detail bullets
 * the customer reads (quote.description) are part of a revision. Saving new
 * job details on a sent quote files them in the pending revision — the
 * customer keeps reading the published bullets — with the stale per-language
 * copies cleared, so publishing Version 2 never shows the old translation.
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

const PORT = 9561;
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

const shingles = {
  description: "Shingles",
  quantity: 1,
  unit: "job",
  price: 100000,
};

const V1 = "Remove old shingles\nInstall underlayment\nHaul debris";
const V1_ES = "Quitar tejas viejas\nInstalar base\nRetirar escombros";
const V2 =
  "Remove old shingles\nInstall underlayment\nReplace two rotted rafters\nHaul debris";

Deno.test("REQ-561 (demo M28): new job details on a sent quote wait in the pending revision with stale translations cleared; the customer keeps V1 until publish", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id, {
      lang: "en",
      description: V1,
      descriptionByLang: { en: V1, es: V1_ES },
    });
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));

    const res = await put(`/quotes/${q.id}`, auth(sid), {
      description: V2,
      lineItems: [shingles],
      estimatedTotal: 100000,
    });
    assertEquals(res.status, 200);
    const saved = await res.json();
    assertEquals(saved.pendingRevision?.description, V2);
    assertEquals(
      saved.pendingRevision?.descriptionByLang,
      {},
      "the old bullets' translations must not ride into Version 2",
    );
    // the live (published) quote is untouched
    const live = await get(`/quotes/${q.id}`, auth(sid));
    assertEquals(live.description, V1);
    assertEquals(live.descriptionByLang?.es, V1_ES);
    assertEquals(live.version, 1);

    // publish → Version 2 carries the new bullets, no stale Spanish copy
    const pub = await post(`/quotes/${q.id}/publish`, auth(sid), {});
    assertEquals(pub.status, 200);
    const published = await pub.json();
    assertEquals(published.version, 2);
    assertEquals(published.description, V2);
    assertEquals(published.descriptionByLang?.es, undefined);
    assertEquals(published.pendingRevision, undefined);
  });
});

Deno.test("REQ-561 (demo M28): job details edited back to the published text leave nothing pending", async () => {
  await withServer(async () => {
    const sid = await login();
    const c = await mkCustomer(sid);
    const q = await mkQuote(sid, c.id, {
      lang: "en",
      description: V1,
      descriptionByLang: { en: V1, es: V1_ES },
    });
    await drain(await put(`/quotes/${q.id}`, auth(sid), { status: "sent" }));
    const changed = await put(`/quotes/${q.id}`, auth(sid), {
      description: V2,
    }).then((r) => r.json());
    assertEquals(changed.pendingRevision?.description, V2);
    const back = await put(`/quotes/${q.id}`, auth(sid), {
      description: V1,
    }).then((r) => r.json());
    assertEquals(
      back.pendingRevision,
      undefined,
      "no description change → no cleared translations either",
    );
  });
});
