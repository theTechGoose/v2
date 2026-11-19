/**
 * REQ-1126 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, q3-54
 * ("An invoice issued already overdue emails as 'pay whenever you're
 * ready'"). REQ-962 allows a backdated issue date, so a bill issued
 * 2026-10-01 on Net 7 is past due the moment it is sent. The /invoices board
 * says "42d overdue"; the email must not say "pay whenever you're ready" /
 * "pagar cuando quieras" and its Status row must not read "Sent".
 *
 * 2026-10-08 is in the past for every run from 2026-11-19 on; the control
 * due date (2099-12-31) is in the future for every run.
 */
import { assert, assertEquals } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { t } from "@core/i18n/mod.ts";
import { invoiceEmailStatusKey, invoiceStatusLabel } from "#quote-flow/email-format.ts";
import { renderInvoiceBasicHtml, renderInvoiceHtml } from "./mod.ts";

const PAST_DUE = "2026-10-08"; // issued 2026-10-01, Net 7
const FUTURE_DUE = "2099-12-31";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizOf = (lang: "en" | "es") =>
  ({ userId: "u-carl", businessName: "Jensen Electric LLC", commsLanguage: lang }) as BusinessIdentity;
const quote = {
  id: "q-1",
  userId: "u-carl",
  number: "Q-001",
  version: 1,
  status: "accepted",
  customerSnapshot: { name: "Pat Doe" },
  summary: "Panel upgrade",
  lineItems: [{ description: "Panel upgrade", quantity: 1, price: 248975 }],
  estimatedTotal: 248975,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
} as unknown as Quote;
const sentInvoice = (withQuote: boolean, dueDate: string) =>
  ({
    id: "i-1",
    userId: "u-carl",
    number: "INV-001",
    ...(withQuote ? { quoteId: "q-1" } : { jobName: "Panel upgrade" }),
    status: "sent",
    amount: 248975,
    issuedDate: "2026-10-01",
    dueDate,
    billTo: { name: "Pat Doe" },
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
  }) as unknown as Invoice;

const WHENEVER = { en: "whenever you", es: "cuando quieras" };

function render(withQuote: boolean, lang: "en" | "es", dueDate: string): string {
  const i = sentInvoice(withQuote, dueDate);
  return withQuote
    ? renderInvoiceHtml(i, undefined, carl, bizOf(lang), quote)
    : renderInvoiceBasicHtml(i, undefined, carl, bizOf(lang), lang);
}

/** The Status / Estado cell of the details table (standalone email). */
function statusCellOf(html: string, lang: "en" | "es"): string {
  const label = t(lang, "paperworkEmail.invoice.statusLabel");
  const at = html.indexOf(`>${label}<`);
  assert(at >= 0, `the email has a "${label}" row`);
  const m = html.slice(at).match(/<\/td><td[^>]*>([^<]*)<\/td>/);
  assert(m, "the status row has a value cell");
  return m[1].trim();
}

function withClock<T>(fn: () => T): T {
  return fn(); // the real clock: PAST_DUE is behind it, FUTURE_DUE ahead
}

for (const lang of ["en", "es"] as const) {
  for (const withQuote of [false, true]) {
    const kind = withQuote ? "itemized (renderInvoiceHtml)" : "standalone (renderInvoiceBasicHtml)";

    Deno.test(`REQ-1126 (LOOP-007 q3-54) ${kind} ${lang}: an invoice due ${PAST_DUE} sent on 2026-11-19 never says '${WHENEVER[lang]}'`, () => {
      const html = withClock(() => render(withQuote, lang, PAST_DUE));
      assert(
        !html.includes(WHENEVER[lang]),
        `past-due ${lang} ${kind} email says "${WHENEVER[lang]}": ${
          (html.match(new RegExp(`[^<>]{0,80}${WHENEVER[lang]}[^<>]{0,40}`)) ?? [""])[0].trim()
        }`,
      );
    });

    Deno.test(`REQ-1126 (LOOP-007 q3-54) ${kind} ${lang}: control — an invoice due ${FUTURE_DUE} keeps the not-yet-due intro`, () => {
      const html = withClock(() => render(withQuote, lang, FUTURE_DUE));
      assert(html.includes(WHENEVER[lang]), `a not-yet-due ${lang} email lost "${WHENEVER[lang]}"`);
    });
  }

  Deno.test(`REQ-1126 (LOOP-007 q3-54) standalone ${lang}: the Status row of a past-due sent invoice reads overdue, not Sent`, () => {
    const html = withClock(() => render(false, lang, PAST_DUE));
    assertEquals(
      statusCellOf(html, lang),
      invoiceStatusLabel("overdue", lang),
      `the ${lang} Status row of an invoice due ${PAST_DUE} (today 2026-11-19)`,
    );
  });

  Deno.test(`REQ-1126 (LOOP-007 q3-54) standalone ${lang}: control — the Status row of a not-yet-due sent invoice still reads Sent`, () => {
    const html = withClock(() => render(false, lang, FUTURE_DUE));
    assertEquals(statusCellOf(html, lang), invoiceStatusLabel("sent", lang));
  });
}

Deno.test("REQ-1126 (LOOP-007 q3-54) invoiceEmailStatusKey: a sent invoice whose due date has passed is overdue", () => {
  const key = withClock(() => invoiceEmailStatusKey({ status: "sent", dueDate: PAST_DUE } as never));
  assertEquals(key, "overdue", `status key for a sent invoice due ${PAST_DUE} on 2026-11-19`);
});

Deno.test("REQ-1126 (LOOP-007 q3-54) invoiceEmailStatusKey: a paid or void invoice past its due date is not overdue", () => {
  withClock(() => {
    assertEquals(invoiceEmailStatusKey({ status: "paid", dueDate: PAST_DUE } as never), "paid");
    assertEquals(invoiceEmailStatusKey({ status: "void", dueDate: PAST_DUE } as never), "void");
  });
});
