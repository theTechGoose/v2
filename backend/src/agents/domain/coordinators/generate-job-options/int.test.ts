import { assert, assertEquals } from "#std/assert";
import { GenerateJobOptions } from "./mod.ts";
import { t } from "@core/i18n/mod.ts";
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
  // REQ-330 (p15-7): a one-line job gets 1–3 cards, never two alike.
  assert(res.options.length >= 1 && res.options.length <= 3);
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
  let seenFormat: string | undefined;
  // REQ-028: the call asks the model for JSON mode — a syntactically valid
  // object every time (live probes fell to the fallback 4 of 5 times on a
  // missing brace in the byLang structure).
  llm.setHandler((req) => ({
    text: ((seenFormat = req.responseFormat), JSON.stringify({
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
    })),
  }));
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en"] });
  assertEquals(seenFormat, "json");
  assertEquals(res.degraded, false);
  // Two usable options pass through; the third is an honest variant of the
  // first (REQ-028 amendment — the picker promises three versions).
  assertEquals(res.options.length, 3);
  assertEquals(res.options[0].bullets, [
    "Remove the old toilet",
    "Install a new toilet",
  ]);
  assertEquals(res.options[1].jobName, "Toilet Swap");
  assert(res.options[2].jobName.startsWith("Toilet Replacement · "), res.options[2].jobName);
});

Deno.test("REQ-028 NW-05 a reply that echoes the prompt's placeholders is not usable → honest fallback", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        { en: { jobName: "...", summary: "...", bullets: ["...", "...", "..."] } },
        { en: { jobName: "<3 words>", summary: "…", bullets: ["<scope line>"] } },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options[0].bullets, ["Replace a toile"]);
});

Deno.test("REQ-026 NW-05 (c) the default '(stub) …' echo takes the same honest fallback", async () => {
  const { coord } = fresh();
  const res = await coord.run({ userId: "u1", raw: RAW, langs: ["en", "es"] });
  assertEquals(res.degraded, true);
  // REQ-330 (p15-7): a one-line job gets 1–3 cards, never two alike.
  assert(res.options.length >= 1 && res.options.length <= 3);
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

// REQ-028 amendment (NW-05 / P-24): the picker promises three versions.
// Live: gpt-4o-mini answered one option object carrying three duplicate
// "byLang" keys (JSON.parse keeps the last) → one card. A short but usable
// answer is padded to three distinct variants of the first option.
Deno.test("REQ-028 NW-05 a usable one-option reply is padded to three distinct versions", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        es: {
          jobName: "Reparación de Cerca",
          summary: "Reparar la cerca del patio",
          bullets: ["Reemplazar tres postes", "Ajustar la estructura", "Pintar la madera"],
        },
        en: {
          jobName: "Fence Repair",
          summary: "Repair the backyard fence",
          bullets: ["Replace three posts", "Adjust the structure", "Paint the wood"],
        },
      }],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: "Reparar la cerca", langs: ["es", "en"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 3);
  const names = res.options.map((o) => o.jobName);
  assertEquals(new Set(names).size, 3, `distinct titles: ${names}`);
  assertEquals(res.options[0].bullets, ["Reemplazar tres postes", "Ajustar la estructura", "Pintar la madera"]);
  assertEquals(res.options[1].bullets.length, 2);
  assertEquals(res.options[2].bullets.length, 4);
  assertEquals(res.options[2].byLang.en.bullets[3], "Jobsite cleanup");
  assertEquals(res.options.map((o) => o.id), ["opt1", "opt2", "opt3"]);
});

// REQ-266 (demo issue ai-assistant-p7-options): a 900-character gut job
// lists ten scope items; the options pass cut every option to 4 bullets
// (prompt "3 or 4 bullets — no more, no fewer" + `.slice(0, 4)`), so hex
// mosaic, faucets, fan and lights vanished, and the anti-echo rule made the
// model swap the contractor's own word "Gutted" for "Removed".
const GUT_JOB_ITEMS = [
  "Gutted old fixtures and tile",
  "Curbless shower",
  "Slab cut for linear drain",
  "Frameless glass enclosure",
  "72 inch double vanity",
  "Hex mosaic shower floor",
  "Two widespread faucets",
  "Exhaust fan",
  "Recessed lights",
  "Pull the permit",
];

Deno.test("REQ-266 ai-assistant-p7-options the detailed option keeps all ten scope items the model returns", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          en: {
            jobName: "Bathroom Remodel",
            summary: "Full bathroom gut remodel",
            bullets: ["Gut and rebuild the bathroom", "Curbless shower with glass", "New vanity and fixtures"],
          },
        },
        {
          en: {
            jobName: "Bath Gut Remodel",
            summary: "Full bathroom gut with curbless shower",
            bullets: GUT_JOB_ITEMS,
          },
        },
        {
          en: {
            jobName: "Master Bath Rebuild",
            summary: "Bathroom rebuild",
            bullets: GUT_JOB_ITEMS.slice(0, 5),
          },
        },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join(", "), langs: ["en"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options[1].bullets, GUT_JOB_ITEMS);
  assertEquals(res.options[1].byLang.en.bullets.length, 10);
});

