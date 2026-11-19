/**
 * REQ-1010 (LOOP-007 cycle 1, q1-96) — a work order assigned to a worker reaches that worker's
 * /worker day. Amends REQ-210 / REQ-609. QA typed "Mike Carter" as WO-001's assignee for
 * 2026-11-24; /worker?date=2026-11-24 as Mike said "No tasks this day." The assignee was a free
 * string on the WO and `GET /field/worker/tasks` only lists field-day rows.
 *
 * Over HTTP, in process on an in-memory KV: a WO created with `assigneeWorkerId` + `scheduledFor`
 * lists (by `workOrderId`, without prices) on that worker's day and nobody else's; moving the date,
 * reassigning or cancelling the WO moves or removes it; another account's worker is refused.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { FieldModule } from "@field/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9110;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;
type Row = Record<string, unknown> & { id: string };

function ok(r: Res): Res {
  assert(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(SmsService).send = (_: SendSmsInput) => Promise.resolve({ ok: true });
  await app.listen(PORT);
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
    await app.close();
    await resetKv();
  }
}

async function owner(call: Call, phone: string) {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: stored!.code });
  const H = { "x-session-id": v.body.sessionId as string };
  ok(await call("PUT", "/me", { name: "WO Owner", language: "en" }, H));
  return H;
}

async function worker(call: Call, H: HeadersInit, name: string, cell: string) {
  const w = ok(await call("POST", "/field/workers", { name, phoneNumber: cell, pin: "1234", language: "en" }, H)).body;
  const login = ok(await call("POST", "/field/worker/login", { phoneNumber: cell, pin: "1234" }));
  return { ...w, cookie: { cookie: login.headers.get("set-cookie")!.split(";")[0] } };
}

/** the rows on a worker's /worker day that are this work order */
async function onDay(call: Call, cookie: HeadersInit, day: string, woId: string): Promise<Row[]> {
  const r = ok(await call("GET", `/field/worker/tasks?date=${day}`, undefined, cookie));
  return (r.body as Row[]).filter((t) => t.workOrderId === woId);
}

Deno.test("REQ-1010 (LOOP-007 q1-96) a work order assigned to worker Mike for day D shows on Mike's /worker day D, not on Pedro's, without prices; moving, reassigning and cancelling it follow", async () => {
  await withServer(async (call) => {
    const H = await owner(call, "+15125551010");
    const mike = await worker(call, H, "Mike Carter", "8435551001");
    const pedro = await worker(call, H, "Pedro", "8435551002");
    const customer = ok(await call("POST", "/customers", { name: "Dana Whitfield", address: "12 Fence Row, Myrtle Beach, SC" }, H)).body;
    const D = shiftDate(fieldToday(), 3);

    const created = await call("POST", "/work-orders", {
      customerId: customer.id,
      description: "Replace the back fence gate",
      serviceAddress: "12 Fence Row, Myrtle Beach, SC",
      scheduledFor: D,
      assignee: "Mike Carter",
      assigneeWorkerId: mike.id,
    }, H);
    assertEquals(created.status, 200, `create WO with assigneeWorkerId: ${JSON.stringify(created.body)}`);
    const wo = created.body;

    const mine = await onDay(call, mike.cookie, D, wo.id);
    assertEquals(mine.length, 1, `Mike's /worker day ${D} lists WO ${wo.number} (QA saw "No tasks this day.")`);
    assertEquals(mine[0].priceCents, undefined, "the worker's row carries no price");
    assertEquals((await onDay(call, pedro.cookie, D, wo.id)).length, 0, "not on Pedro's day");
    assertEquals((await onDay(call, mike.cookie, shiftDate(D, 1), wo.id)).length, 0, "not on the day after");
    assertEquals(wo.assigneeWorkerId, mike.id, "the WO keeps the worker it is assigned to");
    assertEquals((ok(await call("GET", `/work-orders/${wo.id}`, undefined, H)).body).assigneeWorkerId, mike.id);

    // moving the date moves it
    const D2 = shiftDate(D, 2);
    ok(await call("PUT", `/work-orders/${wo.id}`, { scheduledFor: D2 }, H));
    assertEquals((await onDay(call, mike.cookie, D, wo.id)).length, 0, "moved off day D");
    assertEquals((await onDay(call, mike.cookie, D2, wo.id)).length, 1, "moved onto the new day");

    // reassigning moves it to the other worker
    ok(await call("PUT", `/work-orders/${wo.id}`, { assignee: "Pedro", assigneeWorkerId: pedro.id }, H));
    assertEquals((await onDay(call, mike.cookie, D2, wo.id)).length, 0, "reassigned: gone from Mike's day");
    assertEquals((await onDay(call, pedro.cookie, D2, wo.id)).length, 1, "reassigned: on Pedro's day");

    // cancelling removes it
    ok(await call("PUT", `/work-orders/${wo.id}`, { status: "cancelled" }, H));
    assertEquals((await onDay(call, pedro.cookie, D2, wo.id)).length, 0, "a cancelled WO is on nobody's day");
  });
});

