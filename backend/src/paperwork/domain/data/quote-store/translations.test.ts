/**
 * REQ-264 (demo M15): a cached translation describes the text it was made
 * from. When a quote's line item (or its job-details description) is edited,
 * the old translation must not keep rendering on the other-language
 * document — the store drops it so the next send re-translates.
 */
import { assertEquals } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function seed() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await store.create("u-1", {
    summary: "Baño",
    description: "Pintar el baño",
    descriptionByLang: { en: "Paint the bathroom", es: "Pintar el baño" },
    lineItems: [
      {
        description: "Pintar el baño",
        descriptionByLang: { en: "Paint the bathroom", es: "Pintar el baño" },
        quantity: 1,
        unit: "ea",
        price: 40_000,
      },
      {
        description: "Limpieza",
        descriptionByLang: { en: "Cleanup", es: "Limpieza" },
        quantity: 1,
        unit: "ea",
        price: 5_000,
      },
    ],
    status: "draft",
  });
  return { store, q };
}

Deno.test("REQ-264 (M15) editing a line item's text drops its stale translations; untouched lines keep theirs", async () => {
  const { store, q } = await seed();
  // The editor round-trips the whole item, old translation map included.
  const edited = q.lineItems.map((li, i) =>
    i === 1 ? { ...li, description: "Limpieza y retiro de desechos" } : li
  );
  const after = await store.update(q.id, "u-1", { lineItems: edited });
  assertEquals(after.lineItems[1].descriptionByLang, undefined);
  assertEquals(after.lineItems[0].descriptionByLang, {
    en: "Paint the bathroom",
    es: "Pintar el baño",
  });
  await resetKv();
});

Deno.test("REQ-264 (M15) an edit that omits translations keeps them for unchanged lines", async () => {
  const { store, q } = await seed();
  const after = await store.update(q.id, "u-1", {
    lineItems: q.lineItems.map(({ descriptionByLang: _d, ...li }) => li),
  });
  assertEquals(after.lineItems[1].descriptionByLang?.en, "Cleanup");
  await resetKv();
});

Deno.test("REQ-264 (M15) a translation written with its line item is kept", async () => {
  const { store, q } = await seed();
  const after = await store.update(q.id, "u-1", {
    lineItems: [{
      description: "Pintar",
      descriptionByLang: { en: "Paint" },
      quantity: 1,
      unit: "ea",
      price: 1,
    }],
  });
  assertEquals(after.lineItems[0].descriptionByLang, { en: "Paint" });
  await resetKv();
});

Deno.test("REQ-264 (M15) editing the job-details description drops its stale translations", async () => {
  const { store, q } = await seed();
  const after = await store.update(q.id, "u-1", {
    description: "Pintar el baño y el pasillo",
  });
  assertEquals(after.descriptionByLang, undefined);
  // ...but a translation cache write on its own (the preview) is kept.
  const cached = await store.update(q.id, "u-1", {
    descriptionByLang: { es: "Pintar el baño y el pasillo" },
  });
  assertEquals(cached.descriptionByLang, {
    es: "Pintar el baño y el pasillo",
  });
  await resetKv();
});
