/**
 * REQ-719 — demo-loop cycle 5, issues p18-1c + p18-2b ("Email preview shows
 * contractor phone raw '+15125550100'"): the quote and invoice emails show the
 * contractor's US phone formatted ("+1 (512) 555-0100"), never as the stored
 * E.164, while the tel: link keeps the dialable E.164.
 */
import { assert, assertMatch, assertStringIncludes } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceHtml, renderQuoteHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  email: "carl@example.com",
  phoneNumber: "+15125550100",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = {
  userId: "u-carl",
  businessName: "Jensen Electric LLC",
  commsLanguage: "en",
} as BusinessIdentity;
const items = [{ description: "Panel upgrade", quantity: 1, price: 250000 }];
const quote = {
  id: "q-1",
  userId: "u-carl",
  number: "Q-001",
  version: 1,
  status: "sent",
  customerSnapshot: { name: "Pat Doe" },
  summary: "Panel upgrade",
  lineItems: items,
  estimatedTotal: 250000,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
} as unknown as Quote;
const invoice = {
  id: "i-1",
  userId: "u-carl",
  number: "INV-1",
  quoteId: "q-1",
  status: "sent",
  amount: 250000,
  billTo: { name: "Pat Doe" },
  createdAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
} as unknown as Invoice;

const PRETTY = "+1 (512) 555-0100";

/** Visible text only: tags (and their attributes, i.e. hrefs) stripped. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ");

function assertPhoneFormatted(html: string, { telLink = true } = {}) {
  const text = visibleText(html);
  assert(
    !text.includes("+15125550100"),
    "raw E.164 phone shown in the email text",
  );
  assertStringIncludes(text, PRETTY);
  // the tap-to-call link stays dialable (the basic invoice has no Questions card, so no link)
  if (telLink) assertMatch(html, /href="tel:\+15125550100"/);
}

Deno.test("REQ-719 the quote email shows the contractor phone formatted, tel: link stays E.164", () => {
  assertPhoneFormatted(renderQuoteHtml(quote, undefined, carl, biz));
});

Deno.test("REQ-719 the invoice email shows the contractor phone formatted, tel: link stays E.164", () => {
  assertPhoneFormatted(renderInvoiceHtml(invoice, undefined, carl, biz, quote));
});

Deno.test("REQ-719 the basic invoice email (no quote) shows the contractor phone formatted", () => {
  assertPhoneFormatted(renderInvoiceHtml(invoice, undefined, carl, biz), {
    telLink: false,
  });
});

Deno.test("REQ-719 a non-US phone is shown as stored, not mangled", () => {
  const intl = { ...carl, phoneNumber: "+442071838750" } as User;
  const text = visibleText(renderQuoteHtml(quote, undefined, intl, biz));
  assertStringIncludes(text, "+442071838750");
});
