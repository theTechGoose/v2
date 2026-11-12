/**
 * REQ-306 — demo cycle 1 issue B3: the contractor, logged in, opened "View as
 * customer" and signed the client's agreement. The public payload now says
 * `internal: true` to the business's own viewer and the accept refuses them
 * (409 owner_cannot_sign) unless the explicit in-person override
 * `?as=customer&confirm=1` is passed. The anonymous customer is unaffected.
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
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone = "+15125557306"): Promise<string> {
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

async function sentQuote(sid: string): Promise<string> {
  const q = await fetch(`${base()}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify({ summary: "Job", lineItems: [] }),
  }).then((r) => r.json());
  const owner = (await new SessionStore().get(sid))!;
  await new QuoteStore().update(q.id, owner.userId, { status: "sent" });
  return q.id as string;
}

async function accept(
  id: string,
  headers: Record<string, string>,
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base()}/quotes/${id}/accept${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "John Customer" }),
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("REQ-306 B3: the public payload says `internal: true` to the owner and to staff behind an impersonation, never to the anonymous customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const id = await sentQuote(sid);
    const owner = (await new SessionStore().get(sid))!;
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const get = (headers: Record<string, string>) =>
      fetch(`${base()}/quotes/${id}/public`, { headers }).then((r) => r.json());

    assertEquals((await get({ "x-session-id": sid })).internal, true);
    assertEquals((await get({ cookie: `pm_session=${sid}` })).internal, true);
    assertEquals(
      (await get({ cookie: `pm_session=${staff.id}` })).internal,
      true,
    );
    assertEquals(
      (await get({})).internal,
      undefined,
      "the customer sees no flag",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("REQ-306 B3: the owner's accept is 409 owner_cannot_sign and the quote stays unsigned; ?as=customer&confirm=1 signs in person; the anonymous customer signs as before", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const id = await sentQuote(sid);
    const owner = (await new SessionStore().get(sid))!;
    const staff = await new SessionStore().createImpersonation({
      targetUserId: owner.userId,
      impersonatorId: "staff-super-admin",
      returnSessionId: "staff-own-session",
    });
    const status = async () =>
      (await new QuoteStore().get(id)).status as string;

    // the owner through the browser cookie (what the /api proxy forwards)
    let r = await accept(id, { cookie: `pm_lang=en; pm_session=${sid}` });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_sign");
    assertEquals(await status(), "sent", "the owner's signature must not land");
    // the owner through the SDK header
    r = await accept(id, { "x-session-id": sid });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_sign");
    // staff impersonating (the demo replica)
    r = await accept(id, { cookie: `pm_session=${staff.id}` });
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_sign");
    assertEquals(await status(), "sent");
    // a half override is no override
    r = await accept(id, { "x-session-id": sid }, "?as=customer");
    assertEquals(r.status, 409);
    assertEquals(r.body.reason, "owner_cannot_sign");

    // the explicit in-person override lets the owner hand the pad over
    r = await accept(id, { "x-session-id": sid }, "?as=customer&confirm=1");
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(await status(), "accepted");

    // another quote: the anonymous customer still signs with no session
    const id2 = await sentQuote(sid);
    r = await accept(id2, {});
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals((await new QuoteStore().get(id2)).status, "accepted");
    assertEquals(
      (await new QuoteStore().get(id2)).acceptedName,
      "John Customer",
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
