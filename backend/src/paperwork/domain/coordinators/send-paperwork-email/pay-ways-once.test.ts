/**
 * REQ-1117 (LOOP-007 cycle 3, q3-42) — "Invoice email lists the payment method twice". QA3 002:
 * the unpaid invoice email read "Payment instructions: Zelle: dana@whitfieldfence.com" and then
 * "Ways to pay: Zelle: send to dana@whitfieldfence.com". The instructions were frozen from the
 * same accepted methods (paymentInstructionsFromMethods) the Ways-to-pay block (payWaysEmailHtml)
 * lists, so every way appeared twice. Each payment way appears once; text the owner wrote
 * beyond the method list stays; with no Ways-to-pay block (check only, REQ-630) the payment
 * instructions are the only place that says how to pay, so they stay.
 */
import { assert, assertEquals } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { payWaysEmailHtml } from "@paperwork/domain/business/pay-ways/mod.ts";
import { paymentInstructionsFromMethods } from "#documents/invoice-form.ts";
import { renderInvoiceBasicHtml, renderInvoiceHtml } from "./mod.ts";

const HANDLE = "dana@whitfieldfence.com";
const ZELLE = { zelle: { enabled: true, handle: HANDLE } };
const CHECK_ONLY = { check: { enabled: true, mailTo: "PO Box 77, Austin TX" } };
const NOTE = "Put the invoice number in the memo";

const dana = {
  id: "u-dana",
  name: "Dana Whitfield",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizOf = (lang: "en" | "es", apm: unknown) =>
  ({
    userId: "u-dana",
    businessName: "Whitfield Fence Co",
    commsLanguage: lang,
    acceptedPaymentMethods: apm,
  }) as unknown as BusinessIdentity;
const quote = {
  id: "q-1",
  userId: "u-dana",
  number: "Q-001",
  version: 1,
  status: "accepted",
  customerSnapshot: { name: "Pat Doe" },
  summary: "Cedar fence",
  lineItems: [{ description: "Cedar fence", quantity: 1, price: 480000 }],
  estimatedTotal: 480000,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
} as unknown as Quote;
const invoiceOf = (withQuote: boolean, paymentInstructions: string) =>
  ({
    id: "i-1",
    userId: "u-dana",
    number: "INV-001",
    ...(withQuote ? { quoteId: "q-1" } : {}),
    status: "sent",
    amount: 480000,
    dueDate: "2026-12-04",
    issuedDate: "2026-11-19",
    billTo: { name: "Pat Doe" },
    paymentInstructions,
    createdAt: "2026-11-19T12:00:00Z",
    updatedAt: "2026-11-19T12:00:00Z",
  }) as unknown as Invoice;

/** the email exactly as the coordinator builds it (send-paperwork-email run(): payWays + render) */
function render(
  shape: "itemized" | "basic",
  lang: "en" | "es",
  apm: unknown,
  paymentInstructions: string,
): string {
  const biz = bizOf(lang, apm);
  const inv = invoiceOf(shape === "itemized", paymentInstructions);
  const payWays = payWaysEmailHtml(apm, {
    card: false,
    lang,
    payUrl: "https://documonster.com/i/i-1",
    amountCents: 480000,
    note: "INV-001",
  });
  return shape === "itemized"
    ? renderInvoiceHtml(inv, undefined, dana, biz, quote, false, [], payWays)
    : renderInvoiceBasicHtml(inv, undefined, dana, biz, lang, false, payWays);
}

const count = (html: string, s: string) => html.split(s).length - 1;

for (const lang of ["en", "es"] as const) {
  for (const shape of ["itemized", "basic"] as const) {
    Deno.test(`REQ-1117 (q3-42) ${shape} invoice email (${lang}), Zelle on, instructions from the methods: the Zelle handle appears once and there is no separate Payment instructions block`, () => {
      const instructions = paymentInstructionsFromMethods(ZELLE, lang);
      assertEquals(
        instructions,
        `Zelle: ${HANDLE}`,
        "the form's instructions for a Zelle-only business",
      );
      const html = render(shape, lang, ZELLE, instructions);
      assert(
        html.includes(`data-pay-way="zelle"`),
        "the Ways-to-pay block has its Zelle row",
      );
      assertEquals(
        {
          handleCount: count(html, HANDLE),
          paymentInstructionsBlock: html.includes("data-payment-instructions"),
        },
        { handleCount: 1, paymentInstructionsBlock: false },
        `the ${lang} ${shape} invoice email lists Zelle twice (Payment instructions + Ways to pay)`,
      );
    });

    Deno.test(`REQ-1117 (q3-42) ${shape} invoice email (${lang}), Zelle on + the owner's own note: the note stays, the handle still appears once`, () => {
      const instructions = `${
        paymentInstructionsFromMethods(ZELLE, lang)
      }\n${NOTE}`;
      const html = render(shape, lang, ZELLE, instructions);
      assert(html.includes(NOTE), `the owner's note "${NOTE}" is dropped`);
      assertEquals(
        count(html, HANDLE),
        1,
        `the ${lang} ${shape} email prints the Zelle handle ${
          count(html, HANDLE)
        } times`,
      );
    });

    Deno.test(`REQ-1117 (q3-42) ${shape} invoice email (${lang}), check only (no Ways-to-pay block): Payment instructions still say how to pay`, () => {
      const instructions = paymentInstructionsFromMethods(CHECK_ONLY, lang);
      const html = render(shape, lang, CHECK_ONLY, instructions);
      assert(
        !html.includes("data-pay-ways"),
        "a check-only business has no Ways-to-pay block (REQ-630)",
      );
      assert(
        html.includes("data-payment-instructions"),
        "the Payment instructions block is gone",
      );
      assertEquals(
        count(html, "PO Box 77, Austin TX"),
        1,
        "the mail-to address appears once",
      );
    });
  }
}
