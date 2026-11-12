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
import { DemoHub } from "@demo-mode/domain/coordinators/demo-hub/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { composeRouter } from "../../../../../compose-router.ts";
import {
  MIRROR_CHUNK_CHARS,
  parseServerMessage,
  PRESENTER_COLORS,
  type ServerMessage,
} from "#demo-mode/protocol.ts";
import { ChunkAssembler, chunkText, newLoadId } from "#demo-mode/mirror.ts";

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

async function withServer(
  fn: (call: Call, app: DanetApplication) => Promise<void>,
) {
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
    await fn(call, app);
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

/** REQ-227 (demo-lifecycle-p2) — a demo on yourself would make you both the customer and the presenter */
Deno.test("REQ-227 a super admin may not open a demo on their own account: 400, and no demo is open", async () => {
  await withServer(async (call) => {
    const hans = await signIn(call, "+15125553011");
    assertEquals(
      (await call("POST", "/api/admin/bootstrap", {
        phoneNumber: "+15125553011",
      })).status,
      200,
    );
    const self = await call("POST", "/api/demo-mode/sessions", {
      userId: hans.body.userId,
    }, H(hans.body.sessionId));
    assertEquals(
      self.status,
      400,
      `a demo on yourself is refused (${JSON.stringify(self.body)})`,
    );
    const active = await call(
      "GET",
      "/api/demo-mode/active",
      undefined,
      H(hans.body.sessionId),
    );
    assertEquals(active.body.session, null, "no demo was opened");
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
    // REQ-242 — the customer's screen crosses as mirror chunks (the old view patch is gone)
    const chunk = {
      k: "dom" as const,
      l: "lp0q1x2-ab12",
      s: 0,
      i: 0,
      n: 1,
      d: "{}",
    };
    viewer.send({ t: "relay", data: chunk });
    assertEquals(await presenter.next("the mirror chunk"), {
      t: "relay",
      from: "viewer",
      cid: vc,
      data: chunk,
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

    // Hans ends: everyone on Ana's demo hears it (REQ-235: and that it was Hans); Lia's demo for
    // Bo is untouched
    ph.send({ t: "end" });
    assertEquals(await v.next("Ana hears the end"), {
      t: "ended",
      by: "presenter",
      pid: hans.body.userId,
    });
    assertEquals(await ph.next("Hans hears it too"), {
      t: "ended",
      by: "presenter",
      pid: hans.body.userId,
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

Deno.test("REQ-242 the mirror crosses the composed router's relay: a 120 KB snapshot as dom chunks reassembles byte-identical on the presenter, in order; a presenter's resync reaches the viewer; oversized and malformed chunks are dropped", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553061");
    const hans = await signIn(call, "+15125553062");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553062" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    assertEquals(made.status, 201, JSON.stringify(made.body));
    const imp = await call(
      "POST",
      `/api/admin/impersonate/${ana.body.userId}`,
      undefined,
      H(hans.body.sessionId),
    );
    const presenter = open(made.body.id, imp.body.sessionId);
    const pc = cidOf(await presenter.next("the presenter's welcome"));
    const viewer = open(made.body.id, ana.body.sessionId);
    const vc = cidOf(await viewer.next("the viewer's welcome"));
    await viewer.next("who is presenting");
    await presenter.next("the presenter hears the viewer");

    // a snapshot-sized frame: quotes to escape, Spanish, an emoji (two-byte strings in the KV mail)
    const bubbles = Array.from({ length: 1_000 }, (_, i) => ({
      i: i + 10,
      t: "div",
      a: { class: "msg msg--user", "data-n": String(i) },
      c: [{ i: 100_000 + i, x: `Cambiar el fregadero “${i}” 🚰 — ¿listo?` }],
    }));
    const text = JSON.stringify({
      t: "snap",
      w: 420,
      h: 800,
      u: "/assistant/abc",
      root: { i: 1, t: "html", c: [{ i: 2, t: "body", c: bubbles }] },
      ops: [],
    });
    assert(text.length > 120_000, `the frame is big (${text.length} chars)`);
    const parts = chunkText(text);
    assert(parts.length >= 8, `cut into ${parts.length} chunks`);
    const l = newLoadId();
    parts.forEach((d, i) =>
      viewer.send({
        t: "relay",
        data: { k: "dom", l, s: 0, i, n: parts.length, d },
      })
    );
    const asm = new ChunkAssembler();
    let whole: { l: string; s: number; z: boolean; text: string } | null = null;
    for (let k = 0; k < parts.length; k++) {
      const m = await presenter.next(`chunk ${k}`);
      assertEquals(m.t, "relay");
      if (m.t !== "relay") return;
      assertEquals(m.from, "viewer");
      assertEquals(m.data.k, "dom");
      if (m.data.k !== "dom") return;
      assertEquals(m.data.i, k, "the relay keeps the order");
      whole = asm.push(m.data) ?? whole;
    }
    assert(whole, "every chunk arrived");
    assertEquals(whole!.text, text, "byte-identical");
    assertEquals(whole!.l, l);

    presenter.send({ t: "relay", data: { k: "resync" } });
    assertEquals(await viewer.next("the resync"), {
      t: "relay",
      from: "presenter",
      pid: hans.body.userId,
      cid: pc, // REQ-232 — every relay names its socket
      data: { k: "resync" },
    });

    // junk never crosses: a chunk over the size, an index past the count, a bad load id
    viewer.send({
      t: "relay",
      data: {
        k: "dom",
        l,
        s: 1,
        i: 0,
        n: 1,
        d: "x".repeat(MIRROR_CHUNK_CHARS + 1),
      },
    });
    viewer.send({
      t: "relay",
      data: { k: "dom", l, s: 2, i: 1, n: 1, d: "x" },
    });
    viewer.send({
      t: "relay",
      data: { k: "dom", l: "no spaces", s: 3, i: 0, n: 1, d: "x" },
    });
    viewer.send({ t: "relay", data: { k: "leave" } });
    assertEquals(await presenter.next("only the leave after the junk"), {
      t: "relay",
      from: "viewer",
      cid: vc,
      data: { k: "leave" },
    });
    await presenter.close();
    await viewer.close();
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
    const tab1Chunk = {
      k: "dom" as const,
      l: "lp0q1x2-ab12",
      s: 0,
      i: 0,
      n: 1,
      d: "/customers",
    };
    tab1.send({ t: "relay", data: tab1Chunk });
    assertEquals(await stage.next("tab 1's view"), {
      t: "relay",
      from: "viewer",
      cid: c1,
      data: tab1Chunk,
    });
    await quiet(tab1, "tab 1 got nothing meant for tab 2");
    await stage.close();
    await tab1.close();
  });
});

Deno.test("REQ-393 (demo M2, M8 — cycle 2) over the composed router's socket: a stage's leave and move addressed to one tab (`tab`) reach that tab only — never the customer's other tab — and an anchor off the shared screen (o: 1) crosses intact", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553931");
    const hans = await signIn(call, "+15125553932");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553932" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const stage = open(made.body.id, hans.body.sessionId);
    const sc = cidOf(await stage.next("the stage's welcome"));
    const tab1 = open(made.body.id, ana.body.sessionId);
    const c1 = cidOf(await tab1.next("tab 1's welcome"));
    await tab1.next("tab 1 is told the stage is here");
    await stage.next("tab 1 arrives");
    const tab2 = open(made.body.id, ana.body.sessionId);
    const c2 = cidOf(await tab2.next("tab 2's welcome"));
    await tab2.next("tab 2 is told the stage is here");
    await stage.next("tab 2 arrives");
    assert(c1 && c2 && sc, "every socket is named");

    // the stage follows tab 2 now: tab 1, the tab it left, hears its leave — tab 1 only
    stage.send({ t: "relay", data: { k: "leave" }, tab: c1 });
    assertEquals(await tab1.next("tab 1 hears the leave"), {
      t: "relay",
      from: "presenter",
      pid: hans.body.userId,
      cid: sc,
      data: { k: "leave" },
    });
    // the presenter's mouse is beside the frame: tab 2 gets the move, off its screen
    const off = {
      k: "move" as const,
      a: { vx: 0, vy: 0.4, o: 1 as const },
      t: 12,
    };
    stage.send({ t: "relay", data: off, tab: c2 });
    assertEquals(await tab2.next("tab 2 gets the off-screen move"), {
      t: "relay",
      from: "presenter",
      pid: hans.body.userId,
      cid: sc,
      data: off,
    });
    await quiet(tab1, "tab 1 never got tab 2's move");
    await quiet(tab2, "tab 2 never got tab 1's leave");
    await stage.close();
    await tab1.close();
    await tab2.close();
  });
});

Deno.test("REQ-292 M6 — a customer tab whose socket closes the instant it opens (before its welcome, while the join is still awaited) is announced to the stage as arrived and then gone: never a ghost tab that keeps the pill Live", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553061");
    const hans = await signIn(call, "+15125553062");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553062" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const stage = open(made.body.id, hans.body.sessionId);
    await stage.next("the stage's welcome");
    for (let i = 0; i < 5; i++) {
      // the tab's socket: closed as soon as it is open, before any frame from the server
      const ws = new WebSocket(
        `ws://localhost:${PORT}/api/demo-mode/ws?session=${made.body.id}&token=${ana.body.sessionId}`,
      );
      const closed = new Promise<void>((r) => (ws.onclose = () => r()));
      ws.onerror = () => {};
      ws.onopen = () => ws.close();
      await closed;
      const came = await stage.next(`tab ${i} arrives`);
      assert(
        came.t === "peer" && came.online && !("pid" in came),
        `tab ${i} arrives: ${JSON.stringify(came)}`,
      );
      const went = await stage.next(`tab ${i} leaves`, 1500);
      assertEquals(
        went,
        { t: "peer", online: false, cid: came.cid },
        `tab ${i}: closed mid-join, it must still be announced gone`,
      );
    }
    await stage.close();
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
    // REQ-235 — and hears it was Hans who ended it
    assertEquals(await v.next("Ana hears the end"), {
      t: "ended",
      by: "presenter",
      pid: hans.body.userId,
    });
    assertEquals(await ph.next("Hans hears it too"), {
      t: "ended",
      by: "presenter",
      pid: hans.body.userId,
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

Deno.test("REQ-235 who ended it rides `ended`: a colleague's HTTP End, a presenter's socket End and a presenter's Demo on another customer each name that presenter (pid); the customer's HTTP End names none", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553051");
    const bo = await signIn(call, "+15125553052");
    const hans = await signIn(call, "+15125553053");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553053" });
    const lia = await signIn(call, "+15125553054");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553054" });
    const P = H(hans.body.sessionId);
    const L = H(lia.body.sessionId);
    const open2 = async (demoId: string) => {
      const ph = open(demoId, hans.body.sessionId);
      await ph.next("Hans's welcome");
      const v = open(demoId, ana.body.sessionId);
      await v.next("Ana's welcome");
      return { ph, v };
    };
    const byOf = (who: string): ServerMessage => ({
      t: "ended",
      by: "presenter",
      pid: who,
    });

    // 1. Lia joins Hans's demo for Ana and ends it over HTTP: everyone hears it was Lia
    const first = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(first.status, 201, JSON.stringify(first.body));
    assertEquals(
      (await call("POST", "/api/demo-mode/sessions", {
        userId: ana.body.userId,
      }, L)).status,
      200,
      "Lia joins",
    );
    const one = await open2(first.body.id);
    await one.v.next("Ana is told Hans is here");
    await one.ph.next("Hans hears Ana");
    const endByLia = await call(
      "POST",
      `/api/demo-mode/sessions/${first.body.id}/end`,
      undefined,
      L,
    );
    assertEquals(endByLia.status, 200, JSON.stringify(endByLia.body));
    assertEquals(
      await one.v.next("Ana hears Lia ended it"),
      byOf(lia.body.userId),
    );
    assertEquals(
      await one.ph.next("Hans hears Lia ended it"),
      byOf(lia.body.userId),
    );
    await one.v.closed;
    await one.ph.closed;

    // 2. Hans ends a fresh demo from his socket: it was Hans
    const second = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(second.status, 201, JSON.stringify(second.body));
    const two = await open2(second.body.id);
    await two.v.next("Ana is told Hans is here");
    await two.ph.next("Hans hears Ana");
    two.ph.send({ t: "end" });
    assertEquals(
      await two.v.next("Ana hears Hans ended it"),
      byOf(hans.body.userId),
    );
    await two.v.closed;
    await two.ph.closed;

    // 3. Hans opens a demo for Bo while alone on Ana's: Ana's ends, in Hans's name
    const third = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, P);
    assertEquals(third.status, 201, JSON.stringify(third.body));
    const v3 = open(third.body.id, ana.body.sessionId);
    await v3.next("Ana's welcome");
    const forBo = await call("POST", "/api/demo-mode/sessions", {
      userId: bo.body.userId,
    }, P);
    assertEquals(forBo.status, 201, JSON.stringify(forBo.body));
    assertEquals(
      await v3.next("Ana hears her demo ended, by Hans"),
      byOf(hans.body.userId),
    );
    await v3.closed;

    // 4. Bo ends his own demo over HTTP: the presenter hears the customer ended it, no pid
    const ph4 = open(forBo.body.id, hans.body.sessionId);
    await ph4.next("Hans's welcome");
    const endByBo = await call(
      "POST",
      `/api/demo-mode/sessions/${forBo.body.id}/end`,
      undefined,
      H(bo.body.sessionId),
    );
    assertEquals(endByBo.status, 200, JSON.stringify(endByBo.body));
    assertEquals(await ph4.next("Hans hears Bo ended it"), {
      t: "ended",
      by: "viewer",
    });
    await ph4.closed;
  });
});

Deno.test("REQ-355 (demo cycle 1, m1 / setup-m8) the sign-in placeholder is never a demo name: a staff member who never set a name guides as DocuMonster, never 'Nuevo usuario'; an unnamed customer is their phone", async () => {
  await withServer(async (call) => {
    // both sign in and never set a name — each carries the seeded placeholder
    const ana = await signIn(call, "+15125553041");
    const hans = await signIn(call, "+15125553042");
    const me = await call("GET", "/api/me", undefined, H(hans.body.sessionId));
    assertEquals(
      me.body.name,
      "Nuevo usuario",
      "precondition: the placeholder is seeded at sign-in",
    );
    assertEquals(
      (await call("POST", "/api/admin/bootstrap", {
        phoneNumber: "+15125553042",
      })).status,
      200,
    );
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    assertEquals(made.status, 201, JSON.stringify(made.body));

    const forAna = await call(
      "GET",
      "/api/demo-mode/active",
      undefined,
      H(ana.body.sessionId),
    );
    assertEquals(forAna.body.session.presenterName, "DocuMonster");
    assertEquals(
      forAna.body.session.presenters.map((p: { name: string }) => p.name),
      ["DocuMonster"],
    );
    assertEquals(forAna.body.session.targetName, "+15125553041");
    const raw = JSON.stringify(forAna.body);
    assert(
      !raw.includes("Nuevo usuario") && !raw.includes("New user"),
      `no placeholder anywhere in the demo payload (${raw})`,
    );
  });
});

// REQ-296 — demo-loop cycle 1, issue nc-3: the two-hour expiry was silent (a KV `expireIn` and
// nothing else); over the composed router's socket both sides now hear `ended … expired`
Deno.test("REQ-296 a demo that reaches its TTL: the presenter's and the customer's sockets hear ended with reason expired and close; active is empty for both", async () => {
  Deno.env.set("DEMO_SESSION_TTL_MS", "1500");
  try {
    await withServer(async (call) => {
      const ana = await signIn(call, "+15125553041");
      const hans = await signIn(call, "+15125553042");
      await call("POST", "/api/admin/bootstrap", {
        phoneNumber: "+15125553042",
      });
      const made = await call("POST", "/api/demo-mode/sessions", {
        userId: ana.body.userId,
      }, H(hans.body.sessionId));
      assertEquals(made.status, 201);
      const presenter = open(made.body.id, hans.body.sessionId);
      await presenter.next("welcome");
      const customer = open(made.body.id, ana.body.sessionId);
      await customer.next("welcome");
      await customer.next("the presenter is here");
      await presenter.next("the customer arrived");
      const expired: ServerMessage = {
        t: "ended",
        by: "presenter",
        reason: "expired",
      };
      assertEquals(await presenter.next("the expiry", 4000), expired);
      assertEquals(await customer.next("the expiry", 4000), expired);
      await presenter.closed;
      await customer.closed;
      const none = { role: null, session: null, targetPath: null, pid: null };
      assertEquals(
        (await call(
          "GET",
          "/api/demo-mode/active",
          undefined,
          H(hans.body.sessionId),
        )).body,
        none,
      );
      assertEquals(
        (await call(
          "GET",
          "/api/demo-mode/active",
          undefined,
          H(ana.body.sessionId),
        )).body,
        none,
      );
    });
  } finally {
    Deno.env.delete("DEMO_SESSION_TTL_MS");
  }
});

Deno.test("REQ-391 (demo-loop cycle 2, M4 + m21) over the composed router's socket: a tab that says why it goes is announced gone WITH that reason — navigating, closing — one that says nothing without one, junk is ignored; a browser that asks the time is answered with the deploy's clock", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553091");
    const hans = await signIn(call, "+15125553092");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553092" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const stage = open(made.body.id, hans.body.sessionId);
    await stage.next("the stage's welcome");

    // the clock: the browser's own time comes back with the deploy's
    const before = Date.now();
    stage.send({ t: "time", c: 1234 });
    const tm = await stage.next("the deploy's time");
    assert(tm.t === "time", JSON.stringify(tm));
    assertEquals(tm.c, 1234);
    assert(
      tm.s >= before && tm.s <= Date.now(),
      `the deploy's clock (${tm.s}) is now`,
    );

    /** a tab joins, says `why` (or nothing), and closes: what the stage hears of it */
    const goes = async (why: unknown, what: string) => {
      const tab = open(made.body.id, ana.body.sessionId);
      const c = cidOf(await tab.next(`${what}: welcome`));
      await tab.next(`${what}: the stage is here`);
      assertEquals(await stage.next(`${what}: arrives`), {
        t: "peer",
        online: true,
        cid: c,
      });
      if (why !== undefined) tab.send({ t: "leaving", why });
      await tab.close();
      return { c, gone: await stage.next(`${what}: leaves`, 1500) };
    };
    const nav = await goes("navigating", "a page change");
    assertEquals(nav.gone, {
      t: "peer",
      online: false,
      cid: nav.c,
      why: "navigating",
    });
    const closing = await goes("closing", "a closed tab");
    assertEquals(closing.gone, {
      t: "peer",
      online: false,
      cid: closing.c,
      why: "closing",
    });
    const silent = await goes(undefined, "a tab that said nothing");
    assertEquals(silent.gone, { t: "peer", online: false, cid: silent.c });
    const junk = await goes("bored", "a tab that said junk");
    assertEquals(junk.gone, { t: "peer", online: false, cid: junk.c });
    await quiet(stage, "the leaving itself is never relayed");
    await stage.close();
  });
});