Deno.test("REQ-1010 (LOOP-007 q1-96) a work order can't be assigned to another account's worker", async () => {
  await withServer(async (call) => {
    const H = await owner(call, "+15125551011");
    const other = await owner(call, "+15125551012");
    const stranger = await worker(call, other, "Stranger", "8435551003");
    const r = await call("POST", "/work-orders", {
      description: "Not yours",
      scheduledFor: shiftDate(fieldToday(), 1),
      assigneeWorkerId: stranger.id,
    }, H);
    assert(r.status >= 400 && r.status < 500, `expected a 4xx for a foreign worker, got ${r.status} ${JSON.stringify(r.body)}`);
    const theirs = ok(await call("GET", `/field/worker/tasks?date=${shiftDate(fieldToday(), 1)}`, undefined, stranger.cookie)).body as Row[];
    assertEquals(theirs.filter((t) => t.workOrderId).length, 0, "nothing reached the stranger's day");
  });
});

Deno.test("REQ-1022 (LOOP-007 q2-12) Jake marked out on D covered by Miguel: WO-001 moves to Miguel's /worker day (covering for Jake), off Jake's, and /work-orders names the cover", async () => {
  await withServer(async (call) => {
    const H = await owner(call, "+15125551022");
    const jake = await worker(call, H, "Jake Fowler", "8435551022");
    const miguel = await worker(call, H, "Miguel Torres", "8435551023");
    const D = shiftDate(fieldToday(), 3);
    const wo = ok(await call("POST", "/work-orders", {
      description: "Fence repair walkthrough",
      scheduledFor: D,
      assignee: "Jake Fowler",
      assigneeWorkerId: jake.id,
    }, H)).body;
    assertEquals((await onDay(call, jake.cookie, D, wo.id)).length, 1, "before: WO on Jake's day");

    // the owner marks Jake out on D, covered by Miguel (the Mark out dialog's POST)
    const away = await call("POST", "/field/absences", {
      workerId: jake.id,
      from: D,
      to: D,
      disposition: "cover",
      coverWorkerId: miguel.id,
    }, H);
    assertEquals(away.status, 201, `mark Jake out: ${JSON.stringify(away.body)}`);

    const migs = await onDay(call, miguel.cookie, D, wo.id);
    assertEquals(migs.length, 1, `Miguel covers Jake on ${D}: WO ${wo.number} is on Miguel's /worker day (QA saw "Sin tareas este día")`);
    assertEquals(migs[0].workerId, miguel.id, "the row is Miguel's");
    assertEquals(migs[0].coverForName, "Jake Fowler", "the row says who Miguel covers for");
    assertEquals((await onDay(call, jake.cookie, D, wo.id)).length, 0, "Jake is out: the WO is not on his day");

    const list = ok(await call("GET", "/work-orders", undefined, H)).body as Row[];
    const row = list.find((r) => r.id === wo.id)!;
    assertEquals(row.coverAssignee, "Miguel Torres", "/work-orders shows who covers Jake's WO");
    const detail = ok(await call("GET", `/work-orders/${wo.id}`, undefined, H)).body;
    assertEquals(detail.coverAssignee, "Miguel Torres", "the WO page shows who covers it");
    assertEquals(detail.assigneeWorkerId, jake.id, "the stored assignee is untouched (read-time resolution)");

    // removing the absence puts it back on Jake
    ok(await call("DELETE", `/field/absences/${away.body.id}`, undefined, H));
    assertEquals((await onDay(call, jake.cookie, D, wo.id)).length, 1, "absence removed: back on Jake's day");
    assertEquals((await onDay(call, miguel.cookie, D, wo.id)).length, 0, "absence removed: off Miguel's day");
  });
});

