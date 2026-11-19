/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-43: the quote and invoice emails show
 * the contractor's phone the way Settings and the public quote do,
 * "(512) 555-0700" (shared fmtPhone), not a second "+1 (512) 555-0700" form.
 * The tap-to-call link keeps the dialable E.164. REVISION of REQ-719's display
 * string; REQ-719's no-raw-E.164 intent stands.
 */
import { assert, assertMatch, assertStringIncludes } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceHtml, renderQuoteHtml } from "./mod.ts";

const marcus = {
  id: "u-1",
  name: "Marcus Reyes",
  email: "marcus@example.com",
  phoneNumber: "+15125550700",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = {
  userId: "u-1",
  businessName: "Reyes Roofing",
  commsLanguage: "en",
} as BusinessIdentity;
const quote = {
  id: "q-1",
  userId: "u-1",
  number: "Q-001",
  version: 1,
  status: "sent",
  customerSnapshot: { name: "Dana Pruitt" },
  summary: "Roof repair",
  lineItems: [{ description: "Roof repair", quantity: 1, price: 50000 }],
  estimatedTotal: 50000,
  createdAt: "2026-11-18T12:00:00Z",
  updatedAt: "2026-11-18T12:00:00Z",
} as unknown as Quote;
const invoice = {
  id: "i-1",
  userId: "u-1",
  number: "INV-1",
  quoteId: "q-1",
  status: "sent",
  amount: 50000,
  billTo: { name: "Dana Pruitt" },
  createdAt: "2026-11-18T12:00:00Z",
  updatedAt: "2026-11-18T12:00:00Z",
} as unknown as Invoice;

const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ");

function assertOneFormat(html: string) {
  const text = visibleText(html);
  assertStringIncludes(text, "(512) 555-0700");
  assert(!text.includes("+1 (512)"), `the email shows the '+1 (512) …' form, Settings shows '(512) 555-0700'`);
  assert(!text.includes("+15125550700"), "raw E.164 in the email text");
  assertMatch(html, /href="tel:\+15125550700"/);
}

Deno.test("REQ-965 (q1-43) the quote email shows the contractor phone as '(512) 555-0700', the same as Settings and the public quote", () => {
  assertOneFormat(renderQuoteHtml(quote, undefined, marcus, biz));
});

Deno.test("REQ-965 (q1-43) the invoice email shows the contractor phone as '(512) 555-0700', the same as Settings and the public invoice", () => {
  assertOneFormat(renderInvoiceHtml(invoice, undefined, marcus, biz, quote));
});
