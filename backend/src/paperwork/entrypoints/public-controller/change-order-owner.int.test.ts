/**
 * REQ-398 — demo-loop cycle 2, issues M15 + m25 (the public change order).
 *
 * M15: REQ-306 guarded /q only. GET /change-orders/:id/public now says
 * `internal: true` to the business's own viewer (owner, admin acting for
 * them, staff behind an impersonation), and approve/decline refuse that
 * viewer with 409 owner_cannot_approve unless the in-person override
 * `?as=customer&confirm=1` is passed. The anonymous customer is unaffected.
 *
 * m25: the payload carries the JOB totals — the quote's agreed total before
 * and after the change — next to the invoice's. The demo's 50/50 job:
 * $19,200 quote, INV-002 $9,600, +$850 → job $19,200 → $20,050, invoice
 * $9,600 → $10,450.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557398"): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** the demo's job: $19,200 quote, INV-002 $9,600, a pending +$850 order */
async function seedOrder(userId: string): Promise<string> {
  const q = await new QuoteStore().create(userId, {
    summary: "Kitchen",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 1_920_000,
    }],
    estimatedTotal: 1_920_000,
  } as never);
  await new QuoteStore().update(q.id, userId, { status: "accepted" });
  const inv = await new InvoiceStore().create(userId, {
    quoteId: q.id,
    amount: 960_000,
    status: "sent",
    jobName: "Kitchen",
  } as never);
  const co = await new ChangeOrderStore().create(userId, inv.id, {
    description: "Add pantry shelving",
    deltaAmountCents: 85_000,
    quoteId: q.id,
    originalAmountCents: 960_000,
  });
  return co.id;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  return server;
}

async function post(
  path: string,
  headers: Record<string, string>,
  body: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("REQ-398 M15: GET /change-orders/:id/public says `internal: true` to the owner and to staff behind an impersonation, never to the anonymous customer", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const id = await seedOrder(owner.userId);
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const get = (headers: Record<string, string>) =>
      fetch(`${base()}/change-orders/${id}/public`, { headers }).then((r) =>
        r.json()
      );
    assertEquals((await get({ "x-session-id": sid })).internal, true);
    assertEquals((await get({ cookie: `pm_session=${sid}` })).internal, true);
    assertEquals(
      (await get({ cookie: `pm_session=${staff.id}` })).internal,
      true,
    );
    assertEquals((await get({})).internal, undefined, "customer: no flag");
    // another account is not the business — it may really be the customer
    const other = await login("+15125557399");
    assertEquals((await get({ "x-session-id": other })).internal, undefined);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-398 M15: the owner's approve and decline are 409 owner_cannot_approve and the order stays pending; ?as=customer&confirm=1 approves in person; the anonymous customer approves as before", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const id = await seedOrder(owner.userId);
    const status = async () => (await new ChangeOrderStore().get(id)).status;

    let r = await post(`/change-orders/${id}/approve`, {
      cookie: `pm_lang=en; pm_session=${sid}`,
    }, { name: "Owner Typing" });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_approve");
    assertEquals(
      await status(),
      "pending",
      "the owner's approval must not land",
    );

    r = await post(`/change-orders/${id}/decline`, { "x-session-id": sid });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_approve");
    assertEquals(
      await status(),
      "pending",
      "the owner's decline must not land",
    );

    r = await post(`/change-orders/${id}/approve`, {
      cookie: `pm_session=${staff.id}`,
    }, { name: "Staff" });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_approve");

    r = await post(`/change-orders/${id}/approve?as=customer`, {
      "x-session-id": sid,
    }, { name: "Half Override" });
    assertEquals(r.status, 409, "a half override is no override");

    r = await post(`/change-orders/${id}/approve?as=customer&confirm=1`, {
      "x-session-id": sid,
    }, { name: "Customer In Person" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(await status(), "approved");

    // a second order: the anonymous customer approves and declines as before
    const id2 = await seedOrder(owner.userId);
    r = await post(`/change-orders/${id2}/approve`, {}, { name: "Juan" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new ChangeOrderStore().get(id2)).approvedName, "Juan");
    const id3 = await seedOrder(owner.userId);
    r = await post(`/change-orders/${id3}/decline`, {});
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new ChangeOrderStore().get(id3)).status, "declined");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-398 m25: the public payload carries the job totals ($19,200 → $20,050) next to the invoice's ($9,600 → $10,450), before and after approval", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const id = await seedOrder(owner.userId);
    const get = () =>
      fetch(`${base()}/change-orders/${id}/public`).then((r) => r.json());

    let p = await get();
    assertEquals(p.currentAmount, 960_000, "this invoice, now");
    assertEquals(p.newAmount, 1_045_000, "this invoice, after");
    assertEquals(p.jobCurrentAmount, 1_920_000, "the job, now");
    assertEquals(p.jobNewAmount, 2_005_000, "the job, after");

    const r = await post(`/change-orders/${id}/approve`, {}, { name: "Juan" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    p = await get();
    assertEquals(p.status, "approved");
    assertEquals(p.jobCurrentAmount, 1_920_000, "approved: before excludes it");
    assertEquals(p.jobNewAmount, 2_005_000, "approved: after includes it once");
    assertEquals(p.currentAmount, 960_000);
    assertEquals(p.newAmount, 1_045_000);
  } finally {
    await server.stop();
    await resetKv();
  }
});
