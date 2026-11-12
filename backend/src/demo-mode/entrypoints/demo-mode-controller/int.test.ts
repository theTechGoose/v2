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
import {
  parseServerMessage,
  PRESENTER_COLORS,
  type ServerMessage,
} from "#demo-mode/protocol.ts";

@Module({ imports: [UsersModule, DemoModeModule] })
class TestApp {}
/** a free port, so parallel worktrees running this file never collide */
const PORT = (() => {
  const l = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
})();
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

/** REQ-232 — the socket id a welcome names */
const cidOf = (m: ServerMessage) => m.t === "welcome" ? m.cid : undefined;
/** REQ-232 — nothing more arrives on `s` within `ms` */
async function quiet(
  s: ReturnType<typeof open>,
  what: string,
  ms = 300,
): Promise<void> {
  const got = await s.next(what, ms).then((m) => m, () => null);
  assertEquals(got, null, `${what}: nothing more`);
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
        // REQ-214 — who is presenting, each with their colour
        presenters: [{
          userId: hans.body.userId,
          name: "Hans",
          color: PRESENTER_COLORS[0],
        }],
      },
      targetPath: null,
      pid: null,
    });
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(carl.body.sessionId),
      )).body,
      { role: null, session: null, targetPath: null, pid: null },
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
      { role: null, session: null, targetPath: null, pid: null },
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
    // REQ-232 — every welcome names its own socket
    const pc = cidOf(w1);
    assert(typeof pc === "string" && pc.length > 8);
    assertEquals(w1, {
      t: "welcome",
      role: "presenter",
      sessionId: made.body.id,
      peerOnline: false,
      pid: hans.body.userId,
      cid: pc,
    });
    const viewer = open(made.body.id, ana.body.sessionId);
    const w2 = await viewer.next("the viewer's welcome");
    const vc = cidOf(w2);
    assert(typeof vc === "string" && vc !== pc);
    assertEquals(w2, {
      t: "welcome",
      role: "viewer",
      sessionId: made.body.id,
      peerOnline: true,
      cid: vc,
    });
    // REQ-214 — after the welcome the viewer is told which presenters are here, by pid (and
    // REQ-232 — by socket)
    assertEquals(await viewer.next("who is presenting"), {
      t: "peer",
      online: true,
      pid: hans.body.userId,
      cid: pc,
    });
    assertEquals(await presenter.next("the presenter hears the viewer"), {
      t: "peer",
      online: true,
      cid: vc,
    });

    // a signal with no address (a client from before REQ-232) still reaches the other side
    presenter.send({ t: "signal", data: { type: "offer", sdp: "v=0" } });
    assertEquals(await viewer.next("the offer"), {
      t: "signal",
      from: "presenter",
      pid: hans.body.userId,
      cid: pc,
      data: { type: "offer", sdp: "v=0" },
    });
    viewer.send({ t: "signal", data: { type: "answer", sdp: "v=1" } });
    assertEquals(await presenter.next("the answer"), {
      t: "signal",
      from: "viewer",
      cid: vc,
      data: { type: "answer", sdp: "v=1" },
    });
    viewer.send({ t: "relay", data: { k: "view", v: { path: "/customers" } } });
    assertEquals(await presenter.next("the view"), {
      t: "relay",
      from: "viewer",
      cid: vc,
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
      pid: hans.body.userId,
      cid: pc,
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
      pid: hans.body.userId,
      cid: pc,
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
      { role: null, session: null, targetPath: null, pid: null },
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
      { role: null, session: null, targetPath: null, pid: null },
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
      { role: null, session: null, targetPath: null, pid: null },
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
      { role: null, session: null, targetPath: null, pid: null },
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

Deno.test("REQ-214 two staff present to one customer: the second Demo joins the live demo; active lists both with distinct colours and the caller's pid; the sockets stamp and route; a demo for another customer leaves the first (and ends it when nobody is left); End ends it for all", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553041");
    await call(
      "PUT",
      "/api/me",
      { name: "Ana Torres", language: "en" },
      H(ana.body.sessionId),
    );
    const bo = await signIn(call, "+15125553042");
    const hans = await signIn(call, "+15125553043");
    await call(
      "PUT",
      "/api/me",
      { name: "Hans", language: "en" },
      H(hans.body.sessionId),
    );
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553043" });
    const lia = await signIn(call, "+15125553044");
    await call(
      "PUT",
      "/api/me",
      { name: "Lia", language: "en" },
      H(lia.body.sessionId),
    );
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553044" });
    const A = H(ana.body.sessionId);
    const P = H(hans.body.sessionId);
    const L = H(lia.body.sessionId);

    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(made.status, 201, JSON.stringify(made.body));
    // Lia clicks Demo on Ana too: she JOINS Hans's demo
    const joined = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, L);
    assertEquals(joined.status, 200, JSON.stringify(joined.body));
    assertEquals(joined.body.id, made.body.id);

    const forAna = await call("GET", "/api/demo-mode/active", undefined, A);
    assertEquals(forAna.body.role, "viewer");
    assertEquals(forAna.body.pid, null);
    assertEquals(forAna.body.session.presenterName, "Hans");
    assertEquals(forAna.body.session.presenters, [
      { userId: hans.body.userId, name: "Hans", color: PRESENTER_COLORS[0] },
      { userId: lia.body.userId, name: "Lia", color: PRESENTER_COLORS[1] },
    ], "both presenters, each with a colour of their own");
    const forLia = await call("GET", "/api/demo-mode/active", undefined, L);
    assertEquals(forLia.body.role, "presenter");
    assertEquals(
      forLia.body.pid,
      lia.body.userId,
      "the caller's own presenter id",
    );
    assertEquals(forLia.body.session.id, made.body.id);
    const imp = await call(
      "POST",
      `/api/admin/impersonate/${ana.body.userId}`,
      undefined,
      L,
    );
    assertEquals(imp.status, 200, JSON.stringify(imp.body));
    const I = H(imp.body.sessionId);
    const fromImp = await call("GET", "/api/demo-mode/active", undefined, I);
    assertEquals(fromImp.body.role, "presenter");
    assertEquals(
      fromImp.body.pid,
      lia.body.userId,
      "impersonating Ana, Lia is still Lia",
    );

    // the sockets: Hans on his own session, Lia impersonating, then Ana
    // REQ-232 — every message below also names the socket it is from (or about)
    const ph = open(made.body.id, hans.body.sessionId);
    const hw = await ph.next("Hans's welcome");
    const hc = cidOf(hw);
    assertEquals(hw, {
      t: "welcome",
      role: "presenter",
      sessionId: made.body.id,
      peerOnline: false,
      pid: hans.body.userId,
      cid: hc,
    });
    const pl = open(made.body.id, imp.body.sessionId);
    const lw = await pl.next("Lia's welcome");
    const lc = cidOf(lw);
    assertEquals(lw, {
      t: "welcome",
      role: "presenter",
      sessionId: made.body.id,
      peerOnline: false,
      pid: lia.body.userId,
      cid: lc,
    });
    assertEquals(await pl.next("Lia is told Hans is here"), {
      t: "peer",
      online: true,
      pid: hans.body.userId,
      cid: hc,
    });
    assertEquals(await ph.next("Hans hears Lia arrive"), {
      t: "peer",
      online: true,
      pid: lia.body.userId,
      cid: lc,
    });
    const v = open(made.body.id, ana.body.sessionId);
    const aw = await v.next("Ana's welcome");
    const vc = cidOf(aw);
    assertEquals(aw, {
      t: "welcome",
      role: "viewer",
      sessionId: made.body.id,
      peerOnline: true,
      cid: vc,
    });
    assertEquals(await v.next("who is here: Hans"), {
      t: "peer",
      online: true,
      pid: hans.body.userId,
      cid: hc,
    });
    assertEquals(await v.next("who is here: Lia"), {
      t: "peer",
      online: true,
      pid: lia.body.userId,
      cid: lc,
    });
    assertEquals(await ph.next("Hans hears Ana"), {
      t: "peer",
      online: true,
      cid: vc,
    });
    assertEquals(await pl.next("Lia hears Ana"), {
      t: "peer",
      online: true,
      cid: vc,
    });

    // Hans's click: Ana and Lia get it stamped hans
    ph.send({ t: "relay", data: { k: "click", a: { vx: 0.2, vy: 0.3 } } });
    const click: ServerMessage = {
      t: "relay",
      from: "presenter",
      pid: hans.body.userId,
      cid: hc,
      data: { k: "click", a: { vx: 0.2, vy: 0.3 } },
    };
    assertEquals(await v.next("Ana gets Hans's click"), click);
    assertEquals(await pl.next("Lia gets Hans's click"), click);
    // Lia's pointer for her colleagues only: Hans gets it, Ana never (her next message is Hans's next click)
    pl.send({ t: "relay", data: { k: "leave" }, to: "presenters" });
    assertEquals(await ph.next("Hans gets Lia's leave"), {
      t: "relay",
      from: "presenter",
      pid: lia.body.userId,
      cid: lc,
      data: { k: "leave" },
    });
    ph.send({ t: "relay", data: { k: "click", a: { vx: 0.5, vy: 0.5 } } });
    assertEquals(
      await v.next(
        "Ana's next message is Hans's second click, not Lia's leave",
      ),
      {
        ...click,
        data: { k: "click", a: { vx: 0.5, vy: 0.5 } },
      },
    );
    await pl.next("Lia gets it too");
    // Ana's signal addressed to Lia (REQ-232: to her stage's socket) reaches Lia only; Ana's
    // move reaches both
    v.send({
      t: "signal",
      data: { type: "answer", sdp: "v=1" },
      to: lc,
    });
    assertEquals(await pl.next("Lia gets the answer"), {
      t: "signal",
      from: "viewer",
      cid: vc,
      data: { type: "answer", sdp: "v=1" },
    });
    v.send({ t: "relay", data: { k: "move", a: { vx: 0.1, vy: 0.1 } } });
    const move: ServerMessage = {
      t: "relay",
      from: "viewer",
      cid: vc,
      data: { k: "move", a: { vx: 0.1, vy: 0.1 } },
    };
    assertEquals(
      await ph.next("Hans gets Ana's move (and never the answer for Lia)"),
      move,
    );
    assertEquals(await pl.next("Lia gets Ana's move"), move);

    // Lia opens a demo for Bo: she leaves Ana's demo, which goes on with Hans
    const other = await call("POST", "/api/demo-mode/sessions", {
      userId: bo.body.userId,
    }, L);
    assertEquals(other.status, 201, JSON.stringify(other.body));
    assert(other.body.id !== made.body.id);
    assertEquals(await ph.next("Hans hears Lia go"), {
      t: "peer",
      online: false,
      pid: lia.body.userId,
    });
    assertEquals(await v.next("Ana hears Lia go"), {
      t: "peer",
      online: false,
      pid: lia.body.userId,
    });
    await pl.closed;
    const still = await call("GET", "/api/demo-mode/active", undefined, A);
    assertEquals(still.body.session.id, made.body.id, "Ana's demo goes on");
    assertEquals(
      still.body.session.presenters.map((p: { name: string }) => p.name),
      ["Hans"],
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, L)).body.session
        .id,
      other.body.id,
    );
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(bo.body.sessionId),
      )).body.session.presenters,
      [
        { userId: lia.body.userId, name: "Lia", color: PRESENTER_COLORS[0] },
      ],
      "a fresh demo starts the palette over",
    );

    // Hans ends: everyone on Ana's demo hears it; Lia's demo for Bo is untouched
    ph.send({ t: "end" });
    assertEquals(await v.next("Ana hears the end"), {
      t: "ended",
      by: "presenter",
    });
    assertEquals(await ph.next("Hans hears it too"), {
      t: "ended",
      by: "presenter",
    });
    await v.closed;
    await ph.closed;
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, A)).body,
      { role: null, session: null, targetPath: null, pid: null },
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, L)).body.session
        .id,
      other.body.id,
    );

    // the last presenter leaving ends a demo: Lia opens one for Ana again, so Bo's is over
    const again = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, L);
    assertEquals(again.status, 201);
    assertEquals(
      (await call(
        "GET",
        "/api/demo-mode/active",
        undefined,
        H(bo.body.sessionId),
      )).body.session,
      null,
      "nobody left on Bo's demo: it ended",
    );
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, A)).body.session
        .id,
      again.body.id,
    );
  });
});

