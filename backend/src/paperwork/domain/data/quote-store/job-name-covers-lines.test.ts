/**
 * REQ-1094 (LOOP-007 cycle 3, q3-3) — AMENDMENT of REQ-1051: the quote
 * store's derived job name names every area the quote's LINES cover.
 *
 * QA 5 typed "Exterior house paint $3,800 and paint the backyard fence
 * $450.50". The quote stored both lines, but the model's summary read
 * "Exterior painting", and with no jobName QuoteStore derived the name from
 * that summary alone — "Exterior Painting" / "Pintura exterior". The /q
 * heading and every email subject then dropped the fence.
 *
 * Target: QuoteStore.create's fallback (backend/src/paperwork/domain/data/
 * quote-store/mod.ts) — it never looks at lineItems.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { isValidJobName } from "#quote-flow/job-name.ts";

async function derive(
  summary: string,
  lines: string[],
  lang: "en" | "es",
): Promise<string> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const q = await new QuoteStore().create("u-1", {
      summary,
      lineItems: lines.map((description, i) => ({
        description,
        quantity: 1,
        unit: "ea",
        price: i === 0 ? 380_000 : 45_050,
      })),
      status: "draft",
    }, { jobNameLang: lang });
    return q.jobName ?? "";
  } finally {
    await resetKv();
  }
}

Deno.test("REQ-1094 (LOOP-007 q3-3) QuoteStore derives a job name for 'Exterior painting — María José Peña' with house + fence lines that names the fence", async () => {
  const name = await derive("Exterior painting — María José Peña", [
    "Exterior house paint",
    "Paint the backyard fence",
  ], "en");
  assert(isValidJobName(name), `jobName "${name}" is outside the budget`);
  assertStringIncludes(
    name.toLowerCase(),
    "fence",
    `the stored jobName "${name}" dropped the fence line`,
  );
});

Deno.test("REQ-1094 (LOOP-007 q3-3) QuoteStore derives a job name for 'Pintura exterior — María José Peña' with casa + cerca lines that names the cerca", async () => {
  const name = await derive("Pintura exterior — María José Peña", [
    "Pintura exterior de la casa",
    "Pintura de la cerca del patio trasero",
  ], "es");
  assert(isValidJobName(name), `jobName "${name}" is outside the budget`);
  assertStringIncludes(
    name.toLowerCase(),
    "cerca",
    `the stored jobName "${name}" dropped the cerca line`,
  );
});
