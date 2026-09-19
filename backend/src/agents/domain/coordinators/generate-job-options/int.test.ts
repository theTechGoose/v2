import { assert, assertEquals } from "#std/assert";
import { GenerateJobOptions } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

/**
 * REQ-026 — 5.1 NW-05: the fallback never echoes the contractor's sentence.
 *
 * "The AI must never echo the user's raw input back as the suggested
 * description. (Screenshot: all three 'I Need To' options just repeat
 * 'I need to replace a toile for $500'.)"
 *
 * Every path that cannot use the model — the call throws, or the reply is
 * not the JSON we asked for (the dev stub's "(stub) …" echo) — used to bullet
 * the raw sentence verbatim and title it "I Need To". It now derives honest
 * scope bullets (intent prefix and price clause stripped) and says so with
 * `degraded: true`; a real model reply passes through with `degraded: false`.
 */

const RAW = "I need to replace a toile for $500";

function fresh() {
  const llm = new StubLLMClient();
  return { llm, coord: new GenerateJobOptions(llm) };
}

function allBullets(
  options: Array<{ bullets: string[]; byLang: Record<string, { bullets: string[] }> }>,
): string[] {
  return options.flatMap((o) => [
    ...o.bullets,
    ...Object.values(o.byLang).flatMap((l) => l.bullets),
  ]);
}

Deno.test("REQ-026 NW-05 (a) llm throws → honest bullets, no echo, no price, degraded", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en"] });
  assertEquals(res.options.length, 3);
  assertEquals(res.degraded, true);
  for (const b of allBullets(res.options)) {
    assert(b !== RAW, `bullet echoes the raw sentence: ${b}`);
    assert(!b.includes("$500"), `bullet carries the price: ${b}`);
    assert(!/^I need to/i.test(b), `bullet keeps the intent prefix: ${b}`);
  }
  assertEquals(res.options[0].bullets, ["Replace a toile"]);
  // The title is derived from the scope, never "I Need To".
  for (const o of res.options) {
    assert(!/^I Need To/.test(o.jobName), `jobName is the intent prefix: ${o.jobName}`);
  }
  assertEquals(res.options[0].jobName, "Replace A Toile");
});

Deno.test("REQ-026 NW-05 (b) a valid model reply passes through, degraded false", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          byLang: {
            en: {
              jobName: "Toilet replacement",
              summary: "Replace the toilet",
              bullets: ["Remove the old toilet", "Install a new toilet"],
            },
          },
        },
        {
          byLang: {
            en: {
              jobName: "Toilet swap",
              summary: "Swap the toilet",
              bullets: ["Swap the toilet"],
            },
          },
        },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 2);
  assertEquals(res.options[0].bullets, [
    "Remove the old toilet",
    "Install a new toilet",
  ]);
});

Deno.test("REQ-026 NW-05 (c) the default '(stub) …' echo takes the same honest fallback", async () => {
  const { coord } = fresh();
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en", "es"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options.length, 3);
  for (const b of allBullets(res.options)) {
    assert(b !== RAW, `bullet echoes the raw sentence: ${b}`);
    assert(!b.includes("$500"), `bullet carries the price: ${b}`);
  }
  assertEquals(res.options[0].byLang.en.bullets, ["Replace a toile"]);
});

Deno.test("REQ-026 NW-05 nothing scope-like ('ok') → the localized 'New job' bullet, degraded", async () => {
  const { coord } = fresh();
  const res = await coord.run({ userId: "u1", raw: "ok", langs: ["es"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options[0].byLang.es.bullets, ["Nuevo trabajo"]);
});
