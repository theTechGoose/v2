/**
 * REQ-1024 (LOOP-007 cycle 2, q2-6) — "quita la reparación de la cerca" on
 * the sent Q-002 removed the fence LINE, but the pending revision kept the
 * job-details bullet "También incluye la reparación de la cerca de madera de
 * 18 pies lineales." and Version 2 published it to the customer. The
 * revise_quote patch was { lineItems, estimatedTotal } only.
 *
 * Real stores, in-memory KV; the coordinator runs exactly as the chat calls
 * it (remove = ["cerca"], jobDetails = the quote's bullets).
 */
import { assert, assertEquals } from "#std/assert";
import { ReviseQuote } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const LINES = [
  {
    description: "Pintura exterior",
    quantity: 1,
    unit: "trabajo",
    price: 420_000,
  },
  {
    description: "Reparación de cerca de madera (18 pies lineales)",
    quantity: 1,
    unit: "trabajo",
    price: 90_000,
  },
  {
    description: "Materiales para pintura",
    quantity: 1,
    unit: "trabajo",
    price: 135_000,
  },
];
const DESC_ES = [
  "- Pintura exterior completa de la casa, dos capas.",
  "- También incluye la reparación de la cerca de madera de 18 pies lineales.",
  "- Incluye todos los materiales de pintura.",
].join("\n");
const DESC_EN = [
  "- Full exterior paint of the house, two coats.",
  "- Also includes repairing the 18 linear feet of wood fence.",
  "- Includes all painting materials.",
].join("\n");

Deno.test("REQ-1024 q2-6: removing the fence line from a sent quote also drops the fence bullet from the pending revision's job details (every language)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const revise = new ReviseQuote(quotes, customers);
    const created = await quotes.create("u-1", {
      summary: "Pintura exterior — Marta Ruiz",
      lineItems: LINES,
      estimatedTotal: 645_000,
      description: DESC_ES,
      descriptionByLang: { es: DESC_ES, en: DESC_EN },
    } as never);
    await quotes.update(created.id, "u-1", {
      status: "sent",
      sentAt: new Date().toISOString(),
    } as never);
    const sent = await quotes.get(created.id);
    assert(sent?.sentAt || sent?.status === "sent", "the quote is issued");

    const out = await revise.run({
      userId: "u-1",
      lang: "es",
      boundQuoteId: created.id,
      lines: [{ match: "Pintura exterior", amountCents: 555_000 }],
      remove: ["cerca"],
      userText: "quita la reparación de la cerca y sube la pintura a $5,550",
      jobDetails: DESC_ES,
    });
    assertEquals(out.outcome.kind, "pending_revision", out.text);

    const after = await quotes.get(created.id);
    const pending = after?.pendingRevision as
      | Record<string, unknown>
      | undefined;
    const pendingLines = (pending?.lineItems ?? []) as {
      description: string;
    }[];
    assertEquals(
      pendingLines.map((l) => l.description),
      ["Pintura exterior", "Materiales para pintura"],
      "the fence line is gone from the draft",
    );

    // What Version 2 will publish: the pending job details, else the live ones.
    const v2Description = (pending && "description" in pending
      ? pending.description
      : after?.description) as string | undefined;
    const v2ByLang = (pending && "descriptionByLang" in pending
      ? pending.descriptionByLang
      : after?.descriptionByLang) as Record<string, string> | undefined;
    assert(
      !/cerca/i.test(v2Description ?? ""),
      `Version 2's job details still describe the removed fence: ${
        JSON.stringify(v2Description)
      }`,
    );
    for (const [lang, text] of Object.entries(v2ByLang ?? {})) {
      assert(
        !/cerca|fence/i.test(text),
        `Version 2's ${lang} job details still describe the removed fence: ${
          JSON.stringify(text)
        }`,
      );
    }
    // the other bullets stay
    assert(
      /Pintura exterior completa/.test(v2Description ?? ""),
      `the painting bullet survives: ${JSON.stringify(v2Description)}`,
    );
  } finally {
    await resetKv();
  }
});
