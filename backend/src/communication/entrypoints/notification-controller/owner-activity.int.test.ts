/**
 * REQ-566 (demo-loop cycle 4, m11) — the dashboard's "What we handled today"
 * panel reads GET /notifications (REQ-299). The feed held only customer-side
 * events, so after the owner issued an invoice, recorded a payment and a
 * worker finished a field job it still said "Nothing yet". Over HTTP, in
 * process on an in-memory KV: each of those owner-side actions lands one row.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { fieldToday } from "@field/domain/business/schedule/mod.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9566;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
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

async function login(call: Call, language: "en" | "es" = "en") {
  const phone = "+15125551566";
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name: "Hank Owner", language }, H);
  return H;
}

async function feed(call: Call, H: HeadersInit): Promise<string[]> {
  const r = await call("GET", "/notifications", undefined, H);
  assertEquals(r.status, 200);
  return (r.body as Array<{ title: string }>).map((n) => n.title);
}

Deno.test("REQ-566 (cycle 4, m11): an invoice the owner issues and a payment the owner records land in the dashboard's activity feed; a draft does not", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const customer = (await call("POST", "/customers", {
      name: "Bob Smith",
      phoneNumber: "(512) 555-0142",
    }, H)).body;
    assertEquals(await feed(call, H), [], "nothing happened yet");

    // a draft is not an owner event the feed reports
    const draft = (await call("POST", "/invoices", {
      customerId: customer.id,
      amount: 30000,
      status: "draft",
    }, H)).body;
    assertEquals(await feed(call, H), [], "a draft is not 'handled'");

    // issued at birth (the "Issue" path with nothing to dispatch)
    const issued = await call("POST", "/invoices", {
      customerId: customer.id,
      amount: 45000,
      status: "sent",
    }, H);
    assertEquals(issued.body.status, "sent");
    assertEquals(await feed(call, H), ["Invoice for $450 sent to Bob Smith"]);

    // the draft issued later by an edit
    const flipped = await call("PUT", `/invoices/${draft.id}`, {
      status: "sent",
    }, H);
    assertEquals(flipped.status, 200);
    assertEquals(
      (await feed(call, H))[0],
      "Invoice for $300 sent to Bob Smith",
    );
    // a second save of an issued invoice is not a second event
    await call("PUT", `/invoices/${draft.id}`, { status: "sent" }, H);
    assertEquals((await feed(call, H)).length, 2);

    // "Payment received" on the owner's side (POST /payments)
    const paid = await call("POST", "/payments", {
      invoiceId: issued.body.id,
      amount: 45000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    }, H);
    assertEquals(paid.status < 300, true, `POST /payments ${paid.status}`);
    assertEquals(
      (await feed(call, H))[0],
      "Payment recorded: $450 from Bob Smith",
    );
  });
});

Deno.test("REQ-566 (cycle 4, m11): a field job the worker finishes lands in the owner's activity feed (and the office's check-off too)", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const customer = (await call("POST", "/customers", {
      name: "Ana Torres",
      phoneNumber: "(843) 555-0101",
    }, H)).body;
    const worker = (await call("POST", "/field/workers", {
      name: "Carlos",
      phoneNumber: "843-555-0201",
      pin: "1234",
    }, H)).body;
    const today = fieldToday();
    const sub = (await call("POST", "/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Lawn mowing", priceCents: 45000 }, {
        taskTypeName: "Hedge trim",
        priceCents: 4000,
      }],
    }, H)).body;
    await call("PUT", `/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    }, H);
    const wl = await call("POST", "/field/worker/login", {
      phoneNumber: "8435550201",
      pin: "1234",
    });
    const W = { cookie: wl.headers.get("set-cookie")!.split(";")[0] };
    const tasks =
      (await call("GET", `/field/tasks?date=${today}`, undefined, H))
        .body as Array<{ id: string; taskTypeName: string }>;
    const mow = tasks.find((t) => t.taskTypeName === "Lawn mowing")!;
    const hedge = tasks.find((t) => t.taskTypeName === "Hedge trim")!;
    assertEquals(await feed(call, H), []);

    const done = await call(
      "POST",
      `/field/worker/tasks/${mow.id}/complete`,
      {},
      W,
    );
    assertEquals(done.body.status, "complete");
    assertEquals(await feed(call, H), [
      "Carlos finished a job for Ana Torres: Lawn mowing",
    ]);

    // the office checks the other one off
    const office = await call("PUT", `/field/tasks/${hedge.id}`, {
      status: "complete",
    }, H);
    assertEquals(office.status, 200);
    assertEquals(
      (await feed(call, H))[0],
      "Job done for Ana Torres: Hedge trim",
    );
  });
});
