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

/**
 * REQ-400 (demo-loop cycle 2, M5): "Quote/agreement documents mix languages —
 * job name untranslated". The English agreement read "Maria Lopez's
 * Reparación de puerta Agreement" while its line read "Repair of bathroom
 * door" (pair 6); the Spanish one read "Acuerdo de Roof Replacement de Dave
 * Roof" (pair 4). TranslateQuote filled the description and the lines, never
 * `jobNameByLang` / `summaryByLang`, which every reader prefers. The job name
 * and the summary now ride the same batch: the base language verbatim, the
 * other through TranslateBullets, the name cased for its language.
 */
function headingLlm() {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  const EN_OF: Record<string, string> = {
    "Reparación de puerta": "door repair",
    "Reparación de puerta de baño — Maria Lopez":
      "Bathroom door repair — Maria Lopez",
    "Reparación de puerta de baño": "Bathroom door repair",
  };
  const ES_OF: Record<string, string> = {
    "Roof Replacement": "Reemplazo De Techo",
    "Replace the roof": "Reemplazar el techo",
    "Tear off 22 squares": "Retirar 22 cuadrados de tejas",
    "Deck Repair": "Reparación De Terraza",
  };
  llm.setHandler((req) => {
    calls.push(req);
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /English/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) => toEn ? (EN_OF[t] ?? t) : (ES_OF[t] ?? t)),
      }),
    };
  });
  return { llm, calls };
}

async function headingSetup(language: "en" | "es") {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const me = await users.create({
    phoneNumber: language === "es" ? "+15550000400" : "+15550000401",
    language,
  });
  const { llm, calls } = headingLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  return { quotes, flow, calls, me };
}

Deno.test("REQ-400 (M5) a Spanish chat quote's job name and summary are translated into English and kept verbatim in Spanish", async () => {
  const { quotes, flow, calls, me } = await headingSetup("es");
  const q = await quotes.create(me.id, {
    summary: "Reparación de puerta de baño — Maria Lopez",
    jobName: "Reparación de puerta",
    lineItems: [{
      description: "Reparación de puerta de baño",
      quantity: 1,
      unit: "ea",
      price: 25_000,
    }],
    status: "draft",
  });

  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "es" });

  const after = await quotes.getOwned(q.id, me.id);
  // English Title Case for a translated name ("Door Repair", not the
  // model's "door repair"); Spanish is the typed name itself.
  assertEquals(after.jobNameByLang, {
    es: "Reparación de puerta",
    en: "Door Repair",
  });
  assertEquals(after.summaryByLang, {
    es: "Reparación de puerta de baño — Maria Lopez",
    en: "Bathroom door repair — Maria Lopez",
  });
  assertEquals(
    after.lineItems[0].descriptionByLang?.en,
    "Bathroom door repair",
  );
  // One model call — the name and the summary ride the lines' batch.
  assertEquals(calls.length, 1);
  const sent = JSON.parse(calls[0].messages[0].content as string).texts;
  assert(sent.includes("Reparación de puerta"), `the batch: ${sent}`);

  // Idempotent: nothing left to ask.
  await flow.run({ userId: me.id, quoteId: q.id });
  assertEquals(calls.length, 1);
  await resetKv();
});

Deno.test("REQ-400 (M5) an English pick with no Spanish name gets one, in Spanish sentence case (pair 4)", async () => {
  const { quotes, flow, calls, me } = await headingSetup("en");
  const q = await quotes.create(me.id, {
    summary: "Replace the roof",
    jobName: "Roof Replacement",
    // applyJobOption on an option generated in English only
    jobNameByLang: { en: "Roof Replacement" },
    description: "Tear off 22 squares",
    descriptionByLang: { en: "Tear off 22 squares" },
    lineItems: [{
      description: "Roof Replacement",
      quantity: 1,
      unit: "ea",
      price: 1_450_000,
    }],
    status: "draft",
  });

  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "en" });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.jobNameByLang, {
    en: "Roof Replacement",
    es: "Reemplazo de techo",
  });
  assertEquals(after.summaryByLang?.es, "Reemplazar el techo");
  assertEquals(after.summaryByLang?.en, "Replace the roof");
  assertEquals(after.descriptionByLang?.es, "Retirar 22 cuadrados de tejas");
  assertEquals(calls.length, 1, "one call — Spanish only");
  await resetKv();
});

Deno.test("REQ-400 (M5) a renamed job drops its stale per-language names; the next run fills the new ones", async () => {
  const { quotes, flow, calls, me } = await headingSetup("en");
  const q = await quotes.create(me.id, {
    summary: "Replace the roof",
    jobName: "Roof Replacement",
    lineItems: [{
      description: "Roof Replacement",
      quantity: 1,
      unit: "ea",
      price: 1_450_000,
    }],
    status: "draft",
  });
  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "en" });
  assertEquals(
    (await quotes.getOwned(q.id, me.id)).jobNameByLang?.es,
    "Reemplazo de techo",
  );

  // A rename that writes no per-language names (an editor that does not
  // round-trip them) must not keep rendering the old Spanish name.
  const renamed = await quotes.update(q.id, me.id, { jobName: "Deck Repair" });
  assertEquals(renamed.jobNameByLang, undefined);

  await flow.run({ userId: me.id, quoteId: q.id });
  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.jobNameByLang, {
    en: "Deck Repair",
    es: "Reparación de terraza",
  });
  assertEquals(calls.length, 2);
  await resetKv();
});

