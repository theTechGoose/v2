/**
 * REQ-192 — the timeclock over HTTP, in process on an in-memory KV: the worker's pm_worker
 * cookie for the clock, the owner's session for the timesheet; every record is the account's.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { TimeclockModule } from "@timeclock/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [TimeclockModule] })
class TestApp {}
const PORT = 9193;
const J = { "content-type": "application/json" };
type Res = { status: number; body: any; headers: Headers };
type Call = (
  method: string,
  path: string,
  body?: unknown,
  headers?: HeadersInit,
) => Promise<Res>;

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
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
    return { status: r.status, body: parsed, headers: r.headers };
  };
  try {
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(call: Call, phone: string, name: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name, language: "en" }, H);
  return H;
}

/** an owner, a worker of theirs signed in on their own cookie */
async function setUp(
  call: Call,
  ownerPhone = "+15125551920",
  cell = "8435551920",
) {
  const H = await login(call, ownerPhone, "Clock Owner");
  const worker = (await call("POST", "/field/workers", {
    name: "Luis",
    phoneNumber: cell,
    pin: "1234",
  }, H)).body;
  const wl = await call("POST", "/field/worker/login", {
    phoneNumber: cell,
    pin: "1234",
  });
  const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
  return { H, W, worker };
}

Deno.test("REQ-192 the one button: out → in → out; a punch that would not flip is refused; status carries the shifts and totals", async () => {
  await withServer(async (call) => {
    const { W, worker } = await setUp(call);
    const s0 = await call("GET", "/timeclock/worker/status", undefined, W);
    assertEquals(s0.status, 200);
    assertEquals(s0.body.status, "out");
    assertEquals(s0.body.worker.id, worker.id);
    assertEquals(s0.body.shifts, []);
    assertEquals(s0.body.weekTotalMs, 0);
    assert(
      typeof s0.body.from === "string" && typeof s0.body.to === "string",
      "the week's bounds come back",
    );

    const p1 = await call("POST", "/timeclock/worker/punch", {}, W);
    assertEquals(p1.status, 201, JSON.stringify(p1.body));
    assertEquals(p1.body.punch.type, "in");
    assertEquals(p1.body.punch.source, "worker");
    assertEquals(p1.body.status.status, "in");
    assertEquals(p1.body.status.shifts.length, 1);
    assertEquals(p1.body.status.shifts[0].open, true);

    const again = await call(
      "POST",
      "/timeclock/worker/punch",
      { type: "in" },
      W,
    );
    assertEquals(again.status, 409, "in while in is refused");
    assertEquals(again.body.code, "already_in");

    const p2 = await call("POST", "/timeclock/worker/punch", {}, W);
    assertEquals(p2.status, 201);
    assertEquals(p2.body.punch.type, "out");
    assertEquals(p2.body.status.status, "out");
    assertEquals(p2.body.status.shifts[0].open, false);
    assert(p2.body.status.shifts[0].durationMs >= 0);

    const not = await call(
      "POST",
      "/timeclock/worker/punch",
      { type: "out" },
      W,
    );
    assertEquals(not.status, 409, "out while out is refused");
    assertEquals(not.body.code, "not_in");

    // the browser's own week bounds are honoured
    const s1 = await call(
      "GET",
      "/timeclock/worker/status?from=2000-01-03T00:00:00.000Z&to=2000-01-10T00:00:00.000Z&today=2000-01-03T00:00:00.000Z",
      undefined,
      W,
    );
    assertEquals(
      s1.body.shifts,
      [],
      "a week in the past has none of this week's shifts",
    );
    assertEquals(
      s1.body.status,
      "out",
      "the state is the state whatever the window",
    );

    assertEquals(
      (await call("GET", "/timeclock/worker/status")).status,
      401,
      "no cookie, no status",
    );
    assertEquals(
      (await call("POST", "/timeclock/worker/punch", {})).status,
      401,
    );
  });
});

