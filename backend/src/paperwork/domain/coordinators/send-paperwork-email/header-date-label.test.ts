/**
 * REQ-980 (LOOP-007 q1, q1-61) — QA: the amount-only invoice email said "Drafted November 19,
 * 2026" in its header, right above "Issued November 19, 2026" and "Status: Sent". shell() hard-
 * codes paperworkEmail.shell.draftedLabel for every kind, and renderInvoiceBasicHtml passes the
 * issue date under it. The itemized invoice email labels the same slot "Issued"; the quote email
 * keeps "Drafted".
 */
import { assert, assertStringIncludes } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceBasicHtml, renderQuoteHtml } from "./mod.ts";

const user = {
  id: "u-1",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = (lang: "en" | "es") =>
  ({
    userId: "u-1",
    businessName: "Jensen Electric LLC",
    commsLanguage: lang,
  }) as BusinessIdentity;

const invoice = {
  id: "inv-1",
  userId: "u-1",
  number: "INV-0001",
  version: 1,
  status: "sent",
  amount: 6500,
  jobName: "Lawn care",
  customerSnapshot: { name: "Pat Doe" },
  issuedDate: "2026-11-19",
  dueDate: "2026-11-30",
  createdAt: "2026-11-19T12:00:00Z",
  updatedAt: "2026-11-19T12:00:00Z",
} as unknown as Invoice;

/** The email's top block: everything before the first divider under the kind / number / date. */
const header = (html: string) => {
  const end = html.indexOf("height:1px;background");
  assert(end > 0, "the email has a header divider");
  return html.slice(html.indexOf("<body"), end);
};

for (
  const [lang, issued, drafted] of [
    ["en", "Issued", "Drafted"],
    ["es", "Emitida", "Creada"],
  ] as const
) {
  Deno.test(`REQ-980 (q1-61) [${lang}] a sent amount-only invoice email's header labels its date "${issued}", never "${drafted}"`, () => {
    const top = header(
      renderInvoiceBasicHtml(invoice, undefined, user, biz(lang), lang),
    );
    assert(
      !top.includes(`>${drafted}<`),
      `the invoice header says "${drafted}": ${top.replace(/\s+/g, " ")}`,
    );
    assertStringIncludes(top, `>${issued}<`);
  });
}

Deno.test(`REQ-980 (q1-61) the quote email keeps "Drafted" for its date`, () => {
  const quote = {
    id: "q-1",
    userId: "u-1",
    number: "Q-001",
    version: 1,
    status: "sent",
    customerSnapshot: { name: "Pat Doe" },
    summary: "Panel upgrade",
    lineItems: [{ description: "Panel upgrade", quantity: 1, price: 250000 }],
    estimatedTotal: 250000,
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
  } as unknown as Quote;
  assertStringIncludes(
    renderQuoteHtml(quote, undefined, user, biz("en")),
    "Drafted",
  );
});
