/**
 * REQ-701 (demo-loop cycle 5, issue M21) — a client's question is KEPT.
 *
 * "Linda's question text is NOWHERE on that panel, no reply box. How do I
 * answer her?" — POST /quotes/:id/inquiry only raised a notification and an
 * alert; nothing stored the question, so the quote panel the notice opened
 * had nothing to show. QuoteInquiryStore keeps every question per quote,
 * owned by the contractor (userId on the record and in its index key, so the
 * account wipe takes it), newest first, with what the contractor answered.
 */
import { assert, assertEquals } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { QuoteInquiryStore } from "./mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new QuoteInquiryStore();
}

const LINDA = {
  quoteId: "q-linda",
  userId: "u-rosa",
  customerId: "c-linda",
  question:
    "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?",
  contactBack: "linda.morales@example.com",
  name: "Linda Morales",
  lang: "es" as const,
};

Deno.test("REQ-701 M21 a question is stored with who asked, how to reach them, the page language and when — owned by the contractor", async () => {
  const store = await fresh();
  const saved = await store.create(LINDA);
  assert(saved, "the question was stored");
  assertEquals(saved.quoteId, "q-linda");
  assertEquals(saved.userId, "u-rosa");
  assertEquals(saved.customerId, "c-linda");
  assertEquals(saved.question, LINDA.question);
  assertEquals(saved.contactBack, "linda.morales@example.com");
  assertEquals(saved.name, "Linda Morales");
  assertEquals(saved.lang, "es");
  assertEquals(typeof saved.createdAt, "string");
  assertEquals(saved.answeredAt, undefined);

  const listed = await store.listByQuote("q-linda");
  assertEquals(listed.map((i) => i.id), [saved.id]);
  assertEquals(await store.get("q-linda", saved.id), saved);

  // The account wipe sweeps by userId — on the value and in the index key.
  const kv = await getKv();
  const keys: Deno.KvKey[] = [];
  for await (const e of kv.list({ prefix: [] })) {
    keys.push(e.key);
    const v = e.value as { userId?: string } | string;
    assert(
      e.key.includes("u-rosa") ||
        (typeof v === "object" && v?.userId === "u-rosa"),
      `an inquiry entry the wipe would miss: ${JSON.stringify(e.key)}`,
    );
  }
  assert(keys.length >= 2, "record + owner index");
  await resetKv();
});

Deno.test("REQ-701 M21 newest first; blanks are not stored; text is trimmed and capped; a language other than en/es is dropped", async () => {
  const store = await fresh();
  const first = await store.create({ ...LINDA, question: "first?" });
  await new Promise((r) => setTimeout(r, 3));
  const second = await store.create({
    ...LINDA,
    question: `  ${"x".repeat(5000)}  `,
    contactBack: "   ",
    name: ` ${"n".repeat(400)} `,
    lang: "fr" as unknown as "es",
  });
  assert(first && second);
  assertEquals(await store.create({ ...LINDA, question: "   " }), null);
  const listed = await store.listByQuote("q-linda");
  assertEquals(listed.map((i) => i.id), [second.id, first.id]);
  assertEquals(second.question.length, 2000);
  assertEquals(second.contactBack, undefined);
  assertEquals(second.name!.length, 120);
  assertEquals(second.lang, undefined);
  await resetKv();
});

Deno.test("REQ-701 M21 a quote keeps at most 50 questions — the 51st is refused, the others stay", async () => {
  const store = await fresh();
  for (let i = 0; i < QuoteInquiryStore.MAX_PER_QUOTE; i++) {
    assert(await store.create({ ...LINDA, question: `q${i}?` }));
  }
  assertEquals(await store.create({ ...LINDA, question: "one more?" }), null);
  assertEquals(
    (await store.listByQuote("q-linda")).length,
    QuoteInquiryStore.MAX_PER_QUOTE,
  );
  // Another quote is not affected.
  assert(await store.create({ ...LINDA, quoteId: "q-other" }));
  await resetKv();
});

Deno.test("REQ-701 M21 markAnswered records how, to whom and what — and the question leaves the owner's open list", async () => {
  const store = await fresh();
  const a = await store.create(LINDA);
  const b = await store.create({
    ...LINDA,
    quoteId: "q-two",
    question: "Do you haul the old fence?",
    lang: "en",
  });
  // someone else's question never shows in Rosa's list
  await store.create({ ...LINDA, userId: "u-other", quoteId: "q-x" });
  assert(a && b);
  assertEquals(
    (await store.listOpenByUser("u-rosa")).map((i) => i.id).sort(),
    [a.id, b.id].sort(),
  );

  const answered = await store.markAnswered("q-linda", a.id, {
    channel: "email",
    to: "linda.morales@example.com",
    message: "Sí, el sábado a las 9. El colchón son $40 más.",
  });
  assertEquals(answered.answer?.channel, "email");
  assertEquals(answered.answer?.to, "linda.morales@example.com");
  assertEquals(
    answered.answer?.message,
    "Sí, el sábado a las 9. El colchón son $40 más.",
  );
  assertEquals(typeof answered.answeredAt, "string");
  assertEquals(
    (await store.get("q-linda", a.id))?.answeredAt,
    answered.answeredAt,
  );
  assertEquals(
    (await store.listOpenByUser("u-rosa")).map((i) => i.id),
    [b.id],
  );
  await resetKv();
});
