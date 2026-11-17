/**
 * REQ-479 — demo-loop cycle 3, issue M30: the owner, logged in, opened her
 * own invoice link and filed "the customer paid by Zelle" on it — the invoice
 * flipped to `claimed` and her bell rang "El cliente pagó por Zelle".
 * REQ-306 guarded quote accept and REQ-398 the change order; the claim had no
 * session check at all.
 *
 * Now GET /invoices/:id/public says `internal: true` to the business's own
 * viewer (owner, admin acting for them, staff behind an impersonation), and
 * POST /invoices/:id/claim-payment refuses that viewer with 409
 * owner_cannot_claim unless the in-person override `?as=customer&confirm=1`
 * is passed. The anonymous customer — and any other account — is unaffected.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557479"): Promise<string> {
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

async function sentInvoice(userId: string): Promise<string> {
  const inv = await new InvoiceStore().create(userId, {
    amount: 48_000,
    status: "sent",
    jobName: "Fence repair",
  } as never);
  return inv.id;
}

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  return server;
}

async function claim(
  id: string,
  headers: Record<string, string>,
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base()}/invoices/${id}/claim-payment${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ method: "zelle", reference: "ZL-479" }),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("REQ-479 M30: GET /invoices/:id/public says `internal: true` to the owner and to staff behind an impersonation, never to the anonymous customer or another account", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const id = await sentInvoice(owner.userId);
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const get = (headers: Record<string, string>) =>
      fetch(`${base()}/invoices/${id}/public`, { headers }).then((r) =>
        r.json()
      );
    assertEquals((await get({ "x-session-id": sid })).internal, true);
    assertEquals((await get({ cookie: `pm_session=${sid}` })).internal, true);
    assertEquals(
      (await get({ cookie: `pm_session=${staff.id}` })).internal,
      true,
    );
    assertEquals((await get({})).internal, undefined, "customer: no flag");
    const other = await login("+15125557480");
    assertEquals((await get({ "x-session-id": other })).internal, undefined);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-479 M30: the owner's claim is 409 owner_cannot_claim and the invoice stays sent with no payment intent; staff too; a half override is no override; ?as=customer&confirm=1 claims in person; the customer and another account claim as before", async () => {
  const server = await boot();
  try {
    const sid = await login();
    const owner = (await new SessionStore().get(sid))!;
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const id = await sentInvoice(owner.userId);
    const stored = () => new InvoiceStore().get(id);

    let r = await claim(id, { cookie: `pm_lang=es; pm_session=${sid}` });
    assertEquals(r.status, 409, JSON.stringify(r.body));
    assertEquals(r.body.reason, "owner_cannot_claim");
    let inv = await stored();
    assertEquals(inv.status, "sent", "the owner's claim must not land");
    assertEquals(inv.paymentIntent, undefined, "no payment intent recorded");

    r = await claim(id, { "x-session-id": sid });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_claim");

    r = await claim(id, { cookie: `pm_session=${staff.id}` });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_claim");

    r = await claim(id, { "x-session-id": sid }, "?as=customer");
    assertEquals(r.status, 409, "a half override is no override");
    assertEquals((await stored()).status, "sent");

    r = await claim(id, { "x-session-id": sid }, "?as=customer&confirm=1");
    assertEquals(r.status, 200, JSON.stringify(r.body));
    inv = await stored();
    assertEquals(inv.status, "claimed", "in person: the customer's claim");

    // the anonymous customer claims as before
    const id2 = await sentInvoice(owner.userId);
    r = await claim(id2, {});
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new InvoiceStore().get(id2)).status, "claimed");

    // another account is not the business — it may really be the customer
    const other = await login("+15125557481");
    const id3 = await sentInvoice(owner.userId);
    r = await claim(id3, { "x-session-id": other });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new InvoiceStore().get(id3)).status, "claimed");
  } finally {
    await server.stop();
    await resetKv();
  }
});
