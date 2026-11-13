/**
 * REQ-710 (demo-loop cycle 5, M4): pair 9's English invoice INV-002 had an
 * English title ("Removal of Refrigerator and Washing Machine") over the
 * Spanish line "Retiro de refrigerador y lavadora" — TranslateInvoice
 * (REQ-497) translated the title and the description only, never the line
 * items. The lines now ride the same batch, the base language is the one the
 * invoice was typed in (not the app's), and an edited line is translated
 * afresh while untouched lines keep theirs.
 */
import { assert, assertEquals } from "#std/assert";
import { TranslateInvoice } from "./mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const EN_OF: Record<string, string> = {
  "Retiro de refrigerador y lavadora":
    "Removal of refrigerator and washing machine",
  "Retiro de electrodomésticos": "appliance removal",
  "Retiro de estufa": "Stove removal",
  "Limpieza del área": "Cleanup of the area",
};

function scriptedLlm() {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  llm.setHandler((req) => {
    calls.push(req);
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

async function setup() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const { llm, calls } = scriptedLlm();
  const flow = new TranslateInvoice(invoices, new TranslateBullets(llm));
  return { invoices, calls, flow };
}

const line = (description: string, price = 20_000) => ({
  description,
  quantity: 1,
  unit: "job",
  price,
});

Deno.test("REQ-710 (cycle 5, M4) a standalone invoice's line items get their English text in the title's batch (pair 9)", async () => {
  const { invoices, calls, flow } = await setup();
  const inv = await invoices.create("u-1", {
    jobName: "Retiro de electrodomésticos",
    lineItems: [line("Retiro de refrigerador y lavadora")],
    amount: 20_000,
    dueDate: "2026-12-30",
    status: "sent",
  });

  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "es",
  });

  assertEquals(out.lang, "es");
  assertEquals(out.jobNameByLang?.en, "Appliance Removal");
  assertEquals(out.lineItems?.[0].descriptionByLang, {
    es: "Retiro de refrigerador y lavadora",
    en: "Removal of refrigerator and washing machine",
  });
  // the line's text, quantity and price are untouched
  assertEquals(
    out.lineItems?.[0].description,
    "Retiro de refrigerador y lavadora",
  );
  assertEquals(out.lineItems?.[0].price, 20_000);
  assertEquals(calls.length, 1, "the title and the line ride one call");

  // idempotent: nothing left to ask
  await flow.run({ userId: "u-1", invoiceId: inv.id, baseLang: "es" });
  assertEquals(calls.length, 1);
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) an invoice typed in Spanish from an English app is based on Spanish — the app language is only a fallback", async () => {
  const { invoices, calls, flow } = await setup();
  const inv = await invoices.create("u-1", {
    jobName: "Retiro de electrodomésticos",
    lineItems: [line("Retiro de refrigerador y lavadora")],
    amount: 20_000,
    dueDate: "2026-12-30",
    status: "sent",
  });

  // The controller passes the app language (English) as the hint.
  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "en",
  });

  assertEquals(out.lang, "es");
  assertEquals(out.jobNameByLang, {
    es: "Retiro de electrodomésticos",
    en: "Appliance Removal",
  });
  assertEquals(
    out.lineItems?.[0].descriptionByLang?.en,
    "Removal of refrigerator and washing machine",
  );
  assert(
    calls.every((c) => /bullet lines into English/.test(c.systemPrompt ?? "")),
    "the Spanish was never sent to be made Spanish",
  );
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) an edited line is translated afresh; the untouched line keeps its translation", async () => {
  const { invoices, calls, flow } = await setup();
  const inv = await invoices.create("u-1", {
    jobName: "Retiro de electrodomésticos",
    lineItems: [
      line("Retiro de refrigerador y lavadora"),
      line("Limpieza del área", 5_000),
    ],
    amount: 25_000,
    dueDate: "2026-12-30",
    status: "draft",
  });
  await flow.run({ userId: "u-1", invoiceId: inv.id, baseLang: "es" });
  assertEquals(calls.length, 1);

  // The contractor rewrites the first line; the editor round-trips the map.
  const stored = await invoices.getOwned(inv.id, "u-1");
  await invoices.update(inv.id, "u-1", {
    lineItems: [
      { ...stored.lineItems![0], description: "Retiro de estufa" },
      stored.lineItems![1],
    ],
  });

  const out = await flow.run({ userId: "u-1", invoiceId: inv.id });

  assertEquals(out.lineItems?.map((li) => li.descriptionByLang?.en), [
    "Stove removal",
    "Cleanup of the area",
  ]);
  assertEquals(calls.length, 2);
  const sent = JSON.parse(calls[1].messages[0].content as string).texts;
  assertEquals(sent, ["Retiro de estufa"], "only the edited line is asked");
  await resetKv();
});

Deno.test("REQ-710 (cycle 5, M4) a batch invoice's visits are left alone — they render grouped by address, so only the title is asked", async () => {
  const { invoices, calls, flow } = await setup();
  const addr = "12 Calle Luna, Austin, TX";
  const visit = (date: string) => ({
    description: `${date} — Césped — ${addr}`,
    quantity: 1,
    unit: "visit",
    price: 6_500,
    date,
    service: "Césped",
    address: addr,
  });
  const inv = await invoices.create("u-1", {
    jobName: "Retiro de estufa",
    lineItems: [visit("2026-10-02"), visit("2026-10-09")],
    amount: 13_000,
    dueDate: "2026-12-30",
    status: "draft",
  });

  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "es",
  });

  assertEquals(calls.length, 1);
  assertEquals(
    JSON.parse(calls[0].messages[0].content as string).texts,
    ["Retiro de estufa"],
    "the visits are not sent to the model",
  );
  assertEquals(out.jobNameByLang?.en, "Stove Removal");
  assertEquals(out.lineItems?.map((li) => li.descriptionByLang), [
    undefined,
    undefined,
  ]);
  await resetKv();
});