Deno.test("REQ-378 (demo-loop cycle 2, m22) a stage's socket gets its welcome and the tabs already here BEFORE any tab's answer to its arrival: a tab that sends its snapshot the instant it hears the stage is never ahead of the stage's welcome", async () => {
  await withServer(async (call, app) => {
    const ana = await signIn(call, "+15125553781");
    const hans = await signIn(call, "+15125553782");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553782" });
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const id = made.body.id as string;
    // the customer's tab, in the server's own hub: hearing a stage arrive it answers with its whole
    // view at once — the fastest a real tab can be
    const hub = app.get(DemoHub);
    const chunk = {
      k: "dom" as const,
      l: "lp0q1x2-ab12",
      s: 0,
      i: 0,
      n: 1,
      d: "{}",
    };
    const tab = {
      role: "viewer" as const,
      cid: "tab-m22",
      send: (m: ServerMessage) => {
        if (m.t === "peer" && m.online && m.pid) {
          void hub.send(id, { role: "viewer", cid: "tab-m22" }, {
            t: "relay",
            data: chunk,
          });
        }
      },
    };
    const joined = await hub.join(id, tab);
    const stage = open(id, hans.body.sessionId);
    const first = await stage.next("the stage's first frame");
    assertEquals(
      first.t,
      "welcome",
      `the welcome comes first, not the tab's snapshot: ${
        JSON.stringify(first)
      }`,
    );
    assertEquals(await stage.next("the tab already here"), {
      t: "peer",
      online: true,
      cid: "tab-m22",
    });
    assertEquals(await stage.next("the tab's snapshot"), {
      t: "relay",
      from: "viewer",
      cid: "tab-m22",
      data: chunk,
    });
    joined.leave();
    await stage.close();
  });
});

