/**
 * REQ-806 — the approve-link door, end to end on the real module: an anonymous request names an
 * account; the super-admin phone (…7133) is texted a one-time link; approving (a POST — a link
 * preview's GET never approves) mints a read-only, 30-minute session for that one account, handed
 * once to the poller. Sign-in, /admin and every other session are untouched.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9806;
const json = { "content-type": "application/json" };

async function boot() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  await app.listen(PORT);
  const sent: Array<{ to: string; body: string }> = [];
  app.get(SmsService).send = (i: { to: string; body: string }) => {
    sent.push(i);
    return Promise.resolve({ ok: true });
  };
  const call = async (
    method: string,
    path: string,
    headers: Record<string, string> = json,
    body?: unknown,
  ) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    // deno-lint-ignore no-explicit-any
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: r.status, body: parsed };
  };
  const users = app.get(UserStore);
  const admin = await users.create({
    phoneNumber: "+18438557133",
    name: "Ops",
  });
  const alex = await users.create({
    phoneNumber: "+15408303528",
    name: "Alexander Jerez",
  });
  await app.get(BusinessIdentityStore).upsert(alex.id, {
    businessName: "A2Z Landscape LLC",
  });
  const tokenOf = (sms: string) =>
    sms.match(/\/ops\/approve\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
  return { app, sent, call, users, admin, alex, tokenOf };
}

Deno.test("REQ-806 approve link: request → text to …7133 → approve (POST) → a read-only 30-min view of that one account, handed to the poller once", async () => {
  const { app, sent, call, admin, alex, tokenOf } = await boot();
  Deno.env.set("DENO_DEPLOY", "1"); // the real deploy: the token goes by text only
  try {
    const req = await call("POST", "/ops/requests", json, {
      account: "A2Z Landscape",
      reason: "check Xpress Pay on his invoices",
    });
    assertEquals(req.status, 200, JSON.stringify(req.body));
    const { id, pollToken } = req.body;
    assert(id && pollToken, "an id and a poll token");
    assertEquals(sent.length, 1, "one text");
    assertEquals(sent[0].to, "+18438557133", "to the super-admin phone");
    assert(sent[0].body.includes("A2Z Landscape LLC"), sent[0].body);
    assert(
      sent[0].body.includes("check Xpress Pay on his invoices"),
      sent[0].body,
    );
    const token = tokenOf(sent[0].body);
    assert(token, "the text carries the approve link");
    assert(
      !JSON.stringify(req.body).includes(token),
      "the requester never gets the approve token",
    );

    const poll = (t = pollToken) =>
      call("GET", `/ops/requests/${id}`, { ...json, "x-ops-poll": t });
    assertEquals((await poll()).body.status, "pending");
    assertEquals(
      (await poll("wrong")).status,
      404,
      "a wrong poll token learns nothing",
    );

    // the approve page's read (GET) describes the ask and changes nothing
    const look = await call("GET", `/ops/approvals/${token}`);
    assertEquals(look.status, 200);
    assertEquals(look.body.account, "A2Z Landscape LLC (+15408303528)");
    assertEquals(look.body.status, "pending");
    assertEquals(
      (await poll()).body.status,
      "pending",
      "a GET never approves (link previews)",
    );

    const ok = await call("POST", `/ops/approvals/${token}/approve`);
    assertEquals(ok.status, 200, JSON.stringify(ok.body));
    assertEquals(
      (await call("POST", `/ops/approvals/${token}/approve`)).status,
      409,
      "single use",
    );
    assertEquals(
      (await call("POST", `/ops/approvals/${token}/deny`)).status,
      409,
      "decided is decided",
    );

    const got = await poll();
    assertEquals(got.body.status, "approved");
    const sid = got.body.sessionId as string;
    assert(sid, "the poller gets the session");
    assertEquals((await poll()).body.sessionId, undefined, "…once");

    const as = { ...json, "x-session-id": sid };
    const me = await call("GET", "/me", as);
    assertEquals(me.status, 200, JSON.stringify(me.body));
    assertEquals(
      me.body.id ?? me.body.user?.id,
      alex.id,
      "it is Alexander's account",
    );
    const write = await call("PUT", "/me", as, { name: "Changed" });
    assertEquals(write.status, 403, "read-only");
    assertEquals(write.body.error ?? write.body.message, "read_only_session");
    assertEquals(
      (await app.get(UserStore).get(alex.id)).name,
      "Alexander Jerez",
      "nothing changed",
    );

    const s = await app.get(SessionStore).get(sid);
    assertEquals(s?.readOnly, true);
    assertEquals(s?.impersonatorId, admin.id, "auditable: who approved");
    const life = Date.parse(s!.expiresAt!) - Date.parse(s!.createdAt);
    assert(life > 29 * 60_000 && life <= 30 * 60_000, `30 minutes (${life})`);
  } finally {
    Deno.env.delete("DENO_DEPLOY");
    await app.close();
    await resetKv();
  }
});

Deno.test("REQ-806 approve link: off the real deploy (no text goes out) the approve token rides the reply, as REQ-082's code does", async () => {
  const { app, sent, call, tokenOf } = await boot();
  try {
    const req = await call("POST", "/ops/requests", json, {
      account: "+15408303528",
      reason: "dev",
    });
    assertEquals(req.body.devApproveToken, tokenOf(sent[0].body));
    const none = await call("POST", "/ops/requests", json, {
      account: "Nobody",
      reason: "dev",
    });
    assertEquals(none.body.devApproveToken, undefined, "no match, no token");
  } finally {
    await app.close();
    await resetKv();
  }
});

Deno.test("REQ-806 approve link: deny ends it; an expired view is 401; the request itself never touches other sessions", async () => {
  const { app, sent, call, alex, tokenOf } = await boot();
  try {
    const own = await app.get(SessionStore).create(alex.id);
    const req = await call("POST", "/ops/requests", json, {
      account: "+15408303528",
      reason: "look",
    });
    const token = tokenOf(sent[0].body);
    assertEquals(
      (await call("POST", `/ops/approvals/${token}/deny`)).status,
      200,
    );
    const poll = await call("GET", `/ops/requests/${req.body.id}`, {
      ...json,
      "x-ops-poll": req.body.pollToken,
    });
    assertEquals(poll.body.status, "denied");
    assertEquals(poll.body.sessionId, undefined);
    // Alexander's own session still works, and can still write
    const mine = { ...json, "x-session-id": own.id };
    assertEquals((await call("GET", "/me", mine)).status, 200);
    assertEquals(
      (await call("PUT", "/me", mine, { name: "Alexander J." })).status,
      200,
    );

    // a view past its 30 minutes is refused
    const old = await app.get(SessionStore).createOpsView({
      targetUserId: alex.id,
      impersonatorId: "x",
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    assertEquals(
      (await call("GET", "/me", { ...json, "x-session-id": old.id })).status,
      401,
    );
  } finally {
    await app.close();
    await resetKv();
  }
});

Deno.test("REQ-806 approve link: no single match texts nobody; asks are rate limited", async () => {
  const { app, sent, call } = await boot();
  try {
    const none = await call("POST", "/ops/requests", json, {
      account: "Nobody Landscaping",
      reason: "x",
    });
    assertEquals(
      none.status,
      200,
      "same answer either way — no account enumeration",
    );
    assertEquals(sent.length, 0, "no text for no match");
    const st = await call("GET", `/ops/requests/${none.body.id}`, {
      ...json,
      "x-ops-poll": none.body.pollToken,
    });
    assertEquals(st.body.status, "no_match");
    assertEquals(
      (await call("POST", "/ops/requests", json, { reason: "x" })).status,
      400,
      "an account is required",
    );
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await call("POST", "/ops/requests", json, {
        account: "A2Z",
        reason: "x",
      });
      if (r.status === 429) limited++;
    }
    assert(limited > 0, "a flood is refused");
    assert(sent.length <= 10, `at most 10 texts an hour (${sent.length})`);
  } finally {
    await app.close();
    await resetKv();
  }
});
