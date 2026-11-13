/**
 * REQ-710 (demo-loop cycle 5, M4): a quote's base language is stamped when
 * it is created, from the text that was TYPED — never the app language.
 * Pair 6's app was in English and they typed the quote in Spanish; nothing
 * recorded that, so every later reader took English as the base and the
 * English document kept the Spanish title, lines and e-mail subject.
 */
import { assertEquals } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function store() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new QuoteStore();
}

const line = (description: string) => ({
  description,
  quantity: 1,
  unit: "ea",
  price: 17_500,
});

Deno.test("REQ-710 (cycle 5, M4) a quote typed in Spanish in an English account is stored with Spanish as its base language", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary:
      "Reparación de puerta de cocina y cambio de llave del fregadero — Carmen Núñez",
    jobName: "Reparación de puerta",
    lineItems: [
      line("Reparación de puerta de cocina"),
      line("Cambio de llave del fregadero"),
    ],
    estimatedTotal: 35_000,
    status: "draft",
  }, { jobNameLang: "en" });
  assertEquals(q.lang, "es");
  assertEquals((await s.getOwned(q.id, "u-1")).lang, "es");
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) an English quote typed in a Spanish account is stored as English", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Paint the bedrooms and the hallway",
    lineItems: [line("Paint the walls and the trim")],
    status: "draft",
  }, { jobNameLang: "es" });
  assertEquals(q.lang, "en");
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) the typed text wins over a base language the caller sent", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    lang: "en",
    summary: "Reparación de puerta de baño",
    lineItems: [line("Reparación de puerta de baño")],
    status: "draft",
  });
  assertEquals(q.lang, "es");
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) text too short to tell stamps nothing — the translator falls back to the account language", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Patio pavers",
    lineItems: [line("Patio pavers")],
    status: "draft",
  }, { jobNameLang: "es" });
  assertEquals(q.lang, undefined);
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) an English quote for José de la Cruz is never stamped Spanish — a surname's 'de la' is part of the name", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Deck repair — José de la Cruz",
    lineItems: [line("Replace deck boards"), line("Stain deck")],
    status: "draft",
  }, { jobNameLang: "en" });
  assertEquals(q.lang, undefined);
  await resetKv();
});