Deno.test("REQ-1163 (LOOP-007 q3-96) Luis marked out on D with 'Deferred to the day they are back': WO-001 leaves his /worker day D, lands on D+1 'deferred from D', and the Away row says where it moved", async () => {
  await withServer(async (call) => {
    const H = await owner(call, "+15125551163");
    const luis = await worker(call, H, "Luis Ortega", "8435551163");
    const D = shiftDate(fieldToday(), 3);
    const D1 = shiftDate(D, 1);
    const wo = ok(await call("POST", "/work-orders", {
      description: "Replace pool pump seal",
      scheduledFor: D,
      assignee: "Luis Ortega",
      assigneeWorkerId: luis.id,
    }, H)).body;
    assertEquals((await onDay(call, luis.cookie, D, wo.id)).length, 1, "before: WO on Luis's day D");

    // the owner marks Luis out on D only, "Deferred to the day they are back" (the Mark out dialog's POST)
    const away = await call("POST", "/field/absences", { workerId: luis.id, from: D, to: D, disposition: "defer" }, H);
    assertEquals(away.status, 201, `mark Luis out: ${JSON.stringify(away.body)}`);

    assertEquals(
      (await onDay(call, luis.cookie, D, wo.id)).length,
      0,
      `Luis is off on ${D} and his work is deferred: ${wo.number} is not on his /worker day D (QA saw it as an ordinary '1 por hacer')`,
    );
    const back = await onDay(call, luis.cookie, D1, wo.id);
    assertEquals(back.length, 1, `${wo.number} is on Luis's first day back, ${D1}`);
    assertEquals(back[0].deferredFrom, D, "the row says it was deferred from D");

    const list = ok(await call("GET", "/field/absences", undefined, H)).body as Row[];
    const row = list.find((r) => r.id === away.body.id)!;
    const wos = row.workOrders as Row[];
    assertEquals(wos?.length, 1, "the Away row lists WO-001");
    assertEquals(
      wos[0].deferredTo,
      D1,
      "the Away row says WO-001 moves to D+1 — not 'still needs rescheduling — nobody has it'",
    );
    assertEquals(wos[0].coverName, undefined, "nobody covers it; it moved");
    assertEquals(
      (ok(await call("GET", `/work-orders/${wo.id}`, undefined, H)).body).scheduledFor,
      D,
      "the stored WO date is untouched (read-time resolution)",
    );
  });
});

Deno.test("REQ-1163 (LOOP-007 q3-96) Luis marked out on D with skip: WO-001 stays on D flagged out:'skip' on his row and on the Away row", async () => {
  await withServer(async (call) => {
    const H = await owner(call, "+15125551164");
    const luis = await worker(call, H, "Luis Ortega", "8435551164");
    const D = shiftDate(fieldToday(), 3);
    const wo = ok(await call("POST", "/work-orders", {
      description: "Replace pool pump seal",
      scheduledFor: D,
      assignee: "Luis Ortega",
      assigneeWorkerId: luis.id,
    }, H)).body;
    const away = await call("POST", "/field/absences", { workerId: luis.id, from: D, to: D, disposition: "skip" }, H);
    assertEquals(away.status, 201, `mark Luis out: ${JSON.stringify(away.body)}`);

    const mine = await onDay(call, luis.cookie, D, wo.id);
    assertEquals(mine.length, 1, "a skip leaves it on D (flagged, never silently moved)");
    assertEquals(mine[0].out, "skip", "the worker's row is flagged: he is off, the office reschedules");

    const list = ok(await call("GET", "/field/absences", undefined, H)).body as Row[];
    const wos = list.find((r) => r.id === away.body.id)!.workOrders as Row[];
    assertEquals(wos?.[0]?.out, "skip", "the Away row carries the skip");
  });
});