Deno.test("REQ-378 (demo-loop cycle 2, m22) the customer's app hears of a new demo at once: GET /demo-mode/active?wait= with no demo is held and answers the moment a demo is opened for them; with none it answers null when the wait is up; without wait it answers at once", async () => {
  await withServer(async (call) => {
    const ana = await signIn(call, "+15125553783");
    const hans = await signIn(call, "+15125553784");
    await call("POST", "/api/admin/bootstrap", { phoneNumber: "+15125553784" });

    let t0 = Date.now();
    const plain = await call(
      "GET",
      "/api/demo-mode/active?path=/dashboard",
      undefined,
      H(ana.body.sessionId),
    );
    assertEquals(plain.status, 200);
    assertEquals(plain.body.session, null);
    assert(Date.now() - t0 < 1000, "no wait: answered at once");

    t0 = Date.now();
    const none = await call(
      "GET",
      "/api/demo-mode/active?path=/dashboard&wait=800",
      undefined,
      H(ana.body.sessionId),
    );
    const took = Date.now() - t0;
    assertEquals(none.body.session, null);
    assert(took >= 700, `held for the wait when nothing starts (${took} ms)`);

    // the customer's ask is out, held; the demo opens 600 ms later
    t0 = Date.now();
    const held = call(
      "GET",
      "/api/demo-mode/active?path=/dashboard&wait=8000",
      undefined,
      H(ana.body.sessionId),
    );
    await new Promise((r) => setTimeout(r, 600));
    const made = await call("POST", "/api/demo-mode/sessions", {
      userId: ana.body.userId,
    }, H(hans.body.sessionId));
    const opened = Date.now();
    const got = await held;
    const after = Date.now() - opened;
    assertEquals(got.status, 200);
    assertEquals(got.body.role, "viewer");
    assertEquals(got.body.session?.id, made.body.id);
    assert(
      after < 1500,
      `answered as soon as the demo opened (${after} ms after, not at the 8 s wait)`,
    );

    // a demo already on: the wait is never held
    t0 = Date.now();
    const on = await call(
      "GET",
      "/api/demo-mode/active?wait=8000",
      undefined,
      H(ana.body.sessionId),
    );
    assertEquals(on.body.session?.id, made.body.id);
    assert(Date.now() - t0 < 1000, "a demo already on answers at once");
  });
});
