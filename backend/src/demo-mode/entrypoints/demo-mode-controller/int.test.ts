/**
 * REQ-153 — demo mode over HTTP and WebSocket, in process on an in-memory KV, through the SAME
 * composed router the deploy runs: a super admin opens a demo for a user; the user's `active`
 * names the presenter; a stranger sees none; the presenter's impersonation session and the
 * user's session connect over `/api/demo-mode/ws`; a signal and a relay cross both ways with
 * `from`; a stranger's socket is refused; end tells both and clears `active`.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { DemoModeModule } from "@demo-mode/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { composeRouter } from "../../../../../compose-router.ts";
import { parseServerMessage, type ServerMessage } from "#demo-mode/protocol.ts";

@Module({ imports: [UsersModule, DemoModeModule] })
class TestApp {}
const PORT = 9193;
const J = { "content-type": "application/json" };
// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(SmsService).send = () => Promise.resolve({ ok: true });
  const hono = (app as unknown as {
    app: { fetch: (r: Request) => Response | Promise<Response> };
  }).app;
  const handler = composeRouter({
    backendFetch: (r) => hono.fetch(r),
    frontendFetch: () => new Response("not here", { status: 404 }),
  });
  const ac = new AbortController();
  const srv = Deno.serve(
    { port: PORT, signal: ac.signal, onListen: () => {} },
    handler,
  );
  const call: Call = async (method, path, body, headers = {}) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed };
  };
  try {
    await fn(call);
  } finally {
    ac.abort();
    await srv.finished;
    await app.close();
    await resetKv();
  }
}

async function signIn(call: Call, phone: string) {
  await call("POST", "/api/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  return await call("POST", "/api/auth/verify", {
    phoneNumber: phone,
    code: stored!.code,
  });
}
const H = (sessionId: string) => ({ "x-session-id": sessionId });

/** a socket whose messages queue up; `next()` waits for the next one */
function open(sessionId: string, token: string) {
  const ws = new WebSocket(
    `ws://localhost:${PORT}/api/demo-mode/ws?session=${sessionId}&token=${token}`,
  );
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  let failed = false;
  const closed = new Promise<void>((r) => (ws.onclose = () => r()));
  ws.onerror = () => {
    failed = true;
  };
  ws.onmessage = (e) => {
    const m = parseServerMessage(String(e.data));
    if (!m) throw new Error(`unparseable: ${e.data}`);
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  };
  const next = (what: string, ms = 4000): Promise<ServerMessage> => {
    const q = queue.shift();
    if (q) return Promise.resolve(q);
    return new Promise((res, rej) => {
      const t = setTimeout(
        () => rej(new Error(`timed out waiting for ${what}`)),
        ms,
      );
      waiters.push((m) => {
        clearTimeout(t);
        res(m);
      });
    });
  };
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const close = async () => {
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    await closed;
  };
  return { ws, next, send, close, closed, failed: () => failed };
}

Deno.test("REQ-153 a super admin opens a demo for a user; the user sees it on active with the presenter's name; a stranger sees none and may not open one", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553001");
    await call(
      "PUT",
      "/api/me",
      { name: "Ana Torres", language: "en" },
      H(ana.body.sessionId),
    );
    const hans = await signIn(call, "+15125553002");
    await call(
      "PUT",
      "/api/me",
      { name: "Hans", language: "en" },
      H(hans.body.sessionId),
    );
    assertEquals(
      (await call("POST", "/api/admin/bootstrap", {
        phoneNumber: "+15125553002",
      })).status,
      200,
    );
    const carl = await signIn(call, "+15125553003");

    assertEquals(
      (await call("POST", "/api/demo-mode/sessions", {
        userId: ana.body.userId,
      }, H(carl.body.sessionId))).status,
      403,
      "a plain user may not open a demo",
    );
    assertEquals(
      (await call("POST", "/api/demo-mode/sessions", {
        userId: ana.body.userId,
      })).status,
      401,
    );
    assertEquals(
      (await call(
        "POST",
        "/api/demo-mode/sessions",
        { userId: "nobody" },
        H(hans.body.sessionId),
      )).status,
      404,
    );

    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    assertEquals(made.status, 201, JSON.stringify(made.body));
    assertEquals(made.body.targetUserId, ana.body.userId);
    assert(typeof made.body.id === "string" && made.body.id.length > 8);

    const active = await call(
      "GET",
      "/api/demo-mode/active",
      undefined,
      H(ana.body.sessionId),
    );
    assertEquals(active.status, 200);
    assertEquals(active.body, {
      role: "viewer",
      session: {
        id: made.body.id,
        presenterName: "Hans",
        targetName: "Ana Torres",
        targetUserId: ana.body.userId,
      },
      targetPath: null,
    });
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(carl.body.sessionId),
      )).body,
      { role: null, session: null, targetPath: null },
    );
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(hans.body.sessionId),
      )).body.role,
      "presenter",
      "the admin on their own session",
    );
    assertEquals((await call("GET", "/api/demo-mode/active")).status, 401);

    // a second Demo for the same user while the first is live is that same demo (AMENDMENT — same screen at once)
    const again = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    assertEquals(again.status, 200);
    assertEquals(again.body.id, made.body.id);
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(ana.body.sessionId),
      )).body.session.id,
      again.body.id,
    );
    assertEquals(
      (await call(
        "POST",
        `/api/demo-mode/sessions/${made.body.id}/end`,
        undefined,
        H(carl.body.sessionId),
      )).status,
      403,
    );
    assertEquals(
      (await call(
        "POST",
        `/api/demo-mode/sessions/nope/end`,
        undefined,
        H(hans.body.sessionId),
      )).status,
      404,
    );
    assertEquals(
      (await call(
        "POST",
        `/api/demo-mode/sessions/${again.body.id}/end`,
        undefined,
        H(ana.body.sessionId),
      )).status,
      200,
      "the viewer may end it",
    );
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(ana.body.sessionId),
      )).body,
      { role: null, session: null, targetPath: null },
    );
  });
});

