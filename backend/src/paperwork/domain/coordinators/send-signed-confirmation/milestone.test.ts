import { assert, assertEquals } from "#std/assert";
import {
  computeMilestoneAmounts,
  computeScheduledDates,
  SendSignedConfirmation,
} from "./mod.ts";
import type { QuoteTerm } from "@paperwork/dto/quote.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import {
  EmailService,
  type SendEmailInput,
} from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function pterms(value: string): QuoteTerm[] {
  return [{ stepId: "payment_terms", label: "Payment", value }];
}

Deno.test("computeMilestoneAmounts: 50/50 → two equal halves, sum = total", () => {
  const out = computeMilestoneAmounts(100_00, pterms("50/50"));
  assertEquals(out, [50_00, 50_00]);
  assertEquals(out.reduce((s, n) => s + n, 0), 100_00);
});

Deno.test("computeMilestoneAmounts: 30/30/40 → three milestones, last absorbs rounding", () => {
  // 333_00 doesn't split cleanly into 30/30/40 — verify the sum still
  // equals the total exactly (rounding goes into the last milestone).
  const out = computeMilestoneAmounts(333_00, pterms("30/30/40"));
  assertEquals(out.length, 3);
  assertEquals(out.reduce((s, n) => s + n, 0), 333_00);
  assertEquals(out[0], Math.round(333_00 * 0.30));
  assertEquals(out[1], Math.round(333_00 * 0.30));
});

Deno.test("computeMilestoneAmounts: 'upon completion' / 'net 15' → one milestone, full total", () => {
  assertEquals(
    computeMilestoneAmounts(500_00, pterms("Payment upon completion")),
    [500_00],
  );
  assertEquals(computeMilestoneAmounts(500_00, pterms("net 15")), [500_00]);
});

Deno.test("computeMilestoneAmounts: 'deposit + balance' → 20/80", () => {
  const out = computeMilestoneAmounts(1000_00, pterms("Deposit + balance"));
  assertEquals(out.length, 2);
  assertEquals(out[0], 200_00);
  assertEquals(out[1], 800_00);
});

Deno.test("computeMilestoneAmounts: unknown terms → single full payment", () => {
  // No "50/50" / "30/30/40" / "completion" / "deposit" → bill the full amount
  // once. (Previously this invented a 30/70 deposit split that the agreement and
  // PDF never showed — they render no schedule for unparseable terms — so the
  // customer was invoiced a deposit they never agreed to. One payment is the
  // only safe read when the terms can't be parsed.)
  const out = computeMilestoneAmounts(1000_00, pterms("haggle in person"));
  assertEquals(out, [1000_00]);
});

Deno.test("computeMilestoneAmounts: zero/negative total → empty", () => {
  assertEquals(computeMilestoneAmounts(0, pterms("50/50")), []);
  assertEquals(computeMilestoneAmounts(-100, pterms("50/50")), []);
});

Deno.test("computeScheduledDates: 3 milestones over a 14-day window, equal spacing", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(3, "2026-05-01", "2026-05-15", today);
  // First slot is today (callers ignore it — first invoice fires
  // immediately). Subsequent slots are evenly spaced over [start, end].
  assertEquals(dates.length, 3);
  assertEquals(dates[0], "2026-05-01");
  assertEquals(dates[1], "2026-05-08"); // halfway
  assertEquals(dates[2], "2026-05-15"); // end of window
});

Deno.test("computeScheduledDates: missing window → defaults to 14-day fallback", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(3, undefined, undefined, today);
  assertEquals(dates.length, 3);
  // Window collapses to 14 days from today: halfway at +7d, end at +14d.
  assertEquals(dates[1], "2026-05-08");
  assertEquals(dates[2], "2026-05-15");
});

Deno.test("computeScheduledDates: single-milestone case → only today's slot", () => {
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(1, "2026-05-01", "2026-05-30", today);
  assertEquals(dates, ["2026-05-01"]);
});

Deno.test("computeScheduledDates: zero-day window is clamped so dates don't collide", () => {
  // start === end shouldn't make every milestone date the same. The helper
  // forces at least a 1-day window in that case.
  const today = new Date("2026-05-01T00:00:00Z");
  const dates = computeScheduledDates(2, "2026-05-01", "2026-05-01", today);
  assertEquals(dates.length, 2);
  // First slot is today; second slot has shifted forward by the clamped 1-day window.
  assertEquals(dates[0], "2026-05-01");
  assertEquals(dates[1], "2026-05-02");
});

// ---------------------------------------------------------------------------
// run(quoteId) — the post-accept billing + confirmation flow. Accepting the
// quote is THE one signature ceremony, and it always bills (UX-37 resolved by
// construction: there is no second sign-the-contract page).
// ---------------------------------------------------------------------------

