/**
 * REQ-753 (demo-loop cycle 5v1, M10, verifier) — in John Miller's Q-001
 * thread, "Change Dana Whitfield's quote: add post caps for $300" got
 *   "I couldn't find a quote for Dana Whitfield, so I didn't make a new one."
 * though her Q-002 existed (her own thread could change it). Q-002 was a chat
 * draft, "Fence install — Dana Whitfield", with no customer linked; only the
 * bound quote's own name was read. Real stores, in-memory KV.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { ApplyChatChangeOrder } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

for (const danOnFile of [false, true]) {
  Deno.test(
    `REQ-753 M10: from John's Q-001 thread, 'add post caps for $300' naming Dana Whitfield lands on her Q-002 (${
      danOnFile ? "Dana on file, Q-002 not linked" : "no Dana record"
    })`,
    async () => {
      Deno.env.set("KV_PATH", ":memory:");
      await resetKv();
      const quotes = new QuoteStore();
      const customers = new CustomerStore();
      const alert = {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert;
      const flow = new ApplyChatChangeOrder(
        quotes,
        new InvoiceStore(),
        new ChangeOrderStore(),
        customers,
        alert,
      );
      const johnRec = await customers.create("u-1", { name: "John Miller" });
      if (danOnFile) {
        await customers.create("u-1", { name: "Dana Whitfield" } as never);
      }
      const q1 = await quotes.create("u-1", {
        summary: "Deck repair — John Miller",
        customerId: johnRec.id,
        lineItems: [{
          description: "Deck boards",
          quantity: 1,
          unit: "job",
          price: 200_000,
        }],
        estimatedTotal: 200_000,
      } as never);
      const q2 = await quotes.create("u-1", {
        summary: "Fence install — Dana Whitfield",
        lineItems: [{
          description: "Cedar fence",
          quantity: 1,
          unit: "job",
          price: 450_000,
        }],
        estimatedTotal: 450_000,
      } as never);
      assertEquals([q1.number, q2.number], ["Q-001", "Q-002"]);

      const res = await flow.run({
        userId: "u-1",
        lang: "en",
        boundQuoteId: q1.id,
        customerName: "Dana Whitfield",
        description: "Post caps",
        deltaAmountCents: 30_000,
        userText: "Change Dana Whitfield's quote: add post caps for $300",
      });

      assertEquals(res.outcome, {
        kind: "draft_updated",
        quoteId: q2.id,
        quoteNumber: "Q-002",
      }, res.text);
      assertStringIncludes(res.text, "Post caps");
      const after = await quotes.get(q2.id);
      assertEquals(
        after?.lineItems.find((l) => l.description === "Post caps")?.price,
        30_000,
      );
      // John's quote is untouched
      assertEquals((await quotes.get(q1.id))?.lineItems.length, 1);
      await resetKv();
    },
  );
}
