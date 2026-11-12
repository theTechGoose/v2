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
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";

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
  // REQ-333: the quotes below are typed in Spanish by a Spanish contractor —
  // the base language comes from the contractor's app language.
  const users = new UserStore();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15550000264",
    language: "es",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
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
  // REQ-333: one model call — for English; Spanish is the typed text.
  assertEquals(calls.length, 1);
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
  assertEquals(calls.length, 1, "Spanish is the base — only English is asked");

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

  // REQ-333: the Spanish base is the typed text (no model involved) — only
  // the English translation is left unfilled, so the next run retries it.
  const after = await quotes.getOwned(q.id, "u-1");
  assertEquals(after.lineItems[0].descriptionByLang?.en, undefined);
  assertEquals(res.lineItems[0].descriptionByLang?.en, undefined);
  assertEquals(after.lineItems[0].descriptionByLang?.es, "Pintar el baño");
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

/**
 * REQ-333 (demo-loop cycle 1, M24): "AI silently rewords line items". The
 * quote's own language is never sent to the model: its cache is the typed
 * text verbatim (so the review card and the sent document match the locked
 * card), only the OTHER language is translated, and the base language is
 * stored on the quote for the readers.
 */
function paraphrasingLlm() {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  const PARA: Record<string, string> = {
    "Demo and haul-off": "Demolition and removal",
    "Plumbing fixtures": "Plumbing fixtures installation",
  };
  const ES: Record<string, string> = {
    "Demo and haul-off": "Demolición y retiro",
    "Plumbing fixtures": "Accesorios de plomería",
  };
  llm.setHandler((req) => {
    calls.push(req);
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /English/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) => toEn ? (PARA[t] ?? t) : (ES[t] ?? t)),
      }),
    };
  });
  return { llm, calls };
}

Deno.test("REQ-333 (M24) an English contractor's typed lines are cached verbatim in English; only Spanish is asked", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const me = await users.create({
    phoneNumber: "+15550000333",
    language: "en",
  });
  const { llm, calls } = paraphrasingLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  const q = await quotes.create(me.id, {
    summary: "Bathroom remodel",
    description: "Demo and haul-off\nPlumbing fixtures",
    lineItems: [
      {
        description: "Demo and haul-off",
        quantity: 1,
        unit: "ea",
        price: 90_000,
      },
      {
        description: "Plumbing fixtures",
        quantity: 1,
        unit: "ea",
        price: 60_000,
      },
    ],
    status: "draft",
  });

  await flow.run({ userId: me.id, quoteId: q.id });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
    "Demo and haul-off",
    "Plumbing fixtures",
  ]);
  assertEquals(
    after.descriptionByLang?.en,
    "Demo and haul-off\nPlumbing fixtures",
  );
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
    "Demolición y retiro",
    "Accesorios de plomería",
  ]);
  assertEquals(after.lang, "en", "the base language is stored on the quote");
  assertEquals(calls.length, 1, "one model call — Spanish only");
  assert(/Spanish/.test(calls[0].systemPrompt ?? ""));
  await resetKv();
});

Deno.test("REQ-333 (M24) the caller's baseLang wins over the contractor's app language", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const me = await users.create({
    phoneNumber: "+15550000334",
    language: "es",
  });
  const { llm, calls } = paraphrasingLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  const q = await quotes.create(me.id, {
    summary: "Bathroom remodel",
    lineItems: [
      {
        description: "Demo and haul-off",
        quantity: 1,
        unit: "ea",
        price: 90_000,
      },
    ],
    status: "draft",
  });

  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "en" });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lineItems[0].descriptionByLang?.en, "Demo and haul-off");
  assertEquals(after.lineItems[0].descriptionByLang?.es, "Demolición y retiro");
  assertEquals(after.lang, "en");
  assertEquals(calls.length, 1);
  await resetKv();
});
