/**
 * REQ-659 — demo-loop cycle 5, issues M14 / m53: the contractor's private
 * pricing reached the customer's quote and invoice. The money filter ran on
 * LLM bullets and the polish step only; the quote store took any description
 * as written ("… media camioneta, $450. Cargo por disposición de basura
 * $75." on the quote AND the invoice). And the invoice mirrored the quote's
 * relative start ("La próxima semana") on a bill issued long after it.
 *
 * Every write of a quote's job details now drops the priced / private-pricing
 * sentences (store level: chat tools, polish, quick quote, PUT /quotes), and
 * the public invoice drops a relative start term the bill has outlived.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { QuoteStore } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const PRICED_ES =
  "Retiro de muebles viejos y basura de un garaje. Media camioneta, $450. Cargo por disposición de basura $75.";
const LEAK = /\$\s?\d|\d\s?\/\s?hr|at cost|\+\s?\d+\s?%|quoted me|me cobra/i;

function line(description: string, price = 450_00) {
  return { description, quantity: 1, unit: "ea", price };
}

Deno.test("REQ-659 (cycle 5, m53/M14): the quote store never stores priced job details — create, update, pending", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new QuoteStore();
    const q = await store.create("u-659", {
      summary: "Retiro de basura",
      description: PRICED_ES,
      descriptionByLang: {
        es: PRICED_ES,
        en:
          "Remove old furniture and junk from a garage. Half truck, $450. Dump fee $75.",
      },
      lineItems: [line("Retiro de basura")],
      status: "draft",
    });
    assertEquals(
      q.description,
      "Retiro de muebles viejos y basura de un garaje.",
    );
    assertEquals(
      q.descriptionByLang?.en,
      "Remove old furniture and junk from a garage.",
    );

    const u = await store.update(q.id, "u-659", {
      description:
        "Kitchen backsplash tile\nMaterials at cost +15%\nLabor 85/hr\nMy sub quoted me for the plumbing\nGrout and seal",
    });
    assertEquals(u.description, "Kitchen backsplash tile\nGrout and seal");

    const p = await store.setPending(q.id, "u-659", {
      description: "Paint the hallway. Labor 90 an hour.",
    });
    const pending = p.pendingRevision as Record<string, unknown>;
    assertEquals(pending.description, "Paint the hallway.");
  } finally {
    await resetKv();
  }
});

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone = "+15125556590"): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-659 (cycle 5, m53): PUT /quotes drops the priced sentences; the public invoice drops a start term it outlived", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const created = await fetch(`${BASE}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Garage cleanout",
        jobName: "Garage Cleanout",
        lineItems: [line("Garage cleanout", 525_00)],
        estimatedTotal: 525_00,
      }),
    }).then((r) => r.json());
    const put = await fetch(`${BASE}/quotes/${created.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ description: PRICED_ES }),
    }).then((r) => r.json());
    assertEquals(
      put.description,
      "Retiro de muebles viejos y basura de un garaje.",
    );

    // The quote went out a month and a half ago, starting "next week".
    const quotes = new QuoteStore();
    const longAgo = "2026-09-01T15:00:00.000Z";
    await quotes.update(created.id, put.userId, {
      status: "accepted",
      sentAt: longAgo,
      terms: [
        { stepId: "start_date", label: "Start date", value: "Next week" },
        { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
      ],
    });
    const invoices = new InvoiceStore();
    const today = new Date().toISOString().slice(0, 10);
    const finalBill = await invoices.create(put.userId, {
      quoteId: created.id,
      status: "sent",
      amount: 262_50,
      issuedDate: today,
    });
    const pub = await fetch(`${BASE}/invoices/${finalBill.id}/public`)
      .then((r) => r.json());
    const steps = (pub.terms as Array<{ stepId: string }>).map((t) => t.stepId);
    assertEquals(steps, ["payment_terms"], JSON.stringify(pub.terms));
    assert(!LEAK.test(pub.jobDetails?.description ?? ""));

    // A deposit bill issued the day the quote went out keeps "Next week".
    await quotes.update(created.id, put.userId, {
      sentAt: new Date().toISOString(),
    });
    const pub2 = await fetch(`${BASE}/invoices/${finalBill.id}/public`)
      .then((r) => r.json());
    assertEquals(
      (pub2.terms as Array<{ stepId: string }>).map((t) => t.stepId),
      ["start_date", "payment_terms"],
    );
  } finally {
    await server.stop();
    await resetKv();
  }
});
