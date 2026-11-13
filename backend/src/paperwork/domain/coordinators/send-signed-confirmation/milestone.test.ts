import { assert, assertEquals } from "#std/assert";
import {
  completionTerms,
  computeMilestoneAmounts,
  computeScheduledDates,
  SendSignedConfirmation,
} from "./mod.ts";
import { t } from "@core/i18n/mod.ts";
import { payNowTarget } from "#documents/linked-view.ts";
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
import { termLabel } from "#quote-flow/terms-i18n.ts";

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
const plusDaysIso = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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

Deno.test("REQ-240 (M29) send-signed-confirmation run: NO payment terms → accept still bills — one full-amount invoice on the standard net-7, never due the same day", async () => {
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
    assertEquals(
      rows[0].dueDate,
      plusDaysIso(7),
      "a quote nobody agreed payment terms on is not due the day it is signed",
    );
    assertEquals(result.invoiceId, rows[0].id);
  });
});

Deno.test("REQ-240 (M29) send-signed-confirmation run: NO payment terms + a completion date after net-7 → the invoice is due on completion", async () => {
  await withKv(async () => {
    const s = freshRun();
    const completion = plusDaysIso(30);
    const quote = await s.quotes.create("u-1", {
      summary: "Patio",
      lineItems: [],
      estimatedTotal: 750_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      estimatedCompletionDate: completion,
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].dueDate, completion);
  });
});

Deno.test("REQ-240 (M29) send-signed-confirmation run: a signed quote with NO customer on file bills the signer by name — the invoice never reads 'Bill to —'", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Patio",
      lineItems: [],
      estimatedTotal: 750_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "Maria Lopez",
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].customerId, undefined);
    assertEquals(rows[0].billTo?.name, "Maria Lopez");
  });
});

