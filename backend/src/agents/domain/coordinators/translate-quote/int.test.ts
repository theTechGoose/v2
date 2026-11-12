/**
 * REQ-264 (demo M15): the server fills a quote's translations — the
 * job-details description AND every line item — for English and Spanish, so
 * the customer's document reads in whichever language they open it in
 * (/q?lang=en on a Spanish quote used to stay Spanish).
 */
import { assert, assertEquals } from "#std/assert";
import { TranslateQuote } from "./mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/** A fake translator: EN maps Spanish to English; ES returns lines as-is. */
const EN: Record<string, string> = {
  "Pintar el baño": "Paint the bathroom",
  "Limpieza y retiro de desechos": "Cleanup and debris removal",
  "Preparar paredes": "Prepare walls",
};

function scriptedLlm() {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  llm.setHandler((req) => {
    calls.push(req);
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /English/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) => toEn ? (EN[t] ?? t) : t),
      }),
    };
  });
  return { llm, calls };
}

async function setup() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const { llm, calls } = scriptedLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm));
  return { quotes, llm, calls, flow };
}

Deno.test("REQ-264 (M15) a Spanish chat quote with no description gets its line items in English and Spanish", async () => {
  const { quotes, flow, calls } = await setup();
  const q = await quotes.create("u-1", {
    summary: "Pintar el baño",
    lineItems: [
      { description: "Pintar el baño", quantity: 1, unit: "ea", price: 40_000 },
      {
        description: "Limpieza y retiro de desechos",
        quantity: 1,
        unit: "ea",
        price: 5_000,
      },
    ],
    estimatedTotal: 45_000,
    status: "draft",
  });

  await flow.run({ userId: "u-1", quoteId: q.id });

  const after = await quotes.getOwned(q.id, "u-1");
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
    "Paint the bathroom",
    "Cleanup and debris removal",
  ]);
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
    "Pintar el baño",
    "Limpieza y retiro de desechos",
  ]);
  // Base text, prices, quantities untouched.
  assertEquals(after.lineItems[0].description, "Pintar el baño");
  assertEquals(after.lineItems[0].price, 40_000);
  // One call per language, each in JSON mode (no chat tools attached).
  assertEquals(calls.length, 2);
  assert(calls.every((c) => c.responseFormat === "json"));
  await resetKv();
});

Deno.test("REQ-264 (M15) the description and the line items translate together; filled languages are left alone", async () => {
  const { quotes, flow, calls } = await setup();
  const q = await quotes.create("u-1", {
    summary: "Baño",
    description: "Preparar paredes\nPintar el baño",
    // The contractor's preview already cached the Spanish text (M15 pair 9).
    descriptionByLang: { es: "Preparar paredes\nPintar el baño" },
    lineItems: [{
      description: "Limpieza y retiro de desechos",
      descriptionByLang: { es: "Limpieza y retiro de desechos" },
      quantity: 1,
      unit: "ea",
      price: 5_000,
    }],
    status: "draft",
  });

  await flow.run({ userId: "u-1", quoteId: q.id });

  const after = await quotes.getOwned(q.id, "u-1");
  assertEquals(after.descriptionByLang, {
    es: "Preparar paredes\nPintar el baño",
    en: "Prepare walls\nPaint the bathroom",
  });
  assertEquals(
    after.lineItems[0].descriptionByLang?.en,
    "Cleanup and debris removal",
  );
  assertEquals(calls.length, 1, "Spanish was cached — only English is asked");

  // Idempotent: a second run has nothing left to do.
  await flow.run({ userId: "u-1", quoteId: q.id });
  assertEquals(calls.length, 1);
  await resetKv();
});

Deno.test("REQ-264 (M15) a failed translation persists nothing, so the next run retries", async () => {
  const { quotes, flow, llm } = await setup();
  llm.setHandler(() => {
    throw new Error("provider down");
  });
  const q = await quotes.create("u-1", {
    summary: "Baño",
    lineItems: [{
      description: "Pintar el baño",
      quantity: 1,
      unit: "ea",
      price: 40_000,
    }],
    status: "draft",
  });

  const res = await flow.run({ userId: "u-1", quoteId: q.id });

  const after = await quotes.getOwned(q.id, "u-1");
  assertEquals(after.lineItems[0].descriptionByLang, undefined);
  assertEquals(res.lineItems[0].descriptionByLang, undefined);
  await resetKv();
});

Deno.test("REQ-264 (M15) only the owner's quote is translated", async () => {
  const { quotes, flow, calls } = await setup();
  const q = await quotes.create("u-1", {
    summary: "Baño",
    lineItems: [{
      description: "Pintar el baño",
      quantity: 1,
      unit: "ea",
      price: 40_000,
    }],
    status: "draft",
  });
  let threw = false;
  try {
    await flow.run({ userId: "u-2", quoteId: q.id });
  } catch {
    threw = true;
  }
  assert(threw, "another user's quote must be refused");
  assertEquals(calls.length, 0);
  await resetKv();
});
