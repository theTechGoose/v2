/**
 * REQ-241 (demo issue quote-invoice-money-m1) — the onboarding sample quote
 * stays out of the owner's Q- sequence: the first real quote after
 * onboarding is Q-001, the sample carries its own "SAMPLE" mark, and the
 * sample does not lock the quote starting number (REQ-199).
 */
import { assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { EnsureSampleQuote } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const numbering = new DocNumbering();
  const quotes = new QuoteStore(numbering);
  return { numbering, quotes, sample: new EnsureSampleQuote(quotes) };
}

Deno.test("REQ-241: the first real quote after the onboarding sample is Q-001", async () => {
  const { quotes, sample } = await fresh();
  try {
    const s = await sample.run({ userId: "u-1" });
    assertEquals(s.created, true);
    const real = await quotes.create("u-1", { summary: "Deck", lineItems: [] });
    assertEquals(real.number, "Q-001");
    const second = await quotes.create("u-1", {
      summary: "Fence",
      lineItems: [],
    });
    assertEquals(second.number, "Q-002");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-241: the sample carries its own mark, not a Q- number, in the owner's language", async () => {
  const { quotes, sample } = await fresh();
  try {
    const en = await sample.run({ userId: "u-en" });
    const es = await sample.run({ userId: "u-es", language: "es" });
    const enRow = await quotes.getOwned(en.quoteId, "u-en");
    const esRow = await quotes.getOwned(es.quoteId, "u-es");
    assertEquals(enRow.number, "SAMPLE");
    assertEquals(esRow.number, "MUESTRA");
    assertEquals(enRow.seq, undefined);
    // still listed for its owner (the card stays visible, P-15) and idempotent
    assertEquals((await quotes.listByUser("u-en")).map((q) => q.id), [
      en.quoteId,
    ]);
    assertEquals((await sample.run({ userId: "u-en" })).quoteId, en.quoteId);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-241: the sample does not count as an issued quote (the starting number stays settable)", async () => {
  const { numbering, sample } = await fresh();
  try {
    await sample.run({ userId: "u-1" });
    assertEquals(await numbering.hasIssued("u-1", "quote"), false);
    assertEquals((await numbering.peek("u-1", "quote")).number, "Q-001");
  } finally {
    await resetKv();
  }
});
