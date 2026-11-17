/**
 * REQ-256 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue onboarding-dashboard-settings-p2 (RCA: EnsureSampleQuote built a
 * fixed paver-patio quote, status "sent", numbered Q-001, in one language).
 *
 * Integration: the coordinator against the real stores on an in-memory KV.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertNotEquals } from "#std/assert";
import { EnsureSampleQuote } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import { isSampleQuote } from "#quote-flow/pipeline-stats.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const identity = new BusinessIdentityStore();
  return { quotes, identity, flow: new EnsureSampleQuote(quotes, identity) };
}

Deno.test("REQ-256 the sample is a draft, unnumbered, flagged, and the first real quote is still Q-001", async () => {
  const { quotes, flow } = await fresh();
  const r = await flow.run({ userId: "u1", language: "en" });
  assertEquals(r.created, true);
  const q = await quotes.get(r.quoteId);
  assertEquals(q.status, "draft");
  assertEquals(q.isSample, true);
  assert(isSampleQuote(q));
  assertEquals(q.number, undefined);
  assertEquals(q.sentAt, undefined);
  const real = await quotes.create("u1", {
    summary: "Real job",
    lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }],
  });
  assertEquals(real.number, "Q-001");
  await resetKv();
});

Deno.test("REQ-256 the sample's job follows the business name — a plumber gets a plumbing job, not a paver patio", async () => {
  const { quotes, identity, flow } = await fresh();
  await identity.upsert("u2", { businessName: "Rivera Plumbing" });
  const q = await quotes.get(
    (await flow.run({ userId: "u2", language: "en" })).quoteId,
  );
  assert(
    !/paver|adoquin/i.test(JSON.stringify(q)),
    `paver content: ${q.jobName}`,
  );
  assert(
    /plumb|drain|pipe|faucet|leak|water heater/i.test(q.jobName ?? ""),
    `job: ${q.jobName}`,
  );
  await resetKv();
});

Deno.test("REQ-256 a business name with no trade gets a general job, not a paver patio", async () => {
  const { quotes, identity, flow } = await fresh();
  await identity.upsert("u3", { businessName: "Acme Holdings" });
  const q = await quotes.get(
    (await flow.run({ userId: "u3", language: "en" })).quoteId,
  );
  assert(
    !/paver|adoquin/i.test(JSON.stringify(q)),
    `paver content: ${q.jobName}`,
  );
  await resetKv();
});

Deno.test("REQ-256 the sample stores its content in English AND Spanish, line items included", async () => {
  const { quotes, identity, flow } = await fresh();
  await identity.upsert("u4", { businessName: "Rivera Plumbing" });
  const q = await quotes.get(
    (await flow.run({ userId: "u4", language: "en" })).quoteId,
  );
  for (
    const field of [
      "jobNameByLang",
      "summaryByLang",
      "descriptionByLang",
    ] as const
  ) {
    const v = q[field] as Record<string, string> | undefined;
    assert(v?.en && v?.es, `${field}: ${JSON.stringify(v)}`);
    assertNotEquals(v.en, v.es, field);
  }
  assertEquals(q.lineItems.length, 2);
  for (
    const li of q.lineItems as Array<
      { description: string; descriptionByLang?: Record<string, string> }
    >
  ) {
    assert(
      li.descriptionByLang?.en && li.descriptionByLang?.es,
      JSON.stringify(li),
    );
    assertNotEquals(li.descriptionByLang.en, li.descriptionByLang.es);
  }
  // the single-language fields are the account's language at the time
  assertEquals(q.jobName, q.jobNameByLang?.en);
  const total = q.lineItems.reduce((s, li) => s + li.price * li.quantity, 0);
  assertEquals(q.estimatedTotal, total);
  await resetKv();
});

Deno.test("REQ-256 the sample stays idempotent per user", async () => {
  const { flow } = await fresh();
  const a = await flow.run({ userId: "u5", language: "es" });
  const b = await flow.run({ userId: "u5", language: "en" });
  assertEquals(b.created, false);
  assertEquals(b.quoteId, a.quoteId);
  await resetKv();
});

// ---------------------------------------------------------------------------
// REQ-241 (demo issue quote-invoice-money-m1) — the onboarding sample quote
// stays out of the owner's Q- sequence: the first real quote after onboarding
// is Q-001, and the sample does not lock the quote starting number (REQ-199).
// (Reconciled on demo-fixes: REQ-256 supersedes REQ-241's "SAMPLE"/"MUESTRA"
// mark — the sample takes no number at all.)
// ---------------------------------------------------------------------------

async function freshNumbered() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const numbering = new DocNumbering();
  const quotes = new QuoteStore(numbering);
  return {
    numbering,
    quotes,
    sample: new EnsureSampleQuote(quotes, new BusinessIdentityStore()),
  };
}

Deno.test("REQ-241: the first real quote after the onboarding sample is Q-001", async () => {
  const { quotes, sample } = await freshNumbered();
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

Deno.test("REQ-241: the sample takes no Q- number in either language (REQ-256: no mark either)", async () => {
  const { quotes, sample } = await freshNumbered();
  try {
    const en = await sample.run({ userId: "u-en" });
    const es = await sample.run({ userId: "u-es", language: "es" });
    const enRow = await quotes.getOwned(en.quoteId, "u-en");
    const esRow = await quotes.getOwned(es.quoteId, "u-es");
    assertEquals(enRow.number, undefined);
    assertEquals(esRow.number, undefined);
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
  const { numbering, sample } = await freshNumbered();
  try {
    await sample.run({ userId: "u-1" });
    assertEquals(await numbering.hasIssued("u-1", "quote"), false);
    assertEquals((await numbering.peek("u-1", "quote")).number, "Q-001");
  } finally {
    await resetKv();
  }
});
