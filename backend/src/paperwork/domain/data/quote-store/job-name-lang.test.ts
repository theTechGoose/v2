/**
 * REQ-579 (demo-loop cycle 4, M14 + m7): the server names a quote's job in
 * the language the job was TYPED in, not the owner's app language. Pair 7
 * wrote Spanish with the app in English and the derived name came out
 * "Baño Principal De" — the English branch keeps Spanish stopwords.
 */
import { assertEquals } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function store() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new QuoteStore();
}

const line = (description: string) => [{
  description,
  quantity: 1,
  unit: "ea",
  price: 1_800_000,
}];

Deno.test("REQ-579 M14 a Spanish summary in an English account is named the Spanish way", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Baño principal de la señora Tran en Round",
    lineItems: line("Baño principal"),
    status: "draft",
  }, { jobNameLang: "en" });
  assertEquals(q.jobName, "Baño principal");
});

Deno.test("REQ-579 M14 an English summary in a Spanish account is named the English way", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Interior paint for the bedrooms and the hallway",
    lineItems: line("Interior paint"),
    status: "draft",
  }, { jobNameLang: "es" });
  assertEquals(q.jobName, "Interior Paint");
});

Deno.test("REQ-579 M14 too short to tell → the account language decides (UX-29 unchanged)", async () => {
  const s = await store();
  const q = await s.create("u-1", {
    summary: "Patio pavers",
    lineItems: line("Patio pavers"),
    status: "draft",
  }, { jobNameLang: "es" });
  assertEquals(q.jobName, "Patio pavers");
});
