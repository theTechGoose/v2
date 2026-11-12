/**
 * REQ-460 (demo-loop cycle 3, B1) — the store is the last gate on the quote
 * write path: a SIGNED quote is the agreement, and nothing changes its terms,
 * its lines or its total any more (REQ-202), whoever the caller is. In the
 * demo the terms wizard wrote "Deposit + balance" onto a quote the customer
 * had already signed, because `QuoteStore.update` stored any patch. The
 * bookkeeping a signed quote still gets (notification stamps, delivery,
 * cached translations, an identical rewrite) keeps landing.
 */
import { assertEquals, assertRejects } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const LINES = [
  { description: "Roof tear-off", quantity: 1, unit: "job", price: 900_000 },
  { description: "Shingles", quantity: 1, unit: "job", price: 550_000 },
];
const FIFTY_FIFTY = [
  { stepId: "start_date", label: "Start date", value: "Next week" },
  { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
];

async function signedQuote(store: QuoteStore) {
  const q = await store.create("u-1", {
    summary: "Roof replacement",
    lineItems: LINES,
    estimatedTotal: 1_450_000,
    terms: FIFTY_FIFTY,
  });
  await store.update(q.id, "u-1", { status: "sent", sentAt: "2026-11-12" });
  return await store.update(q.id, "u-1", {
    status: "accepted",
    acceptedAt: "2026-11-12T12:13:41.000Z",
    acceptedName: "Linda Ortiz",
  });
}

async function refused(run: () => Promise<unknown>, field: string) {
  const err = await assertRejects(run, Error);
  assertEquals(
    (err as { name?: string }).name,
    "QuoteSignedError",
    `a signed quote's ${field} is refused with QuoteSignedError`,
  );
  assertEquals((err as { fields?: string[] }).fields, [field]);
}

Deno.test("REQ-460 (demo-loop cycle 3, B1) quote-store: a signed quote's terms, lines and total are refused — the row stays as it was signed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await signedQuote(store);

  // the demo: "Deposit + balance" picked AFTER Linda signed
  await refused(
    () =>
      store.update(q.id, "u-1", {
        terms: [
          FIFTY_FIFTY[0],
          {
            stepId: "payment_terms",
            label: "Payment terms",
            value: "Deposit + balance",
          },
        ],
      }),
    "terms",
  );
  await refused(
    () =>
      store.update(q.id, "u-1", {
        lineItems: [{ ...LINES[0], price: 950_000 }, LINES[1]],
      }),
    "lineItems",
  );
  await refused(
    () => store.update(q.id, "u-1", { estimatedTotal: 1_500_000 }),
    "estimatedTotal",
  );

  const after = await store.get(q.id);
  assertEquals(after.terms, FIFTY_FIFTY, "the signed terms stand");
  assertEquals(
    after.lineItems.map((l) => l.price),
    [900_000, 550_000],
    "the signed lines stand",
  );
  assertEquals(after.estimatedTotal, 1_450_000, "the signed total stands");
  await resetKv();
});

Deno.test("REQ-460 (demo-loop cycle 3, B1) quote-store: bookkeeping on a signed quote still lands — a stamp, a cached translation, an identical rewrite", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await signedQuote(store);

  await store.update(q.id, "u-1", {
    acceptedNotifiedAt: "2026-11-12T12:13:42.000Z",
  });
  // TranslateQuote writes the lines back with their per-language text
  await store.update(q.id, "u-1", {
    lineItems: LINES.map((l) => ({
      ...l,
      descriptionByLang: { en: l.description, es: `${l.description} (es)` },
    })),
  });
  // a writer that re-sends what is already there changes nothing
  await store.update(q.id, "u-1", {
    terms: FIFTY_FIFTY.map((t) => ({ ...t })),
    estimatedTotal: 1_450_000,
  });

  const after = await store.get(q.id);
  assertEquals(after.acceptedNotifiedAt, "2026-11-12T12:13:42.000Z");
  assertEquals(
    after.lineItems[0].descriptionByLang?.es,
    "Roof tear-off (es)",
    "the translation cache is not the agreement's content",
  );
  assertEquals(after.terms, FIFTY_FIFTY);
  assertEquals(after.status, "accepted");
  await resetKv();
});

Deno.test("REQ-460 (demo-loop cycle 3, B1) quote-store: an unsigned quote's terms still change as each wizard answer lands (REQ-240)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await store.create("u-1", {
    summary: "Roof replacement",
    lineItems: LINES,
    estimatedTotal: 1_450_000,
  });
  await store.update(q.id, "u-1", { status: "sent", sentAt: "2026-11-12" });
  const next = await store.update(q.id, "u-1", { terms: FIFTY_FIFTY });
  assertEquals(next.terms, FIFTY_FIFTY);
  await resetKv();
});