Deno.test("REQ-192 the office: the week's report, the punch log, a manual punch with a reason, a void with a reason; another account sees nothing", async () => {
  await withServer(async (call) => {
    const { H, W, worker } = await setUp(call);
    const h = 3_600_000;
    const from = new Date(Date.now() - 24 * h).toISOString(),
      to = new Date(Date.now() + 24 * h).toISOString();
    const sixAgo = new Date(Date.now() - 6 * h).toISOString(),
      threeAgo = new Date(Date.now() - 3 * h).toISOString();

    // a manual pair first (the office fixing a forgotten morning): a reason is required; an "out" with no "in" before it is refused
    assertEquals(
      (await call("POST", "/timeclock/punches", {
        workerId: worker.id,
        type: "in",
        at: sixAgo,
      }, H)).status,
      400,
      "reason required",
    );
    const noIn = await call("POST", "/timeclock/punches", {
      workerId: worker.id,
      type: "out",
      at: threeAgo,
      reason: "x",
    }, H);
    assertEquals(noIn.status, 409);
    assertEquals(noIn.body.code, "out_without_in");
    const earlyIn = await call("POST", "/timeclock/punches", {
      workerId: worker.id,
      type: "in",
      at: sixAgo,
      reason: "forgot to clock in",
    }, H);
    assertEquals(earlyIn.status, 201, JSON.stringify(earlyIn.body));
    assertEquals(earlyIn.body.source, "manual");
    assertEquals(earlyIn.body.reason, "forgot to clock in");
    const earlyOut = await call("POST", "/timeclock/punches", {
      workerId: worker.id,
      type: "out",
      at: threeAgo,
      reason: "and out",
    }, H);
    assertEquals(earlyOut.status, 201, JSON.stringify(earlyOut.body));
    assertEquals(
      (await call("POST", "/timeclock/punches", {
        workerId: worker.id,
        type: "in",
        at: new Date(Date.now() + h).toISOString(),
        reason: "x",
      }, H)).status,
      400,
      "not in the future",
    );

    // then the worker's own pair, now
    await call("POST", "/timeclock/worker/punch", {}, W);
    await call("POST", "/timeclock/worker/punch", {}, W);

    const rep = await call(
      "GET",
      `/timeclock/report?from=${from}&to=${to}`,
      undefined,
      H,
    );
    assertEquals(rep.status, 200, JSON.stringify(rep.body));
    assertEquals(rep.body.workers.length, 1);
    assertEquals(rep.body.workers[0].worker.id, worker.id);
    assertEquals(
      rep.body.workers[0].shifts.length,
      2,
      "the manual pair and the worker's pair",
    );
    assertEquals(rep.body.workers[0].anomalies, []);
    assert(
      rep.body.workers[0].totalMs >= 3 * h,
      "three hours of the manual shift at least",
    );

    const log = await call(
      "GET",
      `/timeclock/punches?from=${from}&to=${to}`,
      undefined,
      H,
    );
    assertEquals(log.status, 200);
    assertEquals(log.body.length, 4);
    assertEquals(log.body[0].type, "out", "newest first");
    assertEquals(log.body[3].id, earlyIn.body.id);

    // a manual "out" after the worker's "out" is refused: it must alternate
    const bad = await call("POST", "/timeclock/punches", {
      workerId: worker.id,
      type: "out",
      at: new Date().toISOString(),
      reason: "forgot",
    }, H);
    assertEquals(bad.status, 409);
    assertEquals(bad.body.code, "same_as_prev");

    // void: a reason is required; the punch stays in the log, struck; voiding twice 409s
    assertEquals(
      (await call("POST", `/timeclock/punches/${earlyOut.body.id}/void`, {}, H))
        .status,
      400,
    );
    const v = await call(
      "POST",
      `/timeclock/punches/${earlyOut.body.id}/void`,
      { reason: "wrong time" },
      H,
    );
    assertEquals(v.status, 201, JSON.stringify(v.body));
    assertEquals(v.body.voided.reason, "wrong time");
    assertEquals(
      (await call("POST", `/timeclock/punches/${earlyOut.body.id}/void`, {
        reason: "again",
      }, H)).status,
      409,
    );
    const rep3 = await call(
      "GET",
      `/timeclock/report?from=${from}&to=${to}&workerId=${worker.id}`,
      undefined,
      H,
    );
    assertEquals(
      rep3.body.workers[0].anomalies.length,
      1,
      "the manual in lost its out: missing_out",
    );
    assertEquals(rep3.body.workers[0].anomalies[0].kind, "missing_out");
    const log2 = await call(
      "GET",
      `/timeclock/punches?from=${from}&to=${to}&workerId=${worker.id}`,
      undefined,
      H,
    );
    assertEquals(log2.body.length, 4, "voided punches stay in the log");
    assertEquals(
      log2.body.filter((p: { voided: unknown }) => p.voided).length,
      1,
    );

    // the worker's state after the fixes: out (their own out is the latest non-voided punch)
    const s = await call("GET", "/timeclock/worker/status", undefined, W);
    assertEquals(s.body.status, "out");

    // another account: nothing of this one's
    const other = await login(call, "+15125551921", "Other Owner");
    const rOther = await call(
      "GET",
      `/timeclock/report?from=${from}&to=${to}`,
      undefined,
      other,
    );
    assertEquals(rOther.body.workers, []);
    assertEquals(
      (await call(
        "GET",
        `/timeclock/punches?from=${from}&to=${to}`,
        undefined,
        other,
      )).body,
      [],
    );
    assertEquals(
      (await call("POST", `/timeclock/punches/${earlyIn.body.id}/void`, {
        reason: "x",
      }, other)).status,
      404,
    );
    assertEquals(
      (await call("POST", "/timeclock/punches", {
        workerId: worker.id,
        type: "in",
        at: sixAgo,
        reason: "x",
      }, other)).status,
      404,
    );
    assertEquals(
      (await call("GET", "/timeclock/report")).status,
      401,
      "no session, no report",
    );
  });
});