Deno.test("REQ-240 (M29) send-signed-confirmation run: a quote WITH a customer bills that customer (no billTo override)", async () => {
  await withKv(async () => {
    const s = freshRun();
    const cust = await s.customers.create("u-1", { name: "Maria Lopez" });
    const quote = await s.quotes.create("u-1", {
      customerId: cust.id,
      summary: "Patio",
      lineItems: [],
      estimatedTotal: 750_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "M. Lopez",
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows[0].customerId, cust.id);
    assertEquals(rows[0].billTo, undefined);
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

// REQ-204 / REQ-201 — the signed confirmation names the agreement by its number
// (Q-001), never an id slice, and shows the customer as snapshotted.
Deno.test("REQ-204 send-signed-confirmation run: the email subject, body and PDF attachment name say Q-001 (no id slice), and the customer is the snapshot", async () => {
  await withKv(async () => {
    const s = freshRun();
    const customer = await s.customers.create("u-1", {
      name: "Randall Belknap",
      email: "rb@acme.test",
    });
    const quote = await s.quotes.create("u-1", {
      customerId: customer.id,
      summary: "Deck build",
      lineItems: [],
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedName: "Randall Belknap",
    });
    assertEquals(quote.number, "Q-001");
    await s.customers.update(customer.id, "u-1", { name: "Someone Else" });

    const result = await s.flow.run(quote.id);
    assertEquals(result.ok, true);
    assertEquals(s.sentEmails.length, 1);
    const mail = s.sentEmails[0];
    const idSlice = quote.id.slice(0, 8).toUpperCase();
    assert(
      mail.subject.includes("Q-001"),
      `subject names Q-001: ${mail.subject}`,
    );
    assert(mail.htmlBody.includes("Q-001"), "body names Q-001");
    assert(!mail.htmlBody.includes(`#${idSlice}`), "no id slice in the body");
    assertEquals(mail.attachments?.[0]?.name, "Agreement-Q-001.pdf");
    assert(mail.htmlBody.includes("Randall"), "the snapshotted customer");
    assert(
      !mail.htmlBody.includes("Someone"),
      "the renamed live record does not rewrite the agreement",
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-316 (demo-loop cycle 1, M12) — "Payment upon completion" / "Net N"
// terms bill AFTER the job: signing schedules the single milestone for the
// completion date, it is never `sent` at signing, and the signed /q shows no
// "Pay now".
// ---------------------------------------------------------------------------

// REQ-411 (cycle 2, m35) AMENDMENT: "upon completion" carries the account's
// days to pay — unset, the 30 Settings shows (was a hard-coded 15).
Deno.test("REQ-316 (M12) completionTerms: 'Payment upon completion' is a completion term with the account's net days (default 30, REQ-411); 'Net N' carries N; due-now / splits / custom are not", () => {
  assertEquals(completionTerms("Payment upon completion"), { netDays: 30 });
  assertEquals(completionTerms("payment on completion", 15), { netDays: 15 });
  assertEquals(completionTerms("Net 30"), { netDays: 30 });
  assertEquals(completionTerms("net-7"), { netDays: 7 });
  assertEquals(completionTerms("Due now"), undefined);
  assertEquals(completionTerms("50 / 50"), undefined);
  assertEquals(completionTerms("Deposit + balance"), undefined);
  assertEquals(completionTerms("haggle in person"), undefined);
  assertEquals(completionTerms(undefined), undefined);
});

Deno.test("REQ-316 (M12) the net_15 option's sub-line no longer contradicts its label with 'Same-day payment' (en + es)", () => {
  for (
    const key of [
      "termsWizard.paymentTerms.net15.sub",
      "asstChat.terms.payment.onCompletionSub",
      "assistantDemo.wiz.optCompletionSub",
    ]
  ) {
    assert(
      !/same-day/i.test(t("en", key)),
      `${key} (en) still says same-day: ${t("en", key)}`,
    );
    assert(
      !/mismo día/i.test(t("es", key)),
      `${key} (es) still says mismo día: ${t("es", key)}`,
    );
    // REQ-411: the wizard keys name the account's days ({n}); the
    // marketing demo keeps its fixed example.
    const days = key === "assistantDemo.wiz.optCompletionSub" ? /15/ : /\{n\}/;
    assert(
      days.test(t("en", key)) && days.test(t("es", key)),
      `${key} names the days to pay`,
    );
  }
  // The label is the stored EN base every reader localizes — unchanged.
  assertEquals(
    t("en", "termsWizard.paymentTerms.net15.label"),
    "Payment upon completion",
  );
});

Deno.test("REQ-316 (M12) send-signed-confirmation run: 'Payment upon completion' + a completion date → ONE scheduled invoice for that date, due +30 (the account default, REQ-411), nothing sent, no Pay now", async () => {
  await withKv(async () => {
    const s = freshRun();
    const completion = plusDaysIso(30);
    const quote = await s.quotes.create("u-1", {
      summary: "Bathroom tile",
      lineItems: [],
      estimatedTotal: 280_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      startDate: plusDaysIso(3),
      estimatedCompletionDate: completion,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
    });

    const result = await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].amount, 280_00);
    assertEquals(rows[0].status, "scheduled");
    assertEquals(rows[0].issuedDate, undefined, "not issued at signing");
    assertEquals(rows[0].scheduledFor, completion);
    assertEquals(
      rows[0].dueDate,
      plusDaysIso(60),
      "due the account's default 30 days after completion (REQ-411)",
    );
    assertEquals(rows[0].installmentIndex, 1);
    assertEquals(rows[0].installmentTotal, 1);
    assertEquals(result.invoiceId, undefined, "no invoice to pay yet");
    assertEquals(result.ok, true, "the milestone was still billed");
    const reloaded = await s.quotes.getOwned(quote.id, "u-1");
    assert(reloaded.acceptedNotifiedAt, "acceptedNotifiedAt stamped");

    // The signed /q page's "Pay now" (REQ-251) finds nothing to pay.
    assertEquals(
      payNowTarget({
        status: "accepted",
        invoices: rows.map((i) => ({
          id: i.id,
          number: i.number ?? "",
          status: i.status,
          amountCents: i.amount,
          paidCents: 0,
        })),
      }),
      undefined,
    );
  });
});

Deno.test("REQ-316 (M12) send-signed-confirmation run: 'Payment upon completion' with NO completion date → scheduled 14 days after the later of start and today", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Fence",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "scheduled");
    assertEquals(rows[0].scheduledFor, plusDaysIso(14));
    assertEquals(rows[0].dueDate, plusDaysIso(44)); // REQ-411: +30 default
  });
});

Deno.test("REQ-316 (M12) send-signed-confirmation run: 'Net 30' → scheduled for completion, due completion+30", async () => {
  await withKv(async () => {
    const s = freshRun();
    const completion = plusDaysIso(10);
    const quote = await s.quotes.create("u-1", {
      summary: "Roof",
      lineItems: [],
      estimatedTotal: 900_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      estimatedCompletionDate: completion,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Net 30",
      }],
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "scheduled");
    assertEquals(rows[0].scheduledFor, completion);
    assertEquals(rows[0].dueDate, plusDaysIso(40));
  });
});

// REQ-678 (demo-loop cycle 5, c3-m60): the deposit the contractor picked in
// the wizard is the deposit the invoices bill — a percentage or a $ amount.
Deno.test("REQ-678 c3-m60 computeMilestoneAmounts: 'Deposit 30% + balance' → 30/70, 'Deposit $500 + balance' → $500 then the rest", () => {
  assertEquals(
    computeMilestoneAmounts(1000_00, pterms("Deposit 30% + balance")),
    [300_00, 700_00],
  );
  assertEquals(
    computeMilestoneAmounts(4500_00, pterms("Deposit $500 + balance")),
    [500_00, 4000_00],
  );
});

// REQ-665 (demo-loop cycle 5, m47): the custom payment picker now stores a
// worded split ("Due Now" / "Pago inmediato" for 100/0, "50% upfront, 50% on
// completion", "30% / 40% / 30%") instead of a bare "100 / 0". The bill read
// off the signed agreement must match the words on it.
for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-665 send-signed-confirmation run: the picker's 100/0 (${lang}) bills ONE invoice due the day of signing`, async () => {
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
          value: termLabel({ kind: "payment", value: { splits: [100, 0] } }, lang),
        }],
      });

      await s.flow.run(quote.id);

      const rows = await s.invoices.listByUser("u-1");
      assertEquals(rows.length, 1);
      assertEquals(rows[0].amount, 300_00);
      assertEquals(rows[0].dueDate, todayIso());
    });
  });
}

Deno.test("REQ-665 computeMilestoneAmounts: the picker's worded splits bill the stated shares", () => {
  const label = (splits: number[], lang: "en" | "es") =>
    termLabel({ kind: "payment", value: { splits } }, lang);
  assertEquals(computeMilestoneAmounts(100_00, pterms(label([30, 70], "en"))), [30_00, 70_00]);
  assertEquals(computeMilestoneAmounts(100_00, pterms(label([30, 70], "es"))), [30_00, 70_00]);
  assertEquals(
    computeMilestoneAmounts(1_000_00, pterms(label([30, 40, 30], "en"))),
    [300_00, 400_00, 300_00],
  );
});

Deno.test("REQ-665 completionTerms: the picker's 0/100 bills after completion in both languages", () => {
  for (const lang of ["en", "es"] as const) {
    const v = termLabel({ kind: "payment", value: { splits: [0, 100] } }, lang);
    assertEquals(completionTerms(v, 15), { netDays: 15 });
  }
});