Deno.test("REQ-232 two customer tabs over the composed router's socket: each welcome names its own cid; the stage hears each tab by cid; an offer addressed to tab 1 reaches tab 1 only and the answer the stage only; a claim and a sync cross; tab 2 closing tells the stage that tab 2 left while tab 1 stays", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553051");
    const hans = await signIn(call, "+15125553052");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553052" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const stage = open(made.body.id, hans.body.sessionId);
    const ws = await stage.next("the stage's welcome");
    const sc = cidOf(ws);
    assert(
      typeof sc === "string" && sc.length > 8,
      `the stage's welcome names its socket (${JSON.stringify(ws)})`,
    );
    const tab1 = open(made.body.id, ana.body.sessionId);
    const c1 = cidOf(await tab1.next("tab 1's welcome"));
    assertEquals(await tab1.next("tab 1 is told the stage is here"), {
      t: "peer",
      online: true,
      pid: hans.body.userId,
      cid: sc,
    });
    assertEquals(await stage.next("tab 1 arrives"), {
      t: "peer",
      online: true,
      cid: c1,
    });
    const tab2 = open(made.body.id, ana.body.sessionId);
    const c2 = cidOf(await tab2.next("tab 2's welcome"));
    assert(c1 && c2 && c1 !== c2, "each tab has its own socket id");
    await tab2.next("tab 2 is told the stage is here");
    assertEquals(await stage.next("tab 2 arrives"), {
      t: "peer",
      online: true,
      cid: c2,
    });

    stage.send({ t: "signal", data: { type: "offer", sdp: "v=0" }, to: c1 });
    assertEquals(await tab1.next("the offer"), {
      t: "signal",
      from: "presenter",
      pid: hans.body.userId,
      cid: sc,
      data: { type: "offer", sdp: "v=0" },
    });
    tab1.send({ t: "signal", data: { type: "answer", sdp: "v=1" }, to: sc });
    assertEquals(await stage.next("the answer"), {
      t: "signal",
      from: "viewer",
      cid: c1,
      data: { type: "answer", sdp: "v=1" },
    });
    tab2.send({ t: "claim", at: 1234 });
    assertEquals(await stage.next("tab 2's claim"), {
      t: "claim",
      cid: c2,
      at: 1234,
    });
    stage.send({ t: "sync", to: c2 });
    assertEquals(await tab2.next("the stage asks tab 2 for its view"), {
      t: "sync",
    });
    await tab2.close();
    assertEquals(await stage.next("tab 2 left — tab 2 only"), {
      t: "peer",
      online: false,
      cid: c2,
    });
    // tab 1 is still in: its view reaches the stage, stamped tab 1
    tab1.send({ t: "relay", data: { k: "view", v: { path: "/customers" } } });
    assertEquals(await stage.next("tab 1's view"), {
      t: "relay",
      from: "viewer",
      cid: c1,
      data: { k: "view", v: { path: "/customers" } },
    });
    await quiet(tab1, "tab 1 got nothing meant for tab 2");
    await stage.close();
    await tab1.close();
  });
});

