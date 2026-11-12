/**
 * REQ-497 (demo-loop cycle 3, m23): a STANDALONE invoice's typed title and
 * concepts get their other-language text on the server, so /i?lang=en on an
 * invoice a Spanish contractor typed reads English (INV-002 stayed Spanish).
 * The base language is stored verbatim; the other goes through
 * TranslateBullets; a failed translation is never cached.
 */
import { assert, assertEquals } from "#std/assert";
import { TranslateInvoice } from "./mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { InvoiceTranslatorPort } from "@paperwork/domain/coordinators/invoice-translator-port/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const EN: Record<string, string> = {
  "Reparación de cerca": "Fence repair",
  "Cambiar 3 postes": "Replace 3 posts",
  "Pintar la cerca": "Paint the fence",
};

function scriptedLlm(fail = false) {
  const llm = new StubLLMClient();
  const calls: LLMRequest[] = [];
  llm.setHandler((req) => {
    calls.push(req);
    if (fail) throw new Error("model down");
    const { texts } = JSON.parse(req.messages[0].content as string) as {
      texts: string[];
    };
    return { text: JSON.stringify({ texts: texts.map((t) => EN[t] ?? t) }) };
  });
  return { llm, calls };
}

async function setup(fail = false) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  const { llm, calls } = scriptedLlm(fail);
  const port = new InvoiceTranslatorPort();
  const flow = new TranslateInvoice(invoices, new TranslateBullets(llm), port);
  return { invoices, calls, flow, port };
}

const standalone = {
  jobName: "Reparación de cerca",
  description: "Cambiar 3 postes\nPintar la cerca",
  amount: 600_00,
  dueDate: "2026-12-30",
  status: "sent" as const,
};

Deno.test("REQ-497 a Spanish standalone invoice gets its title and concepts in English, the Spanish kept verbatim", async () => {
  const { invoices, flow, calls } = await setup();
  const inv = await invoices.create("u-1", standalone);
  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "es",
  });
  assertEquals(out.lang, "es");
  assertEquals(out.jobNameByLang, {
    es: "Reparación de cerca",
    en: "Fence Repair",
  });
  assertEquals(out.descriptionByLang, {
    es: "Cambiar 3 postes\nPintar la cerca",
    en: "Replace 3 posts\nPaint the fence",
  });
  // one model call, to English only — the base language never goes to it
  assertEquals(calls.length, 1);
  assert(/English/.test(calls[0].systemPrompt ?? ""));
  // idempotent: a second run asks nothing
  await flow.run({ userId: "u-1", invoiceId: inv.id, baseLang: "es" });
  assertEquals(calls.length, 1);
  await resetKv();
});

Deno.test("REQ-497 a failed translation is never cached as the English text", async () => {
  const { invoices, flow } = await setup(true);
  const inv = await invoices.create("u-1", standalone);
  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "es",
  });
  assertEquals(out.jobNameByLang?.en, undefined);
  assertEquals(out.descriptionByLang?.en, undefined);
  await resetKv();
});

Deno.test("REQ-497 a renamed invoice is translated again from its new text", async () => {
  const { invoices, flow, calls } = await setup();
  const inv = await invoices.create("u-1", standalone);
  await flow.run({ userId: "u-1", invoiceId: inv.id, baseLang: "es" });
  await invoices.update(inv.id, "u-1", { jobName: "Pintar la cerca" });
  const out = await flow.run({ userId: "u-1", invoiceId: inv.id });
  assertEquals(calls.length, 2);
  assertEquals(out.jobNameByLang, {
    es: "Pintar la cerca",
    en: "Paint the Fence",
  });
  await resetKv();
});

Deno.test("REQ-497 a quote-linked invoice is left alone — its title comes from the quote", async () => {
  const { invoices, flow, calls } = await setup();
  const inv = await invoices.create("u-1", { ...standalone, quoteId: "q-1" });
  const out = await flow.run({
    userId: "u-1",
    invoiceId: inv.id,
    baseLang: "es",
  });
  assertEquals(out.jobNameByLang, undefined);
  assertEquals(calls.length, 0);
  await resetKv();
});

Deno.test("REQ-497 TranslateInvoice registers itself on the paperwork port, so POST /invoices can reach it", async () => {
  const { invoices, port } = await setup();
  const inv = await invoices.create("u-1", standalone);
  await port.run({ userId: "u-1", invoiceId: inv.id, baseLang: "es" });
  const after = await invoices.getOwned(inv.id, "u-1");
  assertEquals(after.jobNameByLang?.en, "Fence Repair");
  await resetKv();
});
