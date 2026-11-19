/**
 * REQ-946 — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green." LOOP-007 cycle 1, issue q1-19: "Single-line
 * quote email has no work description, though its intro promises line items
 * below."
 *
 * The quote email hides a single qty-1 line ("the Job details block above
 * already covers the scope", P-51) and shows Job details only when the quote
 * has a description. An assistant / quick quote keeps its scope in the one
 * line and leaves `description` empty, so it fails both gates: the customer
 * reads "Quick read — line items below…" and then only a total. The invoice
 * email has the same pair of gates.
 */
import { assert, assertStringIncludes } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { t } from "@core/i18n/mod.ts";
import { renderInvoiceHtml, renderQuoteHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = (lang: "en" | "es") =>
  ({
    userId: "u-carl",
    businessName: "Jensen Flooring LLC",
    commsLanguage: lang,
  }) as BusinessIdentity;

/** The line's text differs from the summary, so a hit can only come from the scope block. */
const LINE = "Retirar baldosa vieja y colocar piso nuevo";

function quote(extra: Partial<Quote> = {}): Quote {
  return {
    id: "q-2",
    userId: "u-carl",
    number: "Q-002",
    version: 1,
    status: "sent",
    lang: "es",
    customerSnapshot: { name: "Pat Doe" },
    summary: "Cambio de piso de cocina",
    lineItems: [{ description: LINE, quantity: 1, unit: "job", price: 345000 }],
    estimatedTotal: 345000,
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
    ...extra,
  } as unknown as Quote;
}

const invoice = {
  id: "i-2",
  userId: "u-carl",
  number: "INV-002",
  quoteId: "q-2",
  status: "sent",
  amount: 345000,
  billTo: { name: "Pat Doe" },
  dueDate: "2026-12-30",
  createdAt: "2026-11-12T12:00:00Z",
  updatedAt: "2026-11-12T12:00:00Z",
} as unknown as Invoice;

for (const lang of ["es", "en"] as const) {
  Deno.test(
    `REQ-946 (q1-19) ${lang}: a one-line qty-1 quote with no description still shows its scope under "${
      t(lang, "paperworkEmail.quote.whatWeHandle")
    }"`,
    () => {
      const html = renderQuoteHtml(quote(), undefined, carl, biz(lang));
      // the intro promises line items below
      assertStringIncludes(html, t(lang, "paperworkEmail.quote.introTail"));
      assert(
        html.includes(LINE),
        "the only line — the whole scope of work — is missing from the email",
      );
      assert(
        html.includes(t(lang, "paperworkEmail.quote.whatWeHandle")),
        "no line-item block, though the intro says the line items are below",
      );
    },
  );

  Deno.test(`REQ-946 (q1-19) ${lang}: a one-line qty-1 quote WITH a description keeps its Job details block (P-51 intent)`, () => {
    const html = renderQuoteHtml(
      quote({ description: "Kitchen floor: tear-out and new tile" }),
      undefined,
      carl,
      biz(lang),
    );
    assertStringIncludes(html, t(lang, "paperworkEmail.quote.jobDetails"));
    assertStringIncludes(html, "Kitchen floor: tear-out and new tile");
  });

  Deno.test(`REQ-946 (q1-19) ${lang}: the invoice email of a one-line qty-1 quote with no description still shows its scope`, () => {
    const html = renderInvoiceHtml(
      invoice,
      undefined,
      carl,
      biz(lang),
      quote(),
    );
    assert(
      html.includes(LINE),
      "the invoice email for the one-line quote never names the work",
    );
    assert(
      html.includes(t(lang, "paperworkEmail.quote.whatWeHandle")),
      "no line-item block in the invoice email either",
    );
  });
}