Deno.test("REQ-232 POST /demo-mode/sessions/:id/leave — the customer may not (403), a stranger neither (403), an unknown demo is 404; a presenter with a colleague leaves: the colleague and the customer hear them go and the demo goes on; the last presenter leaving ends it for everyone", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553061");
    const hans = await signIn(call, "+15125553062");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553062" });
    const lia = await signIn(call, "+15125553063");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553063" });
    const carl = await signIn(call, "+15125553064");
    const A = H(ana.body.sessionId);
    const P = H(hans.body.sessionId);
    const L = H(lia.body.sessionId);
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(made.status, 201);
    assertEquals(
      (await call("POST", "/api/demo-mode/sessions", {
        userId: ana.body.userId,
      }, L)).body.id,
      made.body.id,
      "Lia joins Hans's demo",
    );
    const id = made.body.id;
    const ph = open(id, hans.body.sessionId);
    const hc = cidOf(await ph.next("Hans's welcome"));
    const pl = open(id, lia.body.sessionId);
    await pl.next("Lia's welcome");
    await pl.next("Lia is told Hans is here");
    await ph.next("Hans hears Lia arrive");
    const v = open(id, ana.body.sessionId);
    await v.next("Ana's welcome");
    await v.next("Ana is told of Hans");
    await v.next("Ana is told of Lia");
    await ph.next("Hans hears Ana");
    await pl.next("Lia hears Ana");

    assertEquals(
      (await call("POST", `/api/demo-mode/sessions/${id}/leave`, undefined, A))
        .status,
      403,
      "the customer ends a demo, never leaves it",
    );
    assertEquals(
      (await call(
        "POST",
        `/api/demo-mode/sessions/${id}/leave`,
        undefined,
        H(carl.body.sessionId),
      )).status,
      403,
    );
    assertEquals(
      (await call("POST", `/api/demo-mode/sessions/nope/leave`, undefined, P))
        .status,
      404,
    );

    // Lia leaves: Hans and Ana hear her go; her socket is closed; the demo goes on with Hans
    const left = await call(
      "POST",
      `/api/demo-mode/sessions/${id}/leave`,
      undefined,
      L,
    );
    assertEquals(left.status, 200, JSON.stringify(left.body));
    assertEquals(await ph.next("Hans hears Lia go"), {
      t: "peer",
      online: false,
      pid: lia.body.userId,
    });
    assertEquals(await v.next("Ana hears Lia go"), {
      t: "peer",
      online: false,
      pid: lia.body.userId,
    });
    await pl.closed;
    assertEquals(
      (await call("GET", "/api/demo-mode/active", undefined, L)).body,
      { role: null, session: null, targetPath: null, pid: null },
      "Lia is out of it",
    );
    const still = await call("GET", "/api/demo-mode/active", undefined, A);
    assertEquals(still.body.session.id, id, "the demo goes on");
    assertEquals(
      still.body.session.presenters.map((p: { userId: string }) => p.userId),
      [hans.body.userId],
    );

    // Hans, the last one, leaves: it ends for everyone
    assertEquals(
      (await call("POST", `/api/demo-mode/sessions/${id}/leave`, undefined, P))
        .status,
      200,
    );
    assertEquals(await v.next("Ana hears the end"), {
      t: "ended",
      by: "presenter",
    });
    assertEquals(await ph.next("Hans hears it too"), {
      t: "ended",
      by: "presenter",
    });
    await v.closed;
    await ph.closed;
    for (const who of [A, P]) {
      assertEquals(
        (await call("GET", "/api/demo-mode/active", undefined, who)).body,
        { role: null, session: null, targetPath: null, pid: null },
      );
    }
    assert(hc, "Hans's stage had its own cid");
    assertEquals(
      (await call("POST", `/api/demo-mode/sessions/${id}/leave`, undefined, P))
        .status,
      403,
      "a demo you are not on any more",
    );
  });
});

