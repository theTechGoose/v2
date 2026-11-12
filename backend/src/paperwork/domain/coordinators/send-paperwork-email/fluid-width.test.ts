/**
 * REQ-542 — demo-loop cycle 4, issue m8 ("Text cut off"): the send dialog's
 * email preview was clipped on the right ("Reparación de Grif", "preparó e…").
 * The email card was a fixed `width="600"` (640 for the rich layouts) table
 * shown in a narrower iframe, so it overflowed. Every card table is now fluid:
 * width 100% up to its max-width, which also fits a phone's mail app.
 */
import { assert, assertEquals } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import {
  renderInvoiceBasicHtml,
  renderInvoiceHtml,
  renderQuoteHtml,
} from "./mod.ts";

const user = {
  id: "u-1",
  name: "Carmen Ortega",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = {
  userId: "u-1",
  businessName: "Ortega Handyman Services",
  commsLanguage: "es",
} as BusinessIdentity;
const items = [{
  description: "Reparación de grifo",
  quantity: 1,
  price: 25000,
}];
const quote = {
  id: "q-1",
  userId: "u-1",
  number: "Q-001",
  version: 1,
  status: "sent",
  customerSnapshot: { name: "Carmen Ruiz" },
  summary: "Reparación de grifo y puertas interiores",
  lineItems: items,
  estimatedTotal: 25000,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
} as unknown as Quote;
const invoice = {
  id: "i-1",
  userId: "u-1",
  number: "INV-1",
  quoteId: "q-1",
  status: "sent",
  amount: 25000,
  billTo: { name: "Carmen Ruiz" },
  createdAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
} as unknown as Invoice;

const RENDERS: Array<[string, () => string]> = [
  ["quote", () => renderQuoteHtml(quote, undefined, user, biz)],
  ["invoice", () => renderInvoiceHtml(invoice, undefined, user, biz, quote)],
  [
    "basic invoice",
    () => renderInvoiceBasicHtml(invoice, undefined, user, biz, "es"),
  ],
];

for (const [name, render] of RENDERS) {
  Deno.test(`REQ-542 m8: the ${name} email's tables never demand a fixed pixel width`, () => {
    const html = render();
    const tables = [...html.matchAll(/<table\b[^>]*>/g)].map((m) => m[0]);
    assert(tables.length > 0);
    for (const t of tables) {
      const w = t.match(/\swidth="([^"]+)"/)?.[1];
      if (w !== undefined) assertEquals(w, "100%", `fixed-width table: ${t}`);
      assert(
        !/(^|[;"\s])width\s*:\s*\d+px/.test(
          t.match(/style="([^"]*)"/)?.[1] ?? "",
        ),
        `fixed css width on: ${t}`,
      );
    }
  });

  Deno.test(`REQ-542 m8: the ${name} email's card is fluid up to its max width`, () => {
    const html = render();
    const card = [...html.matchAll(/<table\b[^>]*max-width:\s*(\d+)px[^>]*>/g)];
    assert(card.length > 0, "the card table keeps a max-width");
    for (const m of card) assert(/\swidth="100%"/.test(m[0]), m[0]);
  });
}