Deno.test("REQ-266 ai-assistant-p7-options the honest fallback keeps all ten scope lines the contractor typed", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join("\n"), langs: ["en"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options[0].bullets, GUT_JOB_ITEMS);
});

Deno.test("REQ-266 ai-assistant-p7-options the prompt asks for every scope item and the contractor's own trade words", async () => {
  const { llm, coord } = fresh();
  let systemPrompt = "";
  llm.setHandler((req) => {
    systemPrompt = req.systemPrompt ?? "";
    throw new Error("only reading the prompt");
  });
  await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join(", "), langs: ["en"] });
  // No hard 3–4 cap that forces a ten-item job into four bullets.
  assert(!/no more, no fewer/i.test(systemPrompt), "prompt still caps bullets at 3 or 4");
  assert(!/3 or 4 bullets/i.test(systemPrompt), "prompt still caps bullets at 3 or 4");
  // The detailed option must carry every distinct scope item.
  assert(/every distinct scope item/i.test(systemPrompt), "prompt does not require every scope item");
  // Anti-echo stays, but trade words survive ("gutted" is not reworded to "removed").
  assert(/verbatim/i.test(systemPrompt), "the anti-echo rule (REQ-026) must stay");
  assert(/own trade (?:verbs|words)/i.test(systemPrompt), "prompt does not keep the contractor's trade words");
  assert(/gutted/i.test(systemPrompt), "prompt does not name the 'gutted' example");
});

Deno.test("REQ-266 ai-assistant-p7-options the fallback 'wider scope' version never has fewer items than the full one", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join("\n"), langs: ["en"] });
  assertEquals(res.options[2].bullets, [...GUT_JOB_ITEMS, "Jobsite cleanup"]);
});

// REQ-261 (demo M26): a contractor's private cost ("Ray the plumber is
// $2800") must never become a customer-facing scope bullet. The model was
// told to drop prices; a bullet that still names a money amount is dropped
// deterministically, in every language.
Deno.test("REQ-261 M26 a model bullet naming a money amount is dropped in every language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        en: {
          jobName: "Bathroom Rough-In",
          summary: "Bathroom plumbing rough-in",
          bullets: [
            "Bathroom plumbing rough-in",
            "Plumber Ray charges $2,800 for the rough-in",
            "Install shutoff valves",
          ],
        },
        es: {
          jobName: "Instalación de baño",
          summary: "Instalación de plomería del baño",
          bullets: [
            "Instalación de plomería del baño",
            "El plomero Ray cobra $2,800 por la instalación",
            "Instalar válvulas de cierre",
          ],
        },
      }],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "$2800 plumbing rough-in. Ray the plumber is $2800",
    langs: ["en", "es"],
  });
  assertEquals(res.degraded, false);
  for (const b of allBullets(res.options)) {
    assert(!/\$\s?\d/.test(b), `bullet leaks a private cost: ${b}`);
    assert(!/Ray/.test(b), `bullet names the sub: ${b}`);
  }
  assertEquals(res.options[0].byLang.en.bullets, [
    "Bathroom plumbing rough-in",
    "Install shutoff valves",
  ]);
  assertEquals(res.options[0].byLang.es.bullets, [
    "Instalación de plomería del baño",
    "Instalar válvulas de cierre",
  ]);
});

// ── REQ-330 (demo cycle 1: M21, M23, p15-7) ────────────────────────────────
// M21/M23: a gut job with MORE than twelve items lost its late items (recessed
// lights, permit, vanity) because normalizeOneLang sliced every option at
// MAX_OPTION_BULLETS; the edit-reopen (M23) hit the same cap on the 13th,
// user-added line. p15-7: a one-item job came back as three options with the
// same bullets, since only jobNames were ever de-duplicated.

const HENDERSON_ITEMS = [
  ...GUT_JOB_ITEMS,
  "Four recessed lights",
  "Customer-supplied vanity",
  "Install new toilet",
  "Paint walls and ceiling",
];

Deno.test("REQ-330 M21 a fourteen-item model option keeps all fourteen bullets (no hard cap)", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        { en: { jobName: "Master Bath Remodel", summary: "Full gut", bullets: HENDERSON_ITEMS } },
        { en: { jobName: "Bath Gut", summary: "Gut remodel", bullets: HENDERSON_ITEMS.slice(0, 5) } },
        { en: { jobName: "Bath Rebuild", summary: "Rebuild", bullets: HENDERSON_ITEMS.slice(0, 3) } },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: HENDERSON_ITEMS.join(", "), langs: ["en", "es"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options[0].bullets, HENDERSON_ITEMS);
  assertEquals(res.options[0].bullets.length, 14);
  assertEquals(res.options[0].byLang.es.bullets.length, 14);
});

