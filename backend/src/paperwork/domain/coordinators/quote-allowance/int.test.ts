import { assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { QuoteAllowance } from "./mod.ts";

// REQ-766 (demo-loop cycle 5v2, m17): the allowance reads the account's plan and this month's
// quotes from the stores the app writes.

const line = [{
  description: "Deep clean",
  quantity: 1,
  unit: "ea",
  price: 30_000,
}];

Deno.test("REQ-766 m17 QuoteAllowance: a Free account's sixth quote this month is refused; Monster's is not", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const plans = new PlanStore();
    const quotes = new QuoteStore();
    const allowance = new QuoteAllowance(plans, quotes);
    const now = new Date().toISOString();
    await plans.put({
      userId: "u-free",
      planId: "free",
      status: "free",
      chosenAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < 5; i++) {
      assertEquals(
        (await allowance.check("u-free")).ok,
        true,
        `quote ${i + 1} is allowed`,
      );
      await quotes.create("u-free", {
        summary: `Job ${i + 1}`,
        lineItems: line,
      });
    }
    assertEquals(await allowance.check("u-free"), {
      ok: false,
      reason: "quote_limit",
      limit: 5,
      used: 5,
    });

    await plans.put({
      userId: "u-free",
      planId: "monster",
      status: "active",
      chosenAt: now,
      updatedAt: now,
    });
    assertEquals(
      (await allowance.check("u-free")).ok,
      true,
      "Monster is unlimited",
    );
  } finally {
    await resetKv();
  }
});
