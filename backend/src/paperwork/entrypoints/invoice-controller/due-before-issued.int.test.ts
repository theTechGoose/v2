/**
 * REQ-962 (LOOP-007 cycle 1, q1-39) — an invoice is never due before it is
 * issued. INV-002 was created with issuedDate 2026-11-19 and dueDate
 * 2026-11-01; the API stored it, issued it, emailed "— due November 1, 2026"
 * and it was overdue at birth. POST /invoices and PUT /invoices/:id refuse a
 * due date before the issue date with 422 `due_before_issued`, and nothing is
 * stored.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9962;
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
  await call("PUT", "/me", { name: "Due Owner", language: "en" }, sid);
  return sid;
}

async function withServer(phone: string, fn: (sid: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(await login(phone));
  } finally {
    await server.stop();
    await resetKv();
  }
}

Deno.test("REQ-962: POST /invoices refuses a due date before the issue date (issued 2026-11-19, due 2026-11-01 → 422 due_before_issued, nothing stored); the same day is fine", () =>
  withServer("+15555559621", async (sid) => {
    const bad = await call("POST", "/invoices", {
      amount: 25000,
      jobName: "Gutter clean",
      billTo: { name: "Rosa Diaz", email: "rosa@example.com" },
      status: "sent",
      issuedDate: "2026-11-19",
      dueDate: "2026-11-01",
    }, sid);
    assertEquals(
      bad.status,
      422,
      `POST with due < issued is refused (got ${bad.status} ${
        JSON.stringify(bad.body)
      })`,
    );
    assertEquals(bad.body?.error, "due_before_issued");
    const listed = await call("GET", "/invoices", undefined, sid);
    assertEquals((listed.body as unknown[]).length, 0, "nothing was stored");

    const sameDay = await call("POST", "/invoices", {
      amount: 25000,
      jobName: "Same day",
      billTo: { name: "Rosa Diaz" },
      status: "draft",
      issuedDate: "2026-11-19",
      dueDate: "2026-11-19",
    }, sid);
    assertEquals(sameDay.status < 300, true, "due on the issue date is ok");
  }));

Deno.test("REQ-962: PUT /invoices/:id refuses a due date before the issue date (sent with it, or before the stored one) and keeps the stored due date", () =>
  withServer("+15555559622", async (sid) => {
    const draft = (await call("POST", "/invoices", {
      amount: 25000,
      jobName: "Fence repair",
      billTo: { name: "Rosa Diaz" },
      status: "draft",
      issuedDate: "2026-11-19",
      dueDate: "2026-12-19",
    }, sid)).body;
    const putBoth = await call("PUT", `/invoices/${draft.id}`, {
      issuedDate: "2026-11-19",
      dueDate: "2026-11-01",
    }, sid);
    assertEquals(
      putBoth.status,
      422,
      `PUT with due < issued is refused (got ${putBoth.status} ${
        JSON.stringify(putBoth.body)
      })`,
    );
    assertEquals(putBoth.body?.error, "due_before_issued");
    const putDue = await call("PUT", `/invoices/${draft.id}`, {
      dueDate: "2026-11-01",
    }, sid);
    assertEquals(
      putDue.status,
      422,
      `PUT of a due date before the stored issue date is refused (got ${putDue.status})`,
    );
    const after = await call("GET", `/invoices/${draft.id}`, undefined, sid);
    assertEquals(after.body.dueDate, "2026-12-19", "the stored due date stands");
  }));