function freshRun() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = (input: SendEmailInput) => {
    sentEmails.push(input);
    return Promise.resolve({ ok: true, reason: "test_capture" });
  };
  const flow = new SendSignedConfirmation(
    quotes,
    invoices,
    customers,
    new UserStore(),
    new BusinessIdentityStore(),
    new RenderQuotePdf(),
    email,
    new SmsService(),
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return { quotes, invoices, customers, sentEmails, flow };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

const todayIso = () => new Date().toISOString().slice(0, 10);

Deno.test("send-signed-confirmation run: 50/50 terms → first invoice sent now, second scheduled; acceptedNotifiedAt stamped", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Deck build",
      lineItems: [],
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });

    const result = await s.flow.run(quote.id);

    const rows = (await s.invoices.listByUser("u-1"))
      .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0));
    assertEquals(rows.length, 2);
    for (const inv of rows) {
      assertEquals(inv.quoteId, quote.id);
      assertEquals(inv.installmentTotal, 2);
    }
    assertEquals(rows[0].installmentIndex, 1);
    assertEquals(rows[0].status, "sent");
    assertEquals(rows[0].amount, 500_00);
    assertEquals(rows[0].issuedDate, todayIso());
    assertEquals(rows[1].installmentIndex, 2);
    assertEquals(rows[1].status, "scheduled");
    assertEquals(rows[1].amount, 500_00);
    assert(rows[1].scheduledFor, "second milestone carries scheduledFor");

    assertEquals(result.invoiceId, rows[0].id);
    const reloaded = await s.quotes.getOwned(quote.id, "u-1");
    assert(reloaded.acceptedNotifiedAt, "acceptedNotifiedAt stamped");
  });
});

Deno.test("send-signed-confirmation run: idempotent — a replay after acceptedNotifiedAt creates no second milestone set", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Deck build",
      lineItems: [],
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });

    await s.flow.run(quote.id);
    const second = await s.flow.run(quote.id);

    assertEquals(second.ok, true);
    assertEquals(second.reason, "already_notified");
    assertEquals((await s.invoices.listByUser("u-1")).length, 2);
  });
});

Deno.test("send-signed-confirmation run: NO payment terms → accept still bills — one full-amount invoice due today", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Patio",
      lineItems: [],
      estimatedTotal: 750_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      // no terms at all
    });

    const result = await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].quoteId, quote.id);
    assertEquals(rows[0].amount, 750_00);
    assertEquals(rows[0].status, "sent");
    assertEquals(rows[0].installmentIndex, 1);
    assertEquals(rows[0].installmentTotal, 1);
    assertEquals(rows[0].dueDate, todayIso(), "no-terms invoice is due today");
    assertEquals(result.invoiceId, rows[0].id);
  });
});

Deno.test("send-signed-confirmation run: 'Due Now' terms → the single invoice is due the day of signing", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Repair",
      lineItems: [],
      estimatedTotal: 300_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Due now",
      }],
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].dueDate, todayIso());
  });
});

Deno.test("send-signed-confirmation run: UX-36 reconcile — a partially-invoiced deal bills only the unbilled remainder", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Roof",
      lineItems: [],
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });
    // Half the deal was already invoiced (quoteId-matched) before the accept.
    await s.invoices.create("u-1", {
      quoteId: quote.id,
      dueDate: "2026-05-01",
      amount: 500_00,
      status: "paid",
      paidAt: "2026-04-20T00:00:00Z",
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    const created = rows.filter((i) => i.status !== "paid");
    assertEquals(created.length, 1, "only the unbilled remainder is invoiced");
    assertEquals(created[0].amount, 500_00);
    assertEquals(created[0].quoteId, quote.id);
    // Grand total across the deal never exceeds the agreement total.
    const billed = rows.reduce((sum, i) => sum + (i.amount ?? 0), 0);
    assertEquals(billed, 1_000_00);
  });
});

Deno.test("send-signed-confirmation run: UX-36 reconcile — a fully-invoiced deal creates NO new invoices but still stamps", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Roof",
      lineItems: [],
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });
    await s.invoices.create("u-1", {
      quoteId: quote.id,
      dueDate: "2026-05-01",
      amount: 1_000_00,
      status: "sent",
    });

    await s.flow.run(quote.id);

    assertEquals((await s.invoices.listByUser("u-1")).length, 1);
    const reloaded = await s.quotes.getOwned(quote.id, "u-1");
    assert(reloaded.acceptedNotifiedAt, "stamp still lands on a no-op billing");
  });
});

Deno.test("send-signed-confirmation run: customer with an email gets the confirmation with the Agreement PDF attached", async () => {
  await withKv(async () => {
    const s = freshRun();
    const customer = await s.customers.create("u-1", {
      name: "Tom K.",
      email: "tom@example.com",
    });
    const quote = await s.quotes.create("u-1", {
      summary: "Fence",
      lineItems: [],
      customerId: customer.id,
      estimatedTotal: 400_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });

    const result = await s.flow.run(quote.id);

    assertEquals(result.ok, true);
    assertEquals(s.sentEmails.length, 1);
    assertEquals(s.sentEmails[0].to, "tom@example.com");
    const attachments = s.sentEmails[0].attachments ?? [];
    assertEquals(attachments.length, 1);
    assert(
      attachments[0].name.startsWith("Agreement-"),
      "PDF attachment is the agreement",
    );
  });
});

Deno.test("send-signed-confirmation run: no customer email → invoices still created, ok via invoiceId", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Fence",
      lineItems: [],
      estimatedTotal: 400_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });

    const result = await s.flow.run(quote.id);

    assertEquals(result.ok, true);
    assertEquals(result.reason, "no_customer_email");
    assertEquals(s.sentEmails.length, 0);
    assertEquals((await s.invoices.listByUser("u-1")).length, 1);
  });
});
