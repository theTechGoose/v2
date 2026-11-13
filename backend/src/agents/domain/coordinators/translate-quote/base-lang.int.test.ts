/**
 * REQ-710 (demo-loop cycle 5, M4): "the English version of a quote typed in
 * Spanish keeps the Spanish title, lines and subject". Pair 6's app was in
 * English; they typed the quote in Spanish. Lock passed the APP language as
 * the base (REQ-333's "the contractor typed in their app language"), so
 * TranslateQuote copied the typed Spanish into every English slot with no
 * model call and asked the model for Spanish instead. The base language is
 * now the language the text reads in; a quote stored with the wrong base is
 * re-based and its caches rebuilt.
 */
import { assert, assertEquals } from "#std/assert";
import { TranslateQuote } from "./mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";

const SUMMARY =
  "Reparación de puerta de cocina y cambio de llave del fregadero — Carmen Núñez";
const LINES = [
  "Reparación de puerta de cocina",
  "Cambio de llave del fregadero",
];

/** What the model returns into English; into Spanish it marks the line, so a
 *  call in the wrong direction shows up in the stored text. */
const EN_OF: Record<string, string> = {
  "Reparación de puerta": "door repair",
  [SUMMARY]: "Kitchen door repair and sink faucet replacement — Carmen Núñez",
  [LINES[0]]: "Kitchen door repair",
  [LINES[1]]: "Kitchen sink faucet replacement",
};

function scriptedLlm(fail = false) {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  llm.setHandler((req) => {
    calls.push(req);
    if (fail) throw new Error("provider down");
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    const toEn = /bullet lines into English/.test(req.systemPrompt ?? "");
    return {
      text: JSON.stringify({
        texts: texts.map((t) => toEn ? (EN_OF[t] ?? t) : `${t} (es)`),
      }),
    };
  });
  return { llm, calls };
}

async function setup(fail = false) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const users = new UserStore();
  // Pair 6: the app is in ENGLISH.
  const me = await users.create({
    phoneNumber: "+15550000710",
    language: "en",
  });
  const { llm, calls } = scriptedLlm(fail);
  const flow = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  return { quotes, users, me, llm, calls, flow };
}

async function pair6Quote(quotes: QuoteStore, userId: string) {
  return await quotes.create(userId, {
    summary: SUMMARY,
    jobName: "Reparación de puerta",
    lineItems: LINES.map((description) => ({
      description,
      quantity: 1,
      unit: "ea",
      price: 17_500,
    })),
    estimatedTotal: 35_000,
    status: "draft",
  }, { jobNameLang: "en" });
}

const intoEnglish = (c: LLMRequest) =>
  /bullet lines into English/.test(c.systemPrompt ?? "");

Deno.test("REQ-710 (cycle 5, M4) an English-app contractor's Spanish quote: Spanish is the base and the English copy is translated (pair 6)", async () => {
  const { quotes, me, calls, flow } = await setup();
  const q = await pair6Quote(quotes, me.id);

  await flow.run({ userId: me.id, quoteId: q.id });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "es");
  assertEquals(after.jobNameByLang, {
    es: "Reparación de puerta",
    en: "Door Repair",
  });
  assertEquals(after.summaryByLang?.en, EN_OF[SUMMARY]);
  assertEquals(after.summaryByLang?.es, SUMMARY);
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
    "Kitchen door repair",
    "Kitchen sink faucet replacement",
  ]);
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), LINES);
  assertEquals(calls.length, 1, "one model call");
  assert(intoEnglish(calls[0]), "the model is asked for English, not Spanish");
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) the app-language hint the old lock passed never beats the typed text", async () => {
  const { quotes, me, calls, flow } = await setup();
  const q = await pair6Quote(quotes, me.id);

  await flow.run({ userId: me.id, quoteId: q.id, baseLang: "en" });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "es");
  assertEquals(after.jobNameByLang?.en, "Door Repair");
  assertEquals(
    after.lineItems[0].descriptionByLang?.en,
    "Kitchen door repair",
  );
  assert(calls.every(intoEnglish), "never asked to translate into Spanish");
  await resetKv();
});

/** Pair 6's quote as the old lock left it: English stamped as its base and
 *  the typed Spanish copied into every English slot; the "Spanish" slots
 *  hold what the model made of Spanish "translated" from English. */