Deno.test("REQ-232 the same staff account opens a second stage: the first is told it is replaced and its socket closes; the customer hears the first stage go and the second arrive", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553071");
    const hans = await signIn(call, "+15125553072");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553072" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    // window 2: the same account in another window (an impersonation session — the same pid)
    const imp = await call(
      "POST",
      `/api/admin/impersonate/${ana.body.userId}`,
      undefined,
      H(hans.body.sessionId),
    );
    assertEquals(imp.status, 200, JSON.stringify(imp.body));
    const w1 = open(made.body.id, hans.body.sessionId);
    const c1 = cidOf(await w1.next("window 1's welcome"));
    const v = open(made.body.id, ana.body.sessionId);
    const vc = cidOf(await v.next("Ana's welcome"));
    assertEquals(await v.next("Ana is told of window 1"), {
      t: "peer",
      online: true,
      pid: hans.body.userId,
      cid: c1,
    });
    await w1.next("window 1 hears Ana");

    const w2 = open(made.body.id, imp.body.sessionId);
    const c2 = cidOf(await w2.next("window 2's welcome"));
    assert(c2 && c2 !== c1, "window 2 is a socket of its own");
    assertEquals(await w1.next("window 1 is replaced"), { t: "replaced" });
    await w1.closed;
    const norm = (m: ServerMessage) =>
      m.t === "peer" ? `${m.online}|${m.pid}|${m.cid}` : JSON.stringify(m);
    const heard = [await v.next("Ana hears…"), await v.next("… both")];
    assertEquals(
      new Set(heard.map(norm)),
      new Set([
        `true|${hans.body.userId}|${c2}`,
        `false|${hans.body.userId}|${c1}`,
      ]),
      "Ana hears window 2 come and window 1 go",
    );
    assertEquals(await w2.next("window 2 is told Ana is here"), {
      t: "peer",
      online: true,
      cid: vc,
    });
    await quiet(w2, "window 2 is never told of its own account");
    await w2.close();
    await v.close();
  });
});
