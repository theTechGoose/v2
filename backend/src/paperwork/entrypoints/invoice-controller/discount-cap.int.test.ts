/**
 * REQ-981 (LOOP-007 cycle 1, q1-62) — a discount bigger than the bill is
 * never stored. POST /invoices with discountCents > subtotalCents, and the
 * per-invoice POST /invoices/:id/discount, either refuse (4xx) or store a
 * discount capped at the pre-discount amount — never "−$100.00" on a $0 bill
 * that the email and PDF then print to the customer.
 */
import "#reflect-metadata";
import { assert } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 47000 + Math.floor(Math.random() * 2000);
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
  await call("PUT", "/me", { name: "Discount Owner", language: "en" }, sid);
  return sid;
}

Deno.test("REQ-981 q1-62: an invoice never stores a discount larger than its subtotal", async (t) => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15555559810");

    await t.step("REQ-981 POST /invoices: subtotal $0, discount $100 → refused or discount ≤ $0", async () => {
      const r = await call("POST", "/invoices", {
        requestId: "req-981-a",
        status: "draft",
        jobName: "Fence",
        billTo: { name: "Ann Lee" },
        subtotalCents: 0,
        discountCents: 10000,
        amount: 0,
      }, sid);
      if (r.status < 400) {
        const got = (await call("GET", `/invoices/${r.body.id}`, undefined, sid))
          .body;
        assert(
          (got.discountCents ?? 0) <= (got.subtotalCents ?? 0),
          `stored discountCents ${got.discountCents} > subtotalCents ${got.subtotalCents} (POST ${r.status})`,
        );
      }
    });

    await t.step("REQ-981 POST /invoices: subtotal $50, discount $100 → refused or discount ≤ $50", async () => {
      const r = await call("POST", "/invoices", {
        requestId: "req-981-b",
        status: "draft",
        jobName: "Fence",
        billTo: { name: "Ann Lee" },
        lineItems: [{ description: "Fence", quantity: 1, price: 5000 }],
        subtotalCents: 5000,
        discountCents: 10000,
        amount: 0,
      }, sid);
      if (r.status < 400) {
        const got = (await call("GET", `/invoices/${r.body.id}`, undefined, sid))
          .body;
        assert(
          (got.discountCents ?? 0) <= 5000,
          `stored discountCents ${got.discountCents} > subtotal 5000 (POST ${r.status})`,
        );
      }
    });

    await t.step("REQ-981 POST /invoices/:id/discount: $100 off a $50 invoice → refused or capped at $50", async () => {
      const inv = (await call("POST", "/invoices", {
        requestId: "req-981-c",
        status: "draft",
        jobName: "Gutters",
        billTo: { name: "Ann Lee" },
        amount: 5000,
      }, sid)).body;
      const r = await call(
        "POST",
        `/invoices/${inv.id}/discount`,
        { discountCents: 10000, reason: "goodwill" },
        sid,
      );
      const got = (await call("GET", `/invoices/${inv.id}`, undefined, sid))
        .body;
      assert(
        (got.discountCents ?? 0) <= 5000,
        `stored discountCents ${got.discountCents} on a $50 invoice (discount POST ${r.status})`,
      );
    });
  } finally {
    await server.stop();
  }
});