Deno.test("REQ-192 a whole shift at once: the office adds yesterday's in + out in one go before the worker's own pair; it cannot overlap or break the alternation", async () => {
  await withServer(async (call) => {
    const { H, W, worker } = await setUp(call, "+15125551922", "8435551922");
    const h = 3_600_000;
    await call("POST", "/timeclock/worker/punch", {}, W); // in, now
    const start = new Date(Date.now() - 30 * h).toISOString(),
      end = new Date(Date.now() - 22 * h).toISOString();
    assertEquals(
      (await call("POST", "/timeclock/shifts", {
        workerId: worker.id,
        start,
        end,
      }, H)).status,
      400,
      "reason required",
    );
    assertEquals(
      (await call("POST", "/timeclock/shifts", {
        workerId: worker.id,
        start: end,
        end: start,
        reason: "x",
      }, H)).status,
      400,
      "start before end",
    );
    const made = await call("POST", "/timeclock/shifts", {
      workerId: worker.id,
      start,
      end,
      reason: "forgot yesterday",
    }, H);
    assertEquals(made.status, 201, JSON.stringify(made.body));
    assertEquals([made.body.in.type, made.body.out.type], ["in", "out"]);
    assertEquals(made.body.in.reason, "forgot yesterday");
    // nested inside the new shift: nothing sits inside it, but the punch before is its "in" — refused
    const nested = await call("POST", "/timeclock/shifts", {
      workerId: worker.id,
      start: new Date(Date.now() - 28 * h).toISOString(),
      end: new Date(Date.now() - 26 * h).toISOString(),
      reason: "x",
    }, H);
    assertEquals(nested.status, 409);
    assertEquals(nested.body.code, "same_as_prev");
    // straddling its "in": a punch inside the pair — refused
    const straddle = await call("POST", "/timeclock/shifts", {
      workerId: worker.id,
      start: new Date(Date.now() - 31 * h).toISOString(),
      end: new Date(Date.now() - 29 * h).toISOString(),
      reason: "x",
    }, H);
    assertEquals(straddle.status, 409);
    assertEquals(straddle.body.code, "overlaps");
    const after = await call("POST", "/timeclock/shifts", {
      workerId: worker.id,
      start: new Date(Date.now() - 20 * h).toISOString(),
      end: new Date(Date.now() - 18 * h).toISOString(),
      reason: "x",
    }, H);
    assertEquals(
      after.status,
      201,
      "a second gap before the worker's in is fine",
    );
    const fromAll = new Date(Date.now() - 48 * h).toISOString(),
      toAll = new Date(Date.now() + h).toISOString();
    const rep = await call(
      "GET",
      `/timeclock/report?from=${fromAll}&to=${toAll}&workerId=${worker.id}`,
      undefined,
      H,
    );
    assertEquals(
      rep.body.workers[0].shifts.length,
      3,
      "two manual shifts and the open one",
    );
    assertEquals(
      rep.body.workers[0].shifts[2].open,
      true,
      "the worker is still in",
    );
    assertEquals(
      (await call("GET", "/timeclock/worker/status", undefined, W)).body.status,
      "in",
    );
    assertEquals(
      (await call("POST", "/timeclock/shifts", {
        workerId: worker.id,
        start,
        end,
        reason: "x",
      }, { "x-session-id": "nope" })).status,
      401,
    );
  });
});