Deno.test("REQ-400 (M5) a failed translation caches no name — the base name is written, the other retries", async () => {
  const { quotes, flow, me } = await headingSetup("es");
  const llm = new StubLLMClient();
  llm.setHandler(() => {
    throw new Error("provider down");
  });
  const failing = new TranslateQuote(
    quotes,
    new TranslateBullets(llm),
    new UserStore(),
  );
  const q = await quotes.create(me.id, {
    summary: "Reparación de puerta de baño",
    jobName: "Reparación de puerta",
    lineItems: [{
      description: "Reparación de puerta de baño",
      quantity: 1,
      unit: "ea",
      price: 25_000,
    }],
    status: "draft",
  });

  await failing.run({ userId: me.id, quoteId: q.id, baseLang: "es" });
  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.jobNameByLang, { es: "Reparación de puerta" });
  assertEquals(after.summaryByLang, { es: "Reparación de puerta de baño" });

  // The provider is back: the English name is filled on the next run.
  await flow.run({ userId: me.id, quoteId: q.id });
  assertEquals(
    (await quotes.getOwned(q.id, me.id)).jobNameByLang?.en,
    "Door Repair",
  );
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-447 (demo-loop cycle 3, m14): the translated job name is a TITLE, not a
// literal translation. "Cambio de llave de fregadero" came back "Replacement
// of Faucet" and the English agreement read "María José Peña's Replacement of
// Faucet Agreement" (fleet-5 l.93). The model is told which line is the job's
// title and asked for the short noun phrase a contractor would use.
// ---------------------------------------------------------------------------

/** A model that answers a title line with a noun phrase only when the prompt
 *  marks that line as the job's title; otherwise it translates literally. */
function titleAwareLlm() {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  const LITERAL: Record<string, string> = {
    "Cambio de llave de fregadero": "replacement of sink faucet",
    "Cambio de llave de fregadero de cocina — María José Peña":
      "Replacement of kitchen sink faucet — María José Peña",
    "Cambio de llave del fregadero de la cocina":
      "Replacement of kitchen sink faucet",
  };
  const TITLE: Record<string, string> = {
    "Cambio de llave de fregadero": "faucet replacement",
  };
  llm.setHandler((req) => {
    calls.push(req);
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const marked = new Set(
      [...(req.systemPrompt ?? "").matchAll(/Line (\d+) is the job's TITLE/g)]
        .map((m) => Number(m[1]) - 1),
    );
    return {
      text: JSON.stringify({
        texts: texts.map((t, i) =>
          marked.has(i) ? (TITLE[t] ?? t) : (LITERAL[t] ?? t)
        ),
      }),
    };
  });
  return { llm, calls };
}

Deno.test("REQ-447 (m14) a Spanish job name is translated as a short title ('Faucet Replacement'), not word for word ('Replacement of Sink Faucet')", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const me = await users.create({ phoneNumber: "+15550000447", language: "es" });
  const { llm, calls } = titleAwareLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  const q = await quotes.create(me.id, {
    summary: "Cambio de llave de fregadero de cocina — María José Peña",
    jobName: "Cambio de llave de fregadero",
    lineItems: [{
      description: "Cambio de llave del fregadero de la cocina",
      quantity: 1,
      unit: "ea",
      price: 18_000,
    }],
    status: "draft",
  });

  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "es" });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.jobNameByLang?.en, "Faucet Replacement");
  assertEquals(after.jobNameByLang?.es, "Cambio de llave de fregadero");
  // the scope lines are still translated in full, clause by clause
  assertEquals(
    after.lineItems[0].descriptionByLang?.en,
    "Replacement of kitchen sink faucet",
  );
  assertEquals(calls.length, 1, "the title rides the lines' one call");
  await resetKv();
});

Deno.test("REQ-447 (m14) a batch with no job name marks no title line", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  const me = await users.create({ phoneNumber: "+15550000448", language: "es" });
  const { llm, calls } = titleAwareLlm();
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  const q = await quotes.create(me.id, {
    summary: "Cambio de llave del fregadero de la cocina",
    jobName: "Cambio de llave de fregadero",
    jobNameByLang: {
      es: "Cambio de llave de fregadero",
      en: "Faucet Replacement",
    },
    summaryByLang: {
      es: "Cambio de llave del fregadero de la cocina",
      en: "Replacement of kitchen sink faucet",
    },
    lineItems: [{
      description: "Cambio de llave del fregadero de la cocina",
      quantity: 1,
      unit: "ea",
      price: 18_000,
    }],
    status: "draft",
  });
  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "es" });
  assertEquals(calls.length, 1);
  assert(!/TITLE/.test(calls[0].systemPrompt ?? ""), calls[0].systemPrompt);
  await resetKv();
});

Deno.test("REQ-441 (M23, cycle 3) a cached copy missing the contractor's added line is stale — re-translated with every line", async () => {
  const { quotes, flow, calls } = await setup();
  // The help-me-price confirm flow: the contractor added "Limpieza y retiro
  // de desechos" with "Add your own…", but the other language was written
  // from the ORIGINAL pre-generated option — one line short.
  const q = await quotes.create("u-1", {
    summary: "Baño",
    description:
      "Preparar paredes\nPintar el baño\nLimpieza y retiro de desechos",
    descriptionByLang: {
      es: "Preparar paredes\nPintar el baño\nLimpieza y retiro de desechos",
      en: "Prepare walls\nPaint the bathroom",
    },
    lineItems: [],
    status: "draft",
  });

  await flow.run({ userId: "u-1", quoteId: q.id });

  const after = await quotes.getOwned(q.id, "u-1");
  assertEquals(
    after.descriptionByLang?.en,
    "Prepare walls\nPaint the bathroom\nCleanup and debris removal",
  );
  assertEquals(calls.length, 1, "only the stale English copy is asked");

  // Now in step: a second run has nothing left to do.
  await flow.run({ userId: "u-1", quoteId: q.id });
  assertEquals(calls.length, 1);
  await resetKv();
});