Deno.test("REQ-330 M23 the honest fallback keeps all fourteen typed lines", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: HENDERSON_ITEMS.join("\n"), langs: ["en"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options[0].bullets, HENDERSON_ITEMS);
});

Deno.test("REQ-330 p15-7 options with the same bullets collapse; a one-item job yields fewer than three, never two alike", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        { en: { jobName: "Shingle Replacement", summary: "Replace shingles", bullets: ["Replace 10 squares of shingles"] } },
        { en: { jobName: "Roof Shingle Installation", summary: "Install shingles", bullets: ["Replace 10 squares of shingles."] } },
        { en: { jobName: "Roof Repair", summary: "Roof repair", bullets: ["replace 10 squares of  shingles"] } },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: "replace 10 squares of shingles", langs: ["en"] });
  assertEquals(res.degraded, false);
  assert(res.options.length >= 1 && res.options.length <= 3, `got ${res.options.length} options`);
  const keys = res.options.map((o) => o.bullets.map((b) => b.toLowerCase()).join("|"));
  assertEquals(new Set(keys).size, keys.length, `duplicate bullet sets: ${JSON.stringify(keys)}`);
  // The surviving model option keeps its bullet; the padded "wider" variant
  // adds jobsite cleanup; there is no "short" variant equal to the base.
  assertEquals(res.options[0].bullets, ["Replace 10 squares of shingles"]);
  for (const o of res.options.slice(1)) {
    assert(o.bullets.length > 1, `a padded variant repeats the one bullet: ${JSON.stringify(o)}`);
  }
});

Deno.test("REQ-330 p15-7 the fallback for a one-line job never paints two cards with the same bullets", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: "I need to replace a toile for $500", langs: ["en", "es"] });
  const keys = res.options.map((o) => o.bullets.join("|"));
  assertEquals(new Set(keys).size, keys.length, `duplicate bullet sets: ${JSON.stringify(keys)}`);
  assert(res.options.length >= 1 && res.options.length <= 3);
});

Deno.test("REQ-330 M21/p15-7 the prompt groups past twelve instead of capping, and allows fewer options for a one-item job", async () => {
  const { llm, coord } = fresh();
  let systemPrompt = "";
  llm.setHandler((req) => {
    systemPrompt = req.systemPrompt ?? "";
    throw new Error("only reading the prompt");
  });
  await coord.run({ userId: "u1", raw: HENDERSON_ITEMS.join(", "), langs: ["en"] });
  assert(!/at most 12/i.test(systemPrompt), "prompt still caps bullets at 12");
  assert(/more than 12/i.test(systemPrompt) && /group/i.test(systemPrompt), "prompt does not say to group past 12");
  assert(!/Return exactly 3 options\./i.test(systemPrompt), "prompt still demands exactly 3 options for every job");
  assert(/same bullets/i.test(systemPrompt), "prompt does not forbid two options with the same bullets");
});

// REQ-337 (demo-loop cycle 1, p15-1): "Bedroom Repaint" for bedrooms AND a
// hallway — the 3-word cap made a name covering both areas impossible.
Deno.test("REQ-337 p15-1 the model's jobName naming every area survives whole, in both languages", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        byLang: {
          en: {
            jobName: "Bedroom & Hallway Repaint",
            summary: "Repaint three bedrooms and the hallway",
            bullets: ["Repaint three bedrooms", "Repaint the hallway", "Jobsite cleanup"],
          },
          es: {
            jobName: "Repintar dormitorios y pasillo",
            summary: "Repintar tres dormitorios y el pasillo",
            bullets: ["Repintar tres dormitorios", "Repintar el pasillo", "Limpieza"],
          },
        },
      }],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "repaint 3 bedrooms and the hallway",
    langs: ["en", "es"],
  });
  assertEquals(res.options[0].jobName, "Bedroom & Hallway Repaint");
  assertEquals(res.options[0].byLang.es.jobName, "Repintar dormitorios y pasillo");
});

Deno.test("REQ-337 p15-1 the prompt asks for a jobName that names every area within the budget, not 'three words or fewer'", () => {
  for (const lang of ["en", "es"] as const) {
    const p = t(lang, "prompts.generateJobOptions");
    assert(!/three words or fewer/i.test(p), `${lang}: still caps at three words`);
    assert(/every area/i.test(p), `${lang}: does not ask to cover every area`);
    assert(/30 characters/.test(p), `${lang}: no character budget`);
  }
});
