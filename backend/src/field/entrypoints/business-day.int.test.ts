/**
 * REQ-940 (LOOP-007 q1, q1-11) — the worker's field day is the BUSINESS's day (its Time zone
 * setting, REQ-172/255), not the server's FIELD_TZ / America/New_York default. An account whose
 * zone has a different date than New York right now must (a) get its own day's round from
 * GET /field/worker/tasks with no date, and (b) be able to complete that day's visit (200, not
 * 409 "outside the days you can edit").
 *
 * The zone is picked at run time so the two dates differ at any wall-clock instant:
 * Pacific/Kiritimati (UTC+14, a day ahead of New York from 05:00 NY on) — the 409 the QA tester
 * hit — else Pacific/Honolulu (NY−5h, a day behind before 05:00 NY).
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { todayIn } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9941;
const J = { "content-type": "application/json" };
type Res = { status: number; body: any; headers: Headers };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;

async function withServer(fn: (call: Call) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  Deno.env.delete("FIELD_TZ"); // the server's fallback is New York
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

/** a zone whose date differs from New York's at `now` — ahead when possible */
function zoneOffNewYork(now = new Date()): { tz: string; ahead: boolean } {
  const ny = todayIn("America/New_York", now);
  if (todayIn("Pacific/Kiritimati", now) !== ny) return { tz: "Pacific/Kiritimati", ahead: true };
  return { tz: "Pacific/Honolulu", ahead: false };
}

/** an owner in a zone off New York, a worker, and a weekly visit starting on the business day */
async function zonedAccount(call: Call) {
  const phone = "+15125559401";
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: stored!.code });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Zone Owner", language: "en" }, H);

  const { tz, ahead } = zoneOffNewYork();
  const ident = await call("PUT", "/profile/identity", { businessName: "Zone Lawn", timezone: tz }, H);
  assertEquals([ident.status, ident.body.timezone], [200, tz]);
  const bizDay = todayIn(tz);
  const nyDay = todayIn("America/New_York");
  assert(bizDay !== nyDay, `precondition: ${tz} (${bizDay}) and New York (${nyDay}) disagree`);

  const customer = (await call("POST", "/customers", {
    name: "Ana Torres",
    phoneNumber: "(843) 555-0941",
    email: "ana@blackhole.postmarkapp.com",
  }, H)).body;
  const worker = (await call("POST", "/field/workers", { name: "Luis", phoneNumber: "843-555-0942", pin: "1234" }, H)).body;
  const sub = (await call("POST", "/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: bizDay,
    items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
  }, H)).body;
  await call("PUT", `/field/regions/${sub.region.id}/worker`, { workerId: worker.id }, H);
  const wl = await call("POST", "/field/worker/login", { phoneNumber: "8435550942", pin: "1234" });
  const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
  return { W, tz, ahead, bizDay, nyDay };
}

Deno.test("REQ-940 (q1-11) GET /field/worker/tasks with no date is the business's day in its time zone, not New York's", async () => {
  await withServer(async (call) => {
    const { W, tz, ahead, bizDay, nyDay } = await zonedAccount(call);
    const list = await call("GET", "/field/worker/tasks", undefined, W);
    assertEquals(list.status, 200);
    assertEquals(
      list.body.map((t: { date: string }) => t.date),
      [bizDay],
      `the default round is the business day ${bizDay} in ${tz}, not New York's ${nyDay} (${ahead ? "ahead" : "behind"})`,
    );
  });
});

Deno.test("REQ-940 (q1-11) the worker completes the visit on the business's today — 200, not 409 'outside the days you can edit'", async () => {
  await withServer(async (call) => {
    const { W, tz, bizDay } = await zonedAccount(call);
    const own = (await call("GET", `/field/worker/tasks?date=${bizDay}`, undefined, W)).body;
    assertEquals(own.length, 1, "the business day's visit is there");
    const done = await call("POST", `/field/worker/tasks/${own[0].id}/complete`, {}, W);
    assertEquals(
      [done.status, done.body?.status],
      [200, "complete"],
      `completing today's visit (${bizDay} in ${tz}) — got ${JSON.stringify(done.body)}`,
    );
  });
});
