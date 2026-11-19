/**
 * REQ-1051 (LOOP-007 cycle 2, q2-35) — AMENDMENT of REQ-337: the quote
 * store's deterministic job name keeps every area the summary names.
 *
 * A Spanish quote "Pintura exterior y reparación de cerca — Jorge Ramirez"
 * created with no jobName was named "Pintura exterior": summarizeJobName ran
 * with its 3-word default, took [Pintura, exterior, y] and trimmed the "y".
 * The SMS and /q title then dropped the fence the chat card named.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { isValidJobName } from "#quote-flow/job-name.ts";

Deno.test("REQ-1051 (LOOP-007 q2-35) QuoteStore names 'Pintura exterior y reparación de cerca — Jorge Ramirez' within budget and keeps the fence", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const q = await new QuoteStore().create("u-1", {
      summary: "Pintura exterior y reparación de cerca — Jorge Ramirez",
      lineItems: [{
        description: "Pintura exterior",
        quantity: 1,
        unit: "ea",
        price: 420_000,
      }, {
        description: "Reparación de cerca",
        quantity: 1,
        unit: "ea",
        price: 180_000,
      }],
      status: "draft",
    }, { jobNameLang: "es" });
    const name = q.jobName ?? "";
    assert(isValidJobName(name), `jobName "${name}" is outside the budget`);
    assertStringIncludes(name.toLowerCase(), "cerca");
  } finally {
    await resetKv();
  }
});