async function lockedBeforeTheFix(quotes: QuoteStore, userId: string) {
  const q = await pair6Quote(quotes, userId);
  return await quotes.update(q.id, userId, {
    lang: "en",
    jobNameByLang: { en: "Reparación de puerta", es: "Reparación De Puerta" },
    summaryByLang: { en: SUMMARY, es: `${SUMMARY} (es)` },
    lineItems: LINES.map((description) => ({
      description,
      descriptionByLang: { en: description, es: `${description} (es)` },
      quantity: 1,
      unit: "ea",
      price: 17_500,
    })),
  });
}

Deno.test("REQ-710 (cycle 5, M4) repair: a quote stored with English as the base of Spanish text is re-based on Spanish and its English copy translated", async () => {
  const { quotes, me, calls, flow } = await setup();
  const q = await lockedBeforeTheFix(quotes, me.id);
  assertEquals(q.lang, "en");

  await flow.run({ userId: me.id, quoteId: q.id });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "es");
  assertEquals(after.jobNameByLang, {
    es: "Reparación de puerta",
    en: "Door Repair",
  });
  assertEquals(after.summaryByLang, { es: SUMMARY, en: EN_OF[SUMMARY] });
  assertEquals(after.lineItems.map((li) => li.descriptionByLang), [
    { es: LINES[0], en: "Kitchen door repair" },
    { es: LINES[1], en: "Kitchen sink faucet replacement" },
  ]);
  // prices and the typed text are untouched
  assertEquals(after.lineItems.map((li) => li.description), LINES);
  assertEquals(after.estimatedTotal, 35_000);
  assertEquals(calls.length, 1);
  assert(intoEnglish(calls[0]));

  // Repaired: nothing is left to do.
  await flow.run({ userId: me.id, quoteId: q.id });
  assertEquals(calls.length, 1);
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) repair from the preview's English-only run leaves no Spanish in an English slot", async () => {
  const { quotes, me, flow } = await setup();
  const q = await lockedBeforeTheFix(quotes, me.id);

  await flow.run({ userId: me.id, quoteId: q.id, langs: ["en"] });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "es");
  assertEquals(after.jobNameByLang?.en, "Door Repair");
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), [
    "Kitchen door repair",
    "Kitchen sink faucet replacement",
  ]);
  // the Spanish slots are the typed text again, never the "(es)" paraphrase
  assertEquals(after.jobNameByLang?.es, "Reparación de puerta");
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), LINES);
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) a repair the model fails still clears the Spanish out of the English slots; the next run fills them", async () => {
  const { quotes, users, me } = await setup(true);
  const q = await lockedBeforeTheFix(quotes, me.id);
  const down = new TranslateQuote(
    quotes,
    new TranslateBullets(scriptedLlm(true).llm),
    users,
  );

  await down.run({ userId: me.id, quoteId: q.id });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "es");
  assertEquals(after.jobNameByLang?.en, undefined);
  assertEquals(after.summaryByLang?.en, undefined);
  assertEquals(
    after.lineItems.map((li) => li.descriptionByLang?.en),
    [undefined, undefined],
  );
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), LINES);

  // The provider is back: the English copy is filled.
  const { llm } = scriptedLlm();
  const up = new TranslateQuote(quotes, new TranslateBullets(llm), users);
  await up.run({ userId: me.id, quoteId: q.id });
  const fixed = await quotes.getOwned(q.id, me.id);
  assertEquals(fixed.jobNameByLang?.en, "Door Repair");
  assertEquals(
    fixed.lineItems[1].descriptionByLang?.en,
    "Kitchen sink faucet replacement",
  );
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) an English-app contractor's ENGLISH quote for José de la Cruz keeps English as its base — the surname is not Spanish text", async () => {
  const { quotes, me, calls, flow } = await setup();
  const lines = ["Replace deck boards", "Stain deck"];
  const q = await quotes.create(me.id, {
    summary: "Deck repair — José de la Cruz",
    jobName: "Deck Repair",
    lineItems: lines.map((description) => ({
      description,
      quantity: 1,
      unit: "ea",
      price: 40_000,
    })),
    estimatedTotal: 80_000,
    status: "draft",
  }, { jobNameLang: "en" });

  await flow.run({ userId: me.id, quoteId: q.id });

  const after = await quotes.getOwned(q.id, me.id);
  assertEquals(after.lang, "en");
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.en), lines);
  assertEquals(after.lineItems.map((li) => li.descriptionByLang?.es), [
    "Replace deck boards (es)",
    "Stain deck (es)",
  ]);
  assert(calls.length >= 1);
  assert(
    calls.every((c) => !intoEnglish(c)),
    "the typed English was sent to the model to be made English",
  );
  await resetKv();
});
