/**
 * REQ-922 — Raphael: "we need one more option to send invoice which is
 * 'paper' this saves the invoice as a pdf and adds it to pending and not
 * drafts." POST /invoices/:id/paper issues the invoice (draft / scheduled →
 * sent, sentAt stamped) and answers its print-ready PDF as an attachment.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9922;
const BASE = `http://localhost:${PORT}`;

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any };
async function call(
  method: string,
  path: string,
  body?: unknown,
  sid?: string,
): Promise<Res> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch { /* raw */ }
  return { status: r.status, body: parsed };
}

async function login(phone: string): Promise<string> {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const sid = v.body.sessionId as string;
  await call("PUT", "/me", { name: "Paper Owner", language: "en" }, sid);
  return sid;
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

const mk = (sid: string, body: Record<string, unknown>) =>
  call("POST", "/invoices", {
    amount: 25000,
    jobName: "Gutter clean",
    billTo: { name: "Rosa Diaz" },
    ...body,
  }, sid).then((r) => r.body);

async function paper(id: string, sid?: string) {
  return await fetch(`${BASE}/invoices/${id}/paper`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sid ? { "x-session-id": sid } : {}),
    },
    body: "{}",
  });
}

Deno.test("REQ-922 POST /invoices/:id/paper: a draft is issued (sent + sentAt) and the answer is its PDF, an attachment named after its number", async () => {
  await withServer(async () => {
    const sid = await login("+15125559221");
    const draft = await mk(sid, { status: "draft" });
    assert(draft.id, JSON.stringify(draft));
    assertEquals(draft.status, "draft");

    const res = await paper(draft.id, sid);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/pdf");
    const disp = res.headers.get("content-disposition") ?? "";
    assert(disp.startsWith("attachment;"), disp);
    assert(
      disp.includes(`filename="${draft.number}.pdf"`),
      `named after ${draft.number}: ${disp}`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    assertEquals(
      new TextDecoder().decode(bytes.slice(0, 5)),
      "%PDF-",
      "a PDF",
    );

    const after = (await call("GET", `/invoices/${draft.id}`, undefined, sid))
      .body;
    assertEquals(after.status, "sent", "in Out for payment, not Drafting");
    assert(after.sentAt, "sentAt stamped");

    // twice is fine: it stays sent and the PDF comes again
    const again = await paper(draft.id, sid);
    assertEquals(again.status, 200);
    await again.body?.cancel();
    const still = (await call("GET", `/invoices/${draft.id}`, undefined, sid))
      .body;
    assertEquals([still.status, still.sentAt], ["sent", after.sentAt]);
  });
});

Deno.test("REQ-922 POST /invoices/:id/paper: a scheduled invoice is issued now; a void one is refused (409 void); another owner's is 404; no session is 401", async () => {
  await withServer(async () => {
    const sid = await login("+15125559222");
    const sched = await mk(sid, {
      status: "scheduled",
      scheduledFor: "2026-12-20",
    });
    const r = await paper(sched.id, sid);
    assertEquals(r.status, 200);
    await r.body?.cancel();
    const issued = (await call("GET", `/invoices/${sched.id}`, undefined, sid))
      .body;
    assertEquals(issued.status, "sent");

    const sent = await mk(sid, { status: "sent" });
    const v = await call("POST", `/invoices/${sent.id}/void`, {
      reason: "Wrong job",
    }, sid);
    assertEquals(v.status, 200);
    const refused = await paper(sent.id, sid);
    assertEquals(refused.status, 409);
    assertEquals((await refused.json()).reason, "void");

    const other = await login("+15125559223");
    const foreign = await paper(sched.id, other);
    assertEquals(foreign.status, 404);
    await foreign.body?.cancel();

    const anon = await paper(sched.id);
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
  });
});