Deno.test("REQ-153 the presenter (impersonating) and the viewer connect over the composed router's socket; signal and relay cross both ways with from; a stranger is refused; end tells both", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553011");
    const hans = await signIn(call, "+15125553012");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553012" });
    const carl = await signIn(call, "+15125553013");
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const imp = await call(
      "POST",
      `/api/admin/impersonate/${ana.body.userId}`,
      undefined,
      H(hans.body.sessionId),
    );
    assertEquals(imp.status, 200, JSON.stringify(imp.body));
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(imp.body.sessionId),
      )).body.role,
      "presenter",
      "the impersonation session presents",
    );

    const stranger = open(made.body.id, carl.body.sessionId);
    await stranger.closed;
    assert(stranger.failed(), "a stranger's socket never opens");
    const nobody = open("no-such-demo", ana.body.sessionId);
    await nobody.closed;
    assert(nobody.failed(), "an unknown demo never opens");

    const presenter = open(made.body.id, imp.body.sessionId);
    const w1 = await presenter.next("the presenter's welcome");
    assertEquals(w1, {
      t: "welcome",
      role: "presenter",
      sessionId: made.body.id,
      peerOnline: false,
    });
    const viewer = open(made.body.id, ana.body.sessionId);
    const w2 = await viewer.next("the viewer's welcome");
    assertEquals(w2, {
      t: "welcome",
      role: "viewer",
      sessionId: made.body.id,
      peerOnline: true,
    });
    assertEquals(await presenter.next("the presenter hears the viewer"), {
      t: "peer",
      online: true,
    });

    presenter.send({ t: "signal", data: { type: "offer", sdp: "v=0" } });
    assertEquals(await viewer.next("the offer"), {
      t: "signal",
      from: "presenter",
      data: { type: "offer", sdp: "v=0" },
    });
    viewer.send({ t: "signal", data: { type: "answer", sdp: "v=1" } });
    assertEquals(await presenter.next("the answer"), {
      t: "signal",
      from: "viewer",
      data: { type: "answer", sdp: "v=1" },
    });
    viewer.send({ t: "relay", data: { k: "view", v: { path: "/customers" } } });
    assertEquals(await presenter.next("the view"), {
      t: "relay",
      from: "viewer",
      data: { k: "view", v: { path: "/customers" } },
    });
    presenter.send({
      t: "relay",
      data: {
        k: "click",
        a: { sel: "#save", fx: 0.5, fy: 0.5, vx: 0.2, vy: 0.3 },
      },
    });
    // REQ-188: a pointer is the viewport fraction only — whatever else rode along is dropped
    assertEquals(await viewer.next("the click"), {
      t: "relay",
      from: "presenter",
      data: { k: "click", a: { vx: 0.2, vy: 0.3 } },
    });
    presenter.send("junk");
    presenter.send({
      t: "relay",
      data: { k: "view", v: { path: "https://evil.example/" } },
    });
    presenter.send({ t: "relay", data: { k: "leave" } });
    assertEquals(await viewer.next("only the good message after junk"), {
      t: "relay",
      from: "presenter",
      data: { k: "leave" },
    });

    viewer.send({ t: "end" });
    assertEquals(await presenter.next("the end"), { t: "ended", by: "viewer" });
    assertEquals(await viewer.next("the viewer's own end"), {
      t: "ended",
      by: "viewer",
    });
    await presenter.closed;
    await viewer.closed;
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(ana.body.sessionId),
      )).body,
      { role: null, session: null, targetPath: null },
    );
    const late = open(made.body.id, ana.body.sessionId);
    await late.closed;
    assert(late.failed(), "an ended demo takes no socket");
  });
});

