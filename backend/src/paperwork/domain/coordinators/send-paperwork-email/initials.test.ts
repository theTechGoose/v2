/**
 * REQ-502 — demo-loop cycle 3, issue p8-pair10-b ("'CA' vs 'CJ' avatars
 * disagree"): the quote/invoice email's sender avatar uses the same shared
 * initials rule as the sidebar (computeInitials(name, businessName)).
 */
import { assertMatch, assertNotMatch } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { computeInitials } from "@profile/domain/business/initials/mod.ts";
import { renderInvoiceHtml, renderQuoteHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
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

// the avatar disc: the initials sit alone between the div tags
const avatar = (s: string) => new RegExp(`>${s}</div>`);

Deno.test("REQ-502 the sidebar rule gives Carl of Jensen Electric 'CJ'", () => {
  assertMatch(computeInitials("Carl", "Jensen Electric LLC"), /^CJ$/);
});

Deno.test("REQ-502 the quote email's sender avatar reads CJ (the sidebar's), not CA", () => {
  const html = renderQuoteHtml(quote, undefined, carl, biz);
  assertMatch(html, avatar("CJ"));
  assertNotMatch(html, avatar("CA"));
});

Deno.test("REQ-502 the invoice email's sender avatar reads CJ (the sidebar's), not CA", () => {
  const html = renderInvoiceHtml(invoice, undefined, carl, biz, quote);
  assertMatch(html, avatar("CJ"));
  assertNotMatch(html, avatar("CA"));
});
