/**
 * REQ-1058 (LOOP-007 cycle 2, q2-47) — a work order can never be linked to the onboarding sample
 * quote. Amends REQ-210; follows REQ-360 ("the onboarding sample quote never passes for real
 * data") and REQ-474 (the New invoice quote picker drops `isSample`).
 *
 * QA saw the sample offered in New work order → Quote as "#43DE4E2D · Paver Patio Installation".
 * Behind the picker, POST /work-orders took any quoteId the account owns, sample included.
 *
 * Over HTTP, in process on an in-memory KV: the owner makes the sample the way the wizard does
 * (POST /agents/conversations/sample-quote, EnsureSampleQuote) and a real quote; POST and PUT
 * /work-orders with the sample's quoteId are refused with a 400, the real quote links fine.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { AgentsModule } from "@agents/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { type SendSmsInput, SmsService } from "@users/domain/data/sms/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}
const PORT = 9587;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown, headers?: HeadersInit) => Promise<Res>;

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
    return { status: r.status, body: parsed };
  };
  try {
    await fn(call);
  } finally {
    await app.close();
    await resetKv();
  }
}

async function ownerWithSample(call: Call) {
  const phone = "+15125550147";
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", { phoneNumber: phone, code: stored!.code });
  const H = { "x-session-id": v.body.sessionId as string };
  ok(await call("PUT", "/me", { name: "Sample Owner", language: "en" }, H));
  const userId = ok(await call("GET", "/me", undefined, H)).body.id as string;
  const sampleId = ok(await call("POST", "/agents/conversations/sample-quote", {}, H)).body.quoteId as string;
  const sample = await new QuoteStore().get(sampleId);
  assertEquals(sample?.isSample, true, "the wizard's sample quote is flagged isSample");
  const real = await new QuoteStore().create(userId, {
    summary: "Roof leak repair",
    jobName: "Roof Leak Repair",
    lineItems: [{ description: "Roof leak repair", quantity: 1, unit: "ea", price: 90_000 }],
    estimatedTotal: 90_000,
  });
  return { H, sampleId, realId: real.id };
}

Deno.test("REQ-1058 q2-47: POST /work-orders refuses the onboarding sample quote as its quoteId (400); a real quote links", async () => {
  await withServer(async (call) => {
    const { H, sampleId, realId } = await ownerWithSample(call);
    const linked = ok(await call("POST", "/work-orders", { description: "Fix the leak", quoteId: realId }, H)).body;
    assertEquals(linked.quoteId, realId, "a real quote links to the work order");

    const r = await call("POST", "/work-orders", { description: "Patio job", quoteId: sampleId }, H);
    assertEquals(
      r.status,
      400,
      `a work order linked to the sample quote must be refused, got ${r.status} ${JSON.stringify(r.body)}`,
    );
    const list = ok(await call("GET", "/work-orders", undefined, H)).body as Array<{ quoteId?: string }>;
    assert(!list.some((w) => w.quoteId === sampleId), "no work order is linked to the sample");
  });
});

Deno.test("REQ-1058 q2-47: PUT /work-orders/:id refuses re-linking a work order to the onboarding sample quote (400)", async () => {
  await withServer(async (call) => {
    const { H, sampleId } = await ownerWithSample(call);
    const wo = ok(await call("POST", "/work-orders", { description: "Fix the leak" }, H)).body;
    const r = await call("PUT", `/work-orders/${wo.id}`, { quoteId: sampleId }, H);
    assertEquals(
      r.status,
      400,
      `re-linking a work order to the sample quote must be refused, got ${r.status} ${JSON.stringify(r.body)}`,
    );
    const after = ok(await call("GET", `/work-orders/${wo.id}`, undefined, H)).body;
    assert(after.quoteId !== sampleId, "the work order is still not linked to the sample");
  });
});