Deno.test("REQ-153 AMENDMENT — Not now: the viewer declines over HTTP and the presenter's socket hears ended with the reason", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553021");
    const hans = await signIn(call, "+15125553022");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553022" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const presenter = open(made.body.id, hans.body.sessionId);
    await presenter.next("welcome");
    const declined = await call(
      "POST",
      `/api/demo-mode/sessions/${made.body.id}/end`,
      { reason: "declined" },
      H(ana.body.sessionId),
    );
    assertEquals(declined.status, 200);
    assertEquals(await presenter.next("the decline"), {
      t: "ended",
      by: "viewer",
      reason: "declined",
    });
    await presenter.closed;
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(hans.body.sessionId),
      )).body,
      { role: null, session: null, targetPath: null },
    );
  });
});

Deno.test("REQ-153 AMENDMENT — same screen at once: the customer's poll records their page; the presenter's active says where they are; an impersonation session's poll does not; a repeat Demo for the same user is the same live demo; a demo for another user ends it", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553031");
    const bo = await signIn(call, "+15125553032");
    const hans = await signIn(call, "+15125553033");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553033" });
    const A = H(ana.body.sessionId);
    const P = H(hans.body.sessionId);

    // the customer's app has been saying where it is on every poll, before any demo exists
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active?path=%2Fcustomers%3Ftab%3Dall",
        undefined,
        A,
      )).body,
      { role: null, session: null, targetPath: null },
    );
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(made.status, 201, JSON.stringify(made.body));
    // REQ-179 — the start answer itself says where the customer is: no second ask before moving
    assertEquals(made.body.targetPath, "/customers?tab=all");
    // the presenter learns it at once
    const mine = await call("GET", "/api/demo-mode/active", undefined, P);
    assertEquals(mine.body.role, "presenter");
    assertEquals(
      mine.body.targetPath,
      "/customers?tab=all",
      "where the customer is",
    );
    // the customer never sees a targetPath
    const theirs = await call(
      "GET",
      "/api/demo-mode/active?path=%2Fassistant",
      undefined,
      A,
    );
    assertEquals(theirs.body.role, "viewer");
    assertEquals(theirs.body.targetPath, null);
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, P)).body
        .targetPath,
      "/assistant",
      "it follows the customer's latest poll",
    );

    // the presenter impersonates the customer and polls from there: that must not move the customer's page
    const imp = await call(
      "POST",
      `/api/admin/impersonate/${ana.body.userId}`,
      undefined,
      P,
    );
    assertEquals(imp.status, 200, JSON.stringify(imp.body));
    const I = H(imp.body.sessionId);
    const fromImp = await call(
      "GET",
      "/api/demo-mode/active?path=%2Fadmin",
      undefined,
      I,
    );
    assertEquals(fromImp.body.role, "presenter");
    assertEquals(
      fromImp.body.targetPath,
      "/assistant",
      "the impersonating poll reads, never writes",
    );
    // junk paths are not recorded
    await call(
      "GET",
      "/api/demo-mode/active?path=https%3A%2F%2Fevil.example%2F",
      undefined,
      A,
    );
    await call(
      "GET",
      "/api/demo-mode/active?path=%2F%2Fevil.example%2F",
      undefined,
      A,
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, P)).body
        .targetPath,
      "/assistant",
    );

    // a repeat Demo click for the same customer is the SAME live demo (five clicks are one invitation)
    const again = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body.id, made.body.id);
    assertEquals(
      again.body.targetPath,
      "/assistant",
      "REQ-179 — the repeat answer says where they are too",
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, A)).body.session
        .id,
      made.body.id,
    );

    // Demo for another customer ends the first: Ana's invitation is gone, Bo's is on
    const other = await call("POST", "/api/demo-mode/sessions", {
      userId: bo.body.userId,
    }, P);
    assertEquals(other.status, 201);
    assert(other.body.id !== made.body.id);
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, A)).body,
      { role: null, session: null, targetPath: null },
    );
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(bo.body.sessionId),
      )).body.session.id,
      other.body.id,
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, P)).body.session
        .id,
      other.body.id,
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, P)).body
        .targetPath,
      null,
      "Bo's page is not known yet",
    );
  });
});
