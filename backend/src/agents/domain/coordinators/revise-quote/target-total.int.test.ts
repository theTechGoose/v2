/**
 * REQ-1027 (LOOP-007 cycle 2, q2-4) — "jorge dijo que es mucho. haz una
 * version 2 de Q-002 sin la cerca, solo la pintura, total 5,550" on a SENT
 * Q-002 (Pintura exterior $4,200 + Reparación de cerca $900 + Materiales para
 * pintura $1,350 = $6,450). The model sent revise_quote {Pintura → 555000,
 * remove cerca}; ReviseQuote wrote that as Version 2 = $6,900 — $1,350 over
 * the total he typed and $450 more than the v1 he called too much.
 *
 * A stated total settles the revision (Pintura $4,200 + Materiales $1,350 =
 * $5,550, Materiales untouched), and a "too much / cheaper" ask that would
 * raise the total writes nothing. Real stores, in-memory KV.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { ReviseQuote, type ReviseQuoteInput } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const Q24_TEXT =
  "jorge dijo que es mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total 5,550";

const Q24_LINES = [
  { description: "Pintura exterior", quantity: 1, unit: "job", price: 420_000 },
  {
    description: "Reparación de cerca (tablas y postes)",
    quantity: 1,
    unit: "job",
    price: 90_000,
  },
  {
    description: "Materiales para pintura",
    quantity: 1,
    unit: "job",
    price: 135_000,
  },
];

async function sentQ002() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const jorge = await customers.create("u-1", { name: "Jorge Ramírez" });
  // Q-001 — another job, so the painting quote is Q-002
  await quotes.create("u-1", {
    summary: "Otro trabajo",
    lineItems: [{
      description: "Limpieza",
      quantity: 1,
      unit: "job",
      price: 10_000,
    }],
    estimatedTotal: 10_000,
  } as never);
  const draft = await quotes.create("u-1", {
    summary: "Pintura exterior y cerca — Jorge Ramírez",
    jobName: "Pintura exterior y cerca",
    customerId: jorge.id,
    lineItems: Q24_LINES,
    estimatedTotal: 645_000,
  } as never);
  assertEquals(draft.number, "Q-002");
  const now = new Date().toISOString();
  await quotes.update(draft.id, "u-1", { status: "sent", sentAt: now });
  return {
    quotes,
    revise: new ReviseQuote(quotes, customers),
    quoteId: draft.id,
  };
}

const MODEL_SENT = {
  lines: [{ match: "Pintura exterior", amountCents: 555_000 }],
  remove: ["cerca"],
};

Deno.test("REQ-1027 q2-4: 'sin la cerca … total 5,550' with the model's Pintura→$5,550 lands Version 2 at $5,550 — Materiales stays $1,350 — or writes nothing and asks", async () => {
  const { quotes, revise, quoteId } = await sentQ002();
  const out = await revise.run({
    userId: "u-1",
    lang: "es",
    boundQuoteId: quoteId,
    quoteNumber: "Q-002",
    ...MODEL_SENT,
    userText: Q24_TEXT,
    // the stated total as handle-chat-message reads it from the message
    targetTotalCents: 555_000,
  } as ReviseQuoteInput);
  const after = await quotes.getOwned(quoteId, "u-1");
  const pending = after.pendingRevision as
    | {
      estimatedTotal?: number;
      lineItems?: { description: string; price: number }[];
    }
    | undefined;
  if (out.outcome.kind === "pending_revision") {
    assertEquals(
      pending?.estimatedTotal,
      555_000,
      `Version 2 must be the $5,550 he typed — reply: ${out.text}`,
    );
    const mat = pending?.lineItems?.find((l) =>
      /materiales/i.test(l.description)
    );
    assertEquals(mat?.price, 135_000, "Materiales para pintura stays $1,350");
    assert(
      !pending?.lineItems?.some((l) => /cerca/i.test(l.description)),
      "the fence is gone",
    );
    assert(!out.text.includes("6,900"), out.text);
  } else {
    assertEquals(pending, undefined, "an ask writes nothing");
    assertStringIncludes(out.text, "5,550");
    assertEquals(after.estimatedTotal, 645_000);
  }
  await resetKv();
});

Deno.test("REQ-1027 q2-4: 'es mucho … más barato' whose revision would RAISE the total writes nothing and asks", async () => {
  const { quotes, revise, quoteId } = await sentQ002();
  const out = await revise.run({
    userId: "u-1",
    lang: "es",
    boundQuoteId: quoteId,
    quoteNumber: "Q-002",
    lines: [{ match: "Pintura exterior", amountCents: 555_000 }],
    remove: ["cerca"],
    userText:
      "jorge dijo que es mucho. haz una version 2 de Q-002 más barata, sin la cerca",
  });
  const after = await quotes.getOwned(quoteId, "u-1");
  assertEquals(
    after.pendingRevision,
    undefined,
    `a 'cheaper' ask must not save a $6,900 Version 2 over $6,450 — reply: ${out.text}`,
  );
  assert(out.outcome.kind !== "pending_revision", out.text);
  await resetKv();
});
