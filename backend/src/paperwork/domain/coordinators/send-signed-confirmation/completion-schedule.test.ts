/**
 * REQ-411 (demo-loop cycle 2, m34 + m35) — a pay-on-completion job bills when
 * the job is done, on the account's own days to pay.
 *
 *   m34: "Próxima cuota: 26 nov" for a job that starts "La próxima semana" and
 *        lasts "4 semanas" — completionScheduledFor ignored the start and
 *        duration TERMS (not ISO dates) and fell back to signing + 14 days.
 *   m35: "Pago al finalizar" said "15 días" while Settings "Days to pay an
 *        invoice" said 30 — completionTerms hard-coded netDays 15 and the
 *        wizard's sub-line hard-coded "15".
 */
import { assert, assertEquals } from "#std/assert";
import {
  completionScheduledFor,
  completionTerms,
  computeScheduledDates,
  SendSignedConfirmation,
} from "./mod.ts";
import { t } from "@core/i18n/mod.ts";
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
import {
  localizeOptions,
  TERMS_WIZARD_V1,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";

const SIGNED = new Date("2026-11-12T15:00:00Z");

function terms(
  start: string | undefined,
  wraps: string | undefined,
): QuoteTerm[] {
  return [
    ...(start ? [{ stepId: "start_date", label: "Start", value: start }] : []),
    ...(wraps
      ? [{ stepId: "wraps", label: "Time to complete", value: wraps }]
      : []),
    {
      stepId: "payment_terms",
      label: "Payment terms",
      value: "Payment upon completion",
    },
  ];
}

Deno.test("REQ-411 (m34) completionScheduledFor: 'Next week' + '4 weeks' → the job ends Dec 17, not signing + 14 (Nov 26)", () => {
  assertEquals(
    completionScheduledFor({ terms: terms("Next week", "4 weeks") }, SIGNED),
    "2026-12-17",
  );
});

Deno.test("REQ-411 (m34) completionScheduledFor reads every start + duration the wizard stores (EN base, localized custom values, ISO / US dates)", () => {
  const at = (s?: string, w?: string) =>
    completionScheduledFor({ terms: terms(s, w) }, SIGNED);
  assertEquals(at("Right away", "1 week"), "2026-11-19");
  assertEquals(at("Next month", "2 weeks"), "2026-12-26");
  assertEquals(at("12/01/2026", "1 day"), "2026-12-02");
  assertEquals(at("2026-12-01", "3 days"), "2026-12-04");
  // a custom Spanish duration (P-25 submits the localized string)
  assertEquals(at("Next week", "4 semanas"), "2026-12-17");
  // a range ends at its upper bound
  assertEquals(at("Right away", "2–3 days"), "2026-11-15");
  // hours finish the day they start
  assertEquals(at("Next week", "4 hours"), "2026-11-19");
  // no duration (or TBD) → the start + the 14-day window it always had
  assertEquals(at("Next week", undefined), "2026-12-03");
  assertEquals(at("Next week", "TBD"), "2026-12-03");
  assertEquals(at(undefined, undefined), "2026-11-26");
  // an ISO completion date on the quote still wins
  assertEquals(
    completionScheduledFor(
      {
        estimatedCompletionDate: "2027-01-05",
        terms: terms("Next week", "4 weeks"),
      },
      SIGNED,
    ),
    "2027-01-05",
  );
  // the quote's own ISO start beats the start term
  assertEquals(
    completionScheduledFor(
      { startDate: "2026-12-10", terms: terms("Next week", "1 week") },
      SIGNED,
    ),
    "2026-12-17",
  );
});

Deno.test("REQ-411 (m35) completionTerms: 'Payment upon completion' bills on the account's days to pay (Settings), default 30 like Settings shows; 'Net N' keeps N", () => {
  assertEquals(completionTerms("Payment upon completion", 21), { netDays: 21 });
  assertEquals(completionTerms("Payment upon completion", 0), { netDays: 0 });
  assertEquals(completionTerms("Payment upon completion"), { netDays: 30 });
  assertEquals(completionTerms("Net 10", 21), { netDays: 10 });
});

Deno.test("REQ-411 (m35) the wizard's 'Payment upon completion' sub-line names the account's days, en + es", () => {
  const payment = TERMS_WIZARD_V1.steps.find((s) => s.id === "payment_terms")!;
  const en = localizeOptions(payment.options, "en", { n: 21 })
    .find((o) => o.id === "net_15")!;
  const es = localizeOptions(payment.options, "es", { n: 21 })
    .find((o) => o.id === "net_15")!;
  assert(/\b21 days\b/.test(en.sub ?? ""), `en sub: ${en.sub}`);
  assert(/\b21 días\b/.test(es.sub ?? ""), `es sub: ${es.sub}`);
  for (
    const key of [
      "termsWizard.paymentTerms.net15.sub",
      "asstChat.terms.payment.onCompletionSub",
    ]
  ) {
    for (const lang of ["en", "es"] as const) {
      const raw = t(lang, key);
      assert(raw.includes("{n}"), `${key} (${lang}) takes {n}: ${raw}`);
      assert(
        !/\b15\b/.test(raw),
        `${key} (${lang}) still hard-codes 15: ${raw}`,
      );
    }
  }
});

function freshRun() {
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const identity = new BusinessIdentityStore();
  const email = new EmailService();
  email.send = (_input: SendEmailInput) =>
    Promise.resolve({ ok: true, reason: "test_capture" });
  const flow = new SendSignedConfirmation(
    quotes,
    invoices,
    new CustomerStore(),
    new UserStore(),
    identity,
    new RenderQuotePdf(),
    email,
    new SmsService(),
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  return { quotes, invoices, identity, flow };
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

const plusDaysIso = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

Deno.test("REQ-411 (m34 + m35) send-signed-confirmation run: 'Next week' + '4 weeks' + 'Payment upon completion' on a 21-day account → ONE invoice scheduled for the job's end (today + 35), due 21 days later", async () => {
  await withKv(async () => {
    const s = freshRun();
    await s.identity.upsert("u-1", { invoiceNetDays: 21 });
    const quote = await s.quotes.create("u-1", {
      summary: "Interior paint",
      lineItems: [],
      estimatedTotal: 400_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: terms("Next week", "4 weeks"),
    });

    await s.flow.run(quote.id);

    const rows = await s.invoices.listByUser("u-1");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].status, "scheduled");
    assertEquals(rows[0].installmentTotal, 1);
    assertEquals(
      rows[0].scheduledFor,
      plusDaysIso(35),
      "bills when the job ends",
    );
    assertEquals(
      rows[0].dueDate,
      plusDaysIso(56),
      "the account's 21 days to pay",
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-475 (demo-loop cycle 3, m63): "Deposit + balance" on a 1-day job that
// starts Nov 20 scheduled its balance invoice "Nov 26, DUE Dec 3" — signing
// (Nov 12) + 14 — because computeScheduledDates read only the quote's ISO
// startDate / estimatedCompletionDate (never set by the quote wizard) and
// ignored the start + duration TERMS that completionScheduledFor reads.

function splitTerms(start: string, wraps: string): QuoteTerm[] {
  return [
    { stepId: "start_date", label: "Start", value: start },
    { stepId: "wraps", label: "Time to complete", value: wraps },
    {
      stepId: "payment_terms",
      label: "Payment terms",
      value: "Deposit + balance",
    },
  ];
}

Deno.test("REQ-475 (m63) computeScheduledDates: Deposit + balance, start 11/20/2026, 1 day → the balance is scheduled for the job's end (Nov 21), not signing + 14 (Nov 26)", () => {
  assertEquals(
    computeScheduledDates(
      2,
      undefined,
      undefined,
      SIGNED,
      splitTerms("11/20/2026", "1 day"),
    ),
    ["2026-11-12", "2026-11-21"],
  );
});

Deno.test("REQ-475 (m63) computeScheduledDates: 30/30/40 over 'Next week' + '2 weeks' spans the job (Nov 19 → Dec 3); a start term with no duration keeps the 14-day window from that start", () => {
  const t = (start: string, wraps?: string): QuoteTerm[] => [
    { stepId: "start_date", label: "Start", value: start },
    ...(wraps
      ? [{ stepId: "wraps", label: "Time to complete", value: wraps }]
      : []),
  ];
  assertEquals(
    computeScheduledDates(
      3,
      undefined,
      undefined,
      SIGNED,
      t("Next week", "2 weeks"),
    ),
    ["2026-11-12", "2026-11-26", "2026-12-03"],
  );
  assertEquals(
    computeScheduledDates(2, undefined, undefined, SIGNED, t("2026-12-01")),
    ["2026-11-12", "2026-12-15"],
  );
  // an ISO estimatedCompletionDate still wins over the duration term
  assertEquals(
    computeScheduledDates(
      2,
      undefined,
      "2026-12-10",
      SIGNED,
      t("Next week", "1 day"),
    ),
    ["2026-11-12", "2026-12-10"],
  );
});

Deno.test("REQ-475 (m63) send-signed-confirmation run: Deposit + balance on a 1-day job starting in 8 days → the balance invoice is scheduled for the job's end (today + 9), due 7 days later", async () => {
  await withKv(async () => {
    const s = freshRun();
    const quote = await s.quotes.create("u-1", {
      summary: "Deep clean",
      lineItems: [],
      estimatedTotal: 450_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: splitTerms(plusDaysIso(8), "1 day"),
    });

    await s.flow.run(quote.id);

    const rows = (await s.invoices.listByUser("u-1"))
      .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0));
    assertEquals(rows.length, 2);
    assertEquals(rows[1].status, "scheduled");
    assertEquals(
      rows[1].scheduledFor,
      plusDaysIso(9),
      "the balance bills when the 1-day job ends",
    );
    assertEquals(rows[1].dueDate, plusDaysIso(16));
  });
});
