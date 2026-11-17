/**
 * REQ-654 (demo-loop cycle 5, M10, pair 5) — the chat's own Q-001 draft,
 * "Kitchen remodel — Dana Whitfield", Edit → "Change the quote: cabinets
 * $7,000": the model named Dana, the draft had no customer linked yet, and
 * the reply was "I couldn't find a quote for Dana Whitfield, so I changed
 * nothing." with the quote right above it. Real stores, in-memory KV.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { ReviseQuote } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const LINES = [
  { description: "Demolition", quantity: 1, unit: "job", price: 150_000 },
  {
    description: "New cabinets installation",
    quantity: 1,
    unit: "job",
    price: 650_000,
  },
  {
    description: "Quartz countertops installation",
    quantity: 1,
    unit: "job",
    price: 420_000,
  },
  { description: "Plumbing", quantity: 1, unit: "job", price: 270_000 },
];

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  return { quotes, customers, revise: new ReviseQuote(quotes, customers) };
}

for (const withRecord of [false, true]) {
  Deno.test(
    `REQ-654 M10: 'cabinets $7,000' naming Dana Whitfield changes the bound draft (${
      withRecord ? "Dana on file, draft not linked" : "no customer record yet"
    })`,
    async () => {
      const { quotes, customers, revise } = await fresh();
      if (withRecord) {
        await customers.create("u-1", { name: "Dana Whitfield" } as never);
      }
      const draft = await quotes.create("u-1", {
        summary: "Kitchen remodel — Dana Whitfield",
        lineItems: LINES,
      } as never);
      const out = await revise.run({
        userId: "u-1",
        lang: "en",
        boundQuoteId: draft.id,
        customerName: "Dana Whitfield",
        lines: [{ match: "cabinets", amountCents: 700_000 }],
        remove: [],
        userText: "Change the quote: cabinets $7,000",
      });
      assertEquals(out.outcome.kind, "draft_updated", out.text);
      assertStringIncludes(out.text, "$7,000");
      const after = await quotes.get(draft.id);
      assertEquals(
        after?.lineItems.find((l) => /cabinets/i.test(l.description))
          ?.price,
        700_000,
      );
      await resetKv();
    },
  );
}
