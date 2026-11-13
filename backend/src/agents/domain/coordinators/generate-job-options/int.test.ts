import { assert, assertEquals } from "#std/assert";
import { GenerateJobOptions } from "./mod.ts";
import { t } from "@core/i18n/mod.ts";
import { nearTwinBullets } from "#quote-flow/option-bullets.ts";
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
  // Two usable options pass through. REQ-722 AMENDMENT (cycle 5, p18-3b):
  // the only padding is the first option regrouped, a near-twin of a
  // two-line job (REQ-584) — so no invented "· Wider scope" third card.
  assertEquals(res.options.length, 2);
  assertEquals(res.options[0].bullets, [
    "Remove the old toilet",
    "Install a new toilet",
  ]);
  assertEquals(res.options[1].jobName, "Toilet Swap");
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
// REQ-584 AMENDMENT: the "· Short version" pad is the same words regrouped
// — a near-twin — so a three-line job is padded with the wider version only.
// REQ-722 AMENDMENT (cycle 5, p18-3b): the wider version appended an invented
// "Jobsite cleanup" line and is gone — this job keeps its one honest card.
Deno.test("REQ-028 NW-05 a usable one-option reply is padded with distinct versions only (REQ-584: no near-twins)", async () => {
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
  assertEquals(res.options.length, 1);
  assertEquals(res.options[0].bullets, ["Reemplazar tres postes", "Ajustar la estructura", "Pintar la madera"]);
  assertEquals(res.options[0].byLang.en.bullets, ["Replace three posts", "Adjust the structure", "Paint the wood"]);
  assertEquals(res.options.map((o) => o.id), ["opt1"]);
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
  // REQ-400 (M21): the two versions that hold only part of the job are
  // dropped — the whole-job option leads.
  assertEquals(res.options[0].bullets, GUT_JOB_ITEMS);
  assertEquals(res.options[0].byLang.en.bullets.length, 10);
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

// REQ-722 AMENDMENT (cycle 5, p18-3b): the fallback's "wider scope" version
// (every item + "Jobsite cleanup") is gone; its short version still holds
// every item, and no version holds anything else.
Deno.test("REQ-266 ai-assistant-p7-options the fallback's short version never has fewer items than the full one", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join("\n"), langs: ["en"] });
  assertEquals(res.options.length, 2);
  const short = res.options[1].bullets.join("; ").toLowerCase();
  for (const item of GUT_JOB_ITEMS) assert(short.includes(item.toLowerCase()), item);
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

// ── REQ-400 (demo-loop cycle 2: M21, m32) ──────────────────────────────────
// M21: pair 7's master-bath gut came back as three "versions" that each held
// a third of the job — v1 (tub out, curbless shower, tile), v2 (drain+niche,
// glass, vanity), v3 (drain move, fan+lights, heated floor). The prompt's
// output example gave every option exactly three bullets and nothing on the
// server checked that an option covers the job. m32: pair 2's lawn job got
// "Servicio para Ana López" / "Cliente: Ana López" as scope bullets.

const V1 = [
  "Remove old tub/shower combo",
  "Install walk-in shower with curbless entry",
  "Porcelain tile 12x24 on walls",
];
const V2 = ["Linear drain and niche", "Frameless glass panel", "Double vanity"];
const V3 = ["Move drain on slab", "Exhaust fan and recessed lights", "Heated floor"];
const V1_ES = [
  "Retirar la combinación de bañera y ducha",
  "Instalar ducha a nivel del suelo sin bordillo",
  "Azulejo de porcelana 12x24 en paredes",
];
const V2_ES = ["Desagüe lineal y nicho", "Panel de vidrio sin marco", "Mueble de baño doble"];
const V3_ES = [
  "Mover el desagüe en la losa",
  "Extractor y luces empotradas",
  "Piso radiante",
];
/** One word per scope item — every version of the job names all nine. */
const PRIYA_KEYS = ["tub", "curbless", "porcelain", "niche", "glass", "vanity", "slab", "fan", "heated"];
const PRIYA_RAW =
  "Master bath gut for Maria Gutierrez 512-555-0188 maria.g@example.com: remove tub/shower combo, " +
  "curbless walk-in shower w/ linear drain + niche, 12x24 porcelain on walls, frameless glass panel, " +
  "60in double vanity, move drain on slab, exhaust fan + 4 recessed lights, heated floor. Thinking 3 weeks.";

function option(en: string[], es: string[], name: string) {
  return {
    en: { jobName: name, summary: `${name} scope`, bullets: en },
    es: { jobName: name, summary: `${name} alcance`, bullets: es },
  };
}
const splitReply = () =>
  JSON.stringify({
    options: [
      option(V1, V1_ES, "Master Bath Remodel"),
      option(V2, V2_ES, "Master Bath Upgrade"),
      option(V3, V3_ES, "Complete Bathroom Renovation"),
    ],
  });
const WHOLE_CONCISE = [
  "Tub/shower combo out; curbless walk-in shower with linear drain and niche",
  "12x24 porcelain wall tile and frameless glass panel",
  "Double vanity; move the drain on the slab",
  "Exhaust fan, recessed lights and heated floor",
];
// REQ-710 AMENDMENT (cycle 5, M4): the Spanish slot holds Spanish — English
// lines there are now translated into Spanish (one more model call), which
// is not what this test counts.
const WHOLE_CONCISE_ES = [
  "Retirar la combinación de bañera y ducha; ducha a nivel del suelo con desagüe lineal y nicho",
  "Azulejo de porcelana 12x24 en paredes y panel de vidrio sin marco",
  "Mueble de baño doble; mover el desagüe en la losa",
  "Extractor, luces empotradas y piso radiante",
];
const wholeReply = () =>
  JSON.stringify({
    options: [
      option(WHOLE_CONCISE, WHOLE_CONCISE_ES, "Master Bath Remodel"),
      option([...V1, ...V2, ...V3], [...V1_ES, ...V2_ES, ...V3_ES], "Master Bath Gut"),
    ],
  });

function assertWholeJob(
  options: Array<{ jobName: string; bullets: string[] }>,
  keys: string[],
) {
  for (const o of options) {
    const text = o.bullets.join(" | ").toLowerCase();
    for (const k of keys) {
      assert(text.includes(k), `"${o.jobName}" leaves out "${k}": ${JSON.stringify(o.bullets)}`);
    }
  }
}

Deno.test("REQ-400 (M21) a reply that splits the job across the options is asked again once; the whole-job answer is used", async () => {
  const { llm, coord } = fresh();
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  llm.setHandler((req) => {
    calls.push({ messages: req.messages.map((m) => ({ role: m.role, content: m.content })) });
    return { text: calls.length === 1 ? splitReply() : wholeReply() };
  });
  const res = await coord.run({ userId: "u1", raw: PRIYA_RAW, langs: ["en", "es"] });
  assertEquals(calls.length, 2, "the split answer is re-asked exactly once");
  assertEquals(res.degraded, false);
  assertWholeJob(res.options, PRIYA_KEYS);
  // The second ask carries the first answer and names every item it split.
  const [first, second] = calls;
  assertEquals(second.messages[0], first.messages[0]);
  assertEquals(second.messages[1].role, "assistant");
  assertEquals(second.messages[2].role, "user");
  for (const line of [...V1, ...V2, ...V3]) {
    assert(second.messages[2].content.includes(line), `the re-ask names "${line}"`);
  }
  assert(/every option/i.test(second.messages[2].content));
});

Deno.test("REQ-400 (M21) a model that splits the job twice: the parts merge into one version that holds every item", async () => {
  const { llm, coord } = fresh();
  let n = 0;
  llm.setHandler(() => ({ text: (n++, splitReply()) }));
  const res = await coord.run({ userId: "u1", raw: PRIYA_RAW, langs: ["en", "es"] });
  assertEquals(n, 2);
  assertEquals(res.degraded, false);
  // REQ-439 (M9) amendment: the typed "60in" and "4 recessed lights" that
  // both replies dropped go back into the lines that name them.
  const kept = (lines: string[], swap: Record<string, string>) =>
    lines.map((l) => swap[l] ?? l);
  assertEquals(
    res.options[0].bullets,
    kept([...V1, ...V2, ...V3], {
      "Double vanity": "Double vanity (60in)",
      "Exhaust fan and recessed lights": "Exhaust fan and 4 recessed lights",
    }),
  );
  assertEquals(
    res.options[0].byLang.es.bullets,
    kept([...V1_ES, ...V2_ES, ...V3_ES], {
      "Mueble de baño doble": "Mueble de baño doble (60in)",
      "Extractor y luces empotradas": "Extractor y luces empotradas (4 recessed lights)",
    }),
  );
  assertWholeJob(res.options, PRIYA_KEYS);
  // the "· Short version" keeps every item too — grouped, never cut
  for (const o of res.options) {
    assert(!/^(?:Master Bath Upgrade|Complete Bathroom Renovation)$/.test(o.jobName), `a third survived: ${o.jobName}`);
  }
});

Deno.test("REQ-400 (M21) a whole-job option among partial ones: the partial ones are dropped and the model is not asked again", async () => {
  const { llm, coord } = fresh();
  let n = 0;
  llm.setHandler(() => ({
    text: (n++, JSON.stringify({
      options: [
        { en: { jobName: "Bathroom Remodel", summary: "s", bullets: ["Gut and rebuild the bathroom", "Curbless shower with glass", "New vanity and fixtures"] } },
        { en: { jobName: "Bath Gut Remodel", summary: "s", bullets: GUT_JOB_ITEMS } },
        { en: { jobName: "Master Bath Rebuild", summary: "s", bullets: GUT_JOB_ITEMS.slice(0, 5) } },
      ],
    })),
  }));
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join(", "), langs: ["en"] });
  assertEquals(n, 1);
  assertEquals(res.options[0].bullets, GUT_JOB_ITEMS);
  assertWholeJob(res.options, ["gutted", "curbless", "slab", "frameless", "vanity", "hex", "faucets", "exhaust", "recessed", "permit"]);
});

Deno.test("REQ-400 (m32) bullets naming the customer, their contact or the job's duration never reach an option, in any language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          es: { jobName: "Corte de césped semanal", summary: "Corte de césped", bullets: ["Corte de césped semanal", "Duración de 4 semanas", "Servicio para Ana López"] },
          en: { jobName: "Weekly Lawn Mowing", summary: "Lawn mowing", bullets: ["Weekly lawn mowing", "4-week duration", "Service for Ana López"] },
        },
        {
          es: { jobName: "Servicio de jardinería", summary: "Jardinería", bullets: ["Servicio semanal de corte de césped", "Cliente: Ana López"] },
          en: { jobName: "Yard Service", summary: "Yard service", bullets: ["Weekly lawn mowing service", "Customer: Ana López"] },
        },
        {
          es: { jobName: "Mantenimiento de césped", summary: "Mantenimiento", bullets: ["Mantenimiento de césped para Ana López", "Llamar al 512-555-0199"] },
          en: { jobName: "Lawn Maintenance", summary: "Maintenance", bullets: ["Lawn maintenance for Ana López", "Call 512-555-0199"] },
        },
      ],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Corte de césped semanal para Ana López, 512-555-0199, 4 semanas, $400 en total",
    langs: ["es", "en"],
  });
  assertEquals(res.degraded, false);
  for (const b of allBullets(res.options)) {
    assert(!/Ana L[oó]pez/i.test(b), `a bullet names the customer: ${b}`);
    assert(!/^(?:cliente|customer)\b/i.test(b), `a customer label: ${b}`);
    assert(!/555-0199/.test(b), `a bullet carries her phone: ${b}`);
    assert(!/duraci[oó]n|duration|\b4 semanas\b|\b4-week\b/i.test(b), `a duration bullet: ${b}`);
  }
  assertEquals(res.options[0].byLang.es.bullets, ["Corte de césped semanal"]);
  assertEquals(res.options[0].byLang.en.bullets, ["Weekly lawn mowing"]);
  const third = res.options.find((o) => o.byLang.es.jobName === "Mantenimiento de césped");
  assertEquals(third?.byLang.es.bullets, ["Mantenimiento de césped"]);
});

Deno.test("REQ-400 (m32) the honest fallback never bullets the customer's name", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({
    userId: "u1",
    raw: "Corte de césped semanal para Ana López, 4 semanas, $400 en total",
    langs: ["es", "en"],
  });
  assertEquals(res.degraded, true);
  for (const b of allBullets(res.options)) {
    assert(!/Ana López/.test(b), `a fallback bullet names the customer: ${b}`);
  }
  assert(/corte de césped semanal/i.test(res.options[0].bullets[0]), res.options[0].bullets[0]);
});

Deno.test("REQ-400 (M21) neither the prompt nor the output structure shows a fixed three-bullet example; both say every option is the whole job", async () => {
  const { llm, coord } = fresh();
  let systemPrompt = "";
  let user = "";
  llm.setHandler((req) => {
    systemPrompt = req.systemPrompt ?? "";
    user = String(req.messages[0].content);
    throw new Error("only reading the prompt");
  });
  await coord.run({ userId: "u1", raw: PRIYA_RAW, langs: ["en", "es"] });
  for (const text of [systemPrompt, user]) {
    assert(!/"<scope line>",\s*"<scope line>",\s*"<scope line>"/.test(text), "a three-bullet example");
    assert(!/\["\.\.\.",\s*"\.\.\.",\s*"\.\.\."\]/.test(text), "a three-bullet example");
    assert(/every option/i.test(text), "does not say every option is the whole job");
  }
  assert(/whole job/i.test(systemPrompt));
  assert(/customer's name/i.test(systemPrompt), "no rule against the customer's name as a bullet");
});

// ── REQ-439 (demo-loop cycle 3, M9) ────────────────────────────────────────
// Pair 7's kitchen: every option dropped "22 lf", "48 sq ft", "35 sq ft",
// "3x6" and "5" LEDs, and the slab drain was missing from all three; pair 2's
// lawn job lost "4 cuartos de acre". REQ-400's check compared the options
// with EACH OTHER, so what all of them dropped was invisible. Now the typed
// text is the yardstick: a reply missing a typed quantity or item is asked
// again once with them listed, and a quantity still missing goes back into
// the line that names its item.

const KITCHEN_RAW =
  "Kitchen remodel for the Hendersons. Demo the old cabinets and haul away. " +
  "Install 22 lf of shaker cabinets (customer supplied). " +
  "48 sq ft quartz countertops with undermount sink cutout. 35 sq ft subway tile backsplash 3x6. " +
  "New drain line thru slab to island (trench + patch). " +
  "5 LED strips under the cabinets. About 3 weeks, $18,500.";
const KITCHEN_DROPPED = [
  "Demolish old cabinets and haul away debris",
  "Install customer-supplied shaker cabinets",
  "Quartz countertops with undermount sink cutout",
  "Subway tile backsplash",
  "LED strips under the cabinets",
];
const KITCHEN_KEPT = [
  "Demolish old cabinets and haul away debris",
  "Install 22 lf of customer-supplied shaker cabinets",
  "48 sq ft quartz countertops with undermount sink cutout",
  "35 sq ft subway tile backsplash, 3x6",
  "New drain line through the slab to the island (trench and patch)",
  "5 LED strips under the cabinets",
];
const kitchenReply = (bullets: string[]) =>
  JSON.stringify({
    options: [
      { en: { jobName: "Kitchen Remodel", summary: "Kitchen remodel", bullets } },
      { en: { jobName: "Kitchen Renovation", summary: "Kitchen renovation", bullets: [...bullets].reverse() } },
      { en: { jobName: "Kitchen Update", summary: "Kitchen update", bullets: [bullets.slice(0, 2).join("; "), ...bullets.slice(2)] } },
    ],
  });

function assertKeeps(options: Array<{ jobName: string; bullets: string[] }>, needles: RegExp[]) {
  for (const o of options) {
    const text = o.bullets.join(" | ");
    for (const n of needles) assert(n.test(text), `"${o.jobName}" lost ${n}: ${JSON.stringify(o.bullets)}`);
  }
}

Deno.test("REQ-439 (M9) options that drop the typed quantities and the slab drain are asked again once, naming them; the reply that keeps them is used", async () => {
  const { llm, coord } = fresh();
  const calls: string[][] = [];
  llm.setHandler((req) => {
    calls.push(req.messages.map((m) => String(m.content)));
    return { text: kitchenReply(calls.length === 1 ? KITCHEN_DROPPED : KITCHEN_KEPT) };
  });
  const res = await coord.run({ userId: "u1", raw: KITCHEN_RAW, langs: ["en"] });
  assertEquals(calls.length, 2, "re-asked exactly once");
  const reask = calls[1][2];
  for (const n of ["22 lf", "48 sq ft", "35 sq ft", "3x6", "slab"]) {
    assert(reask.includes(n), `the re-ask names "${n}": ${reask}`);
  }
  assertKeeps(res.options, [/\b22 lf\b/, /\b48 sq ft\b/, /\b35 sq ft\b/, /\b3x6\b/, /slab/i, /\b5 LED\b/]);
});

Deno.test("REQ-439 (M9) a model that drops the quantities twice: every option gets each one back in the line that names its item", async () => {
  const { llm, coord } = fresh();
  let n = 0;
  llm.setHandler(() => ({ text: (n++, kitchenReply(KITCHEN_DROPPED)) }));
  const res = await coord.run({ userId: "u1", raw: KITCHEN_RAW, langs: ["en"] });
  assertEquals(n, 2);
  assertKeeps(res.options, [/\b22 lf\b/, /\b48 sq ft\b/, /\b35 sq ft\b/, /\b3x6\b/, /\b5 LED\b/]);
  const first = res.options[0].bullets;
  assert(first.some((b) => /shaker cabinets/.test(b) && /22 lf/.test(b)), JSON.stringify(first));
  assert(first.some((b) => /^Quartz countertops/.test(b) && /48 sq ft/.test(b)), JSON.stringify(first));
  assertEquals(first.length, KITCHEN_DROPPED.length, "a quantity joins its line — no new line for it");
});

Deno.test("REQ-439 (M9) the lawn job keeps '4 cuartos de acre' in every option, in every language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          es: { jobName: "Corte de césped y limpieza", summary: "s", bullets: ["Corte de césped semanal", "Limpieza de hojas"] },
          en: { jobName: "Lawn Mowing & Cleanup", summary: "s", bullets: ["Weekly lawn mowing", "Leaf cleanup"] },
        },
        {
          es: { jobName: "Mantenimiento de jardín", summary: "s", bullets: ["Corte de césped semanal y limpieza de hojas"] },
          en: { jobName: "Yard Maintenance", summary: "s", bullets: ["Weekly mowing and leaf cleanup"] },
        },
      ],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Corte de césped semanal y limpieza de hojas para la casa de Ana Pérez, 4 cuartos de acre, $180",
    langs: ["es", "en"],
  });
  for (const o of res.options) {
    for (const [l, v] of Object.entries(o.byLang)) {
      assert(v.bullets.some((b) => /\b4 cuartos de acre\b/.test(b)), `${l} "${v.jobName}" lost the lot size: ${JSON.stringify(v.bullets)}`);
      assert(!v.bullets.some((b) => /\$?180/.test(b)), `the price became scope: ${JSON.stringify(v.bullets)}`);
    }
  }
});

Deno.test("REQ-439 (M9) a reply that keeps every typed quantity and item is not asked again", async () => {
  const { llm, coord } = fresh();
  let n = 0;
  llm.setHandler(() => ({ text: (n++, kitchenReply(KITCHEN_KEPT)) }));
  const res = await coord.run({ userId: "u1", raw: KITCHEN_RAW, langs: ["en"] });
  assertEquals(n, 1);
  assertEquals(res.options[0].bullets, KITCHEN_KEPT);
});

Deno.test("REQ-439 (M9) on a step correction only the contractor's words are the yardstick — the request's framing is never a missing item", async () => {
  const { llm, coord } = fresh();
  let n = 0;
  llm.setHandler(() => ({ text: (n++, kitchenReply(KITCHEN_KEPT)) }));
  const framed = `${KITCHEN_RAW}\n\nThe version of the job details the contractor is looking at:\n${
    KITCHEN_DROPPED.join("\n")
  }\n\nThe contractor's correction (it overrides the above where they disagree): add the slab drain`;
  await coord.run({ userId: "u1", raw: framed, typed: `${KITCHEN_RAW}\nadd the slab drain`, langs: ["en"] });
  assertEquals(n, 1);
});

Deno.test("REQ-439 (M9) the prompt keeps every typed number, measurement and quantity verbatim and lifts the word cap for those lines", () => {
  for (const lang of ["en", "es"] as const) {
    const p = t(lang, "prompts.generateJobOptions");
    assert(/every number, measurement and quantity the contractor typed/i.test(p), `${lang}: no keep-the-numbers rule`);
    assert(/verbatim/i.test(p), `${lang}: not verbatim`);
    assert(/22 lf/.test(p) && /4 cuartos de acre/.test(p), `${lang}: no examples`);
    assert(/no word limit/i.test(p), `${lang}: the 3–7 word cap still binds a quantity line`);
  }
});

// ── REQ-446 (demo-loop cycle 3, m13): three versions, three roles ─────────
// "three near-identical options" — the prompt asked for versions that
// "differ only in wording and grouping". They are now concise / standard /
// detailed, and each option carries the role it plays so the card says so.

Deno.test("REQ-446 (m13) the prompt and the output structure ask for concise / standard / detailed — never wording-only twins", async () => {
  const { llm, coord } = fresh();
  let systemPrompt = "";
  let user = "";
  llm.setHandler((req) => {
    systemPrompt = req.systemPrompt ?? "";
    user = String(req.messages[0].content);
    throw new Error("only reading the prompt");
  });
  await coord.run({ userId: "u1", raw: PRIYA_RAW, langs: ["en", "es"] });
  for (const text of [systemPrompt, user]) {
    assert(!/differ only in wording and grouping/i.test(text), "wording-only versions");
    assert(/CONCISE/.test(text) && /STANDARD/.test(text) && /DETAILED/.test(text), "no roles named");
  }
});

Deno.test("REQ-446 (m13) every model option carries its role, by detail, in the model's order", async () => {
  const { llm, coord } = fresh();
  const opt = (jobName: string, bullets: string[]) => ({
    en: { jobName, summary: jobName, bullets },
  });
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        opt("Kitchen Remodel", [
          "Kitchen demolition and haul away",
          "New cabinets and quartz countertops",
        ]),
        opt("Kitchen Renovation", [
          "Kitchen demolition",
          "Haul away debris",
          "Install new cabinets",
          "Quartz countertops",
        ]),
        opt("Complete Kitchen Renovation", [
          "Full kitchen demolition to the studs",
          "Haul away all demolition debris",
          "Install 22 lf of new cabinets",
          "48 sqft quartz countertops",
        ]),
      ],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Kitchen demo, haul away, 22 lf cabinets, 48 sqft quartz",
    langs: ["en"],
  });
  assertEquals(res.degraded, false);
  assertEquals(res.options.map((o) => o.id), ["opt1", "opt2", "opt3"]);
  assertEquals(res.options.map((o) => o.style), ["concise", "standard", "detailed"]);
});

// ── REQ-434 (demo-loop cycle 3: M10) ───────────────────────────────────────
// fleet-6: the picker stored jobNameByLang.es = "Renovación de cocina y" — the
// model's 31-character "Renovación de cocina y limpieza" was cut at the
// 30-character budget right after its connector.
Deno.test("REQ-434 M10 a model jobName over the budget is never cut after a connector, in either language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        byLang: {
          en: {
            jobName: "Bathroom Renovation and Cleanup",
            summary: "Renovate the bathroom and clean up",
            bullets: ["Demo the old vanity", "Install the new vanity", "Jobsite cleanup"],
          },
          es: {
            jobName: "Renovación de cocina y limpieza",
            summary: "Renovar la cocina y limpiar",
            bullets: ["Quitar la vanidad vieja", "Instalar la vanidad nueva", "Limpieza"],
          },
        },
      }],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "renovate the kitchen and clean up after",
    langs: ["en", "es"],
  });
  assertEquals(res.options[0].byLang.en.jobName, "Bathroom Renovation");
  assertEquals(res.options[0].byLang.es.jobName, "Renovación de cocina");
});

// ── REQ-584 (demo-loop cycle 4, p4-p1d) ────────────────────────────────────
// "Job Details options differ only by a word": pair 1's one-scope paint job
// showed Concise / Standard / Detailed cards that read the same. Exact-match
// dedupe let one-word twins through, and padToThree padded with variants
// that are the same words regrouped or + "Jobsite cleanup".

const PAINT_RAW =
  "Interior paint for Linda Perez, 3 bedrooms, walls only, two coats, materials included, $2850";

Deno.test("REQ-584 (cycle 4, p4-p1d) three model options that differ by a word collapse to one card", async () => {
  const { llm, coord } = fresh();
  const opt = (jobName: string, bullets: string[]) => ({
    en: { jobName, summary: jobName, bullets },
  });
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        opt("Interior Painting 3 Bedrooms", [
          "Paint walls in 3 bedrooms, two coats",
          "Materials included",
        ]),
        opt("3-Bedroom Interior Paint", [
          "Paint the walls in 3 bedrooms, two coats",
          "Materials included",
        ]),
        opt("Bedroom Wall Painting", [
          "Paint walls in 3 bedrooms, two full coats",
          "Materials included",
        ]),
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: PAINT_RAW, langs: ["en"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 1, JSON.stringify(res.options.map((o) => o.bullets)));
  assertEquals(res.options[0].jobName, "Interior Painting 3 Bedrooms");
  assertEquals(res.options[0].id, "opt1");
});

Deno.test("REQ-584 (cycle 4, p4-p1d) a one-item job is not padded with near-twin versions", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        en: {
          jobName: "Bedroom Painting",
          summary: "Paint three bedrooms",
          bullets: ["Paint walls in 3 bedrooms, two coats, materials included"],
        },
      }],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: PAINT_RAW, langs: ["en"] });
  assertEquals(res.options.length, 1, JSON.stringify(res.options.map((o) => o.bullets)));
});

Deno.test("REQ-584 (cycle 4, p4-p1d) padding never adds a version that is a near-twin of one already offered", async () => {
  const { llm, coord } = fresh();
  const lines = [
    "Prep walls: patch nail holes and sand",
    "Prime patched spots",
    "Paint walls in 3 bedrooms, two coats",
    "Cut in along ceilings and trim",
    "Eggshell finish on every wall",
  ];
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{ en: { jobName: "Bedroom Painting", summary: "Paint three bedrooms", bullets: lines } }],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: PAINT_RAW, langs: ["en"] });
  for (let i = 0; i < res.options.length; i++) {
    for (let j = i + 1; j < res.options.length; j++) {
      assert(
        !nearTwinBullets(res.options[i].bullets, res.options[j].bullets),
        `near-twins: ${JSON.stringify([res.options[i].bullets, res.options[j].bullets])}`,
      );
    }
  }
  assertEquals(res.options[0].bullets, lines);
});

// REQ-722 AMENDMENT (cycle 5, p18-3b): two titled versions — the third,
// "· Wider scope" + "Jobsite cleanup", invented scope and is gone.
Deno.test("REQ-584 (cycle 4, p4-p1d) the degraded fallback keeps its titled versions (exact-twin dedupe only)", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: GUT_JOB_ITEMS.join("\n"), langs: ["en"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options.length, 2);
  assertEquals(res.options[0].bullets, GUT_JOB_ITEMS);
});

// ── REQ-653 (demo-loop cycle 5, M7 + m50) ──────────────────────────────────
// Pair 7 typed "… LVP no wait porcelain tile 12x24 … — client wants done
// before thanksgiving": every option read "Install LVP and porcelain tile",
// and the rewrite added "Finish before Thanksgiving" as a scope bullet
// (fleet-6 stdout:295/298).

const DEMO_653 =
  "gut master bath 8x10, tub out walk-in shower w/ niche, double vanity quartz, LVP no wait porcelain tile 12x24, move toilet 2ft, exhaust fan, plus kitchen backsplash 30sqft subway — client wants done before thanksgiving";

Deno.test("REQ-653 M7: the model never sees the corrected-away 'LVP' — the raw text and the typed yardstick keep only the correction", async () => {
  const { llm, coord } = fresh();
  const seen: string[] = [];
  llm.setHandler((req) => {
    seen.push(req.messages.map((m) => m.content).join("\n"));
    const bullets = [
      "Gut master bath 8x10",
      "Remove tub, install walk-in shower with niche",
      "Install double vanity with quartz top",
      "Install porcelain tile 12x24 on floor",
      "Move toilet 2ft",
      "Install exhaust fan",
      "Install kitchen backsplash 30sqft subway tile",
    ];
    return {
      text: JSON.stringify({
        options: [0, 1, 2].map((i) => ({
          en: {
            jobName: ["Bath & Backsplash", "Master Bath & Kitchen", "Bath Gut & Backsplash"][i],
            summary: "Master bath gut and backsplash",
            bullets: i === 0 ? bullets.slice(0, 7) : bullets,
          },
        })),
      }),
    };
  });
  const res = await coord.run({ userId: "u1", raw: DEMO_653, langs: ["en"] });
  assert(seen.length >= 1);
  for (const sent of seen) {
    assert(!/LVP/.test(sent), `the model was sent the corrected-away LVP: ${sent.slice(0, 300)}`);
    assert(!/no wait/i.test(sent), "the correction cue reached the model");
  }
  // no re-ask demanding LVP back (the typed yardstick is corrected too)
  for (const b of allBullets(res.options)) {
    assert(!/LVP/.test(b), `bullet keeps LVP: ${b}`);
  }
});

Deno.test("REQ-653 m50: a model deadline bullet ('Finish before Thanksgiving') never reaches the options", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [0, 1, 2].map((i) => ({
        en: {
          jobName: ["Backsplash", "Kitchen Backsplash", "Subway Backsplash"][i],
          summary: "Kitchen backsplash",
          bullets: [
            "Install kitchen backsplash 30sqft subway tile",
            "Finish before Thanksgiving",
          ],
        },
      })),
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "kitchen backsplash 30sqft subway — client wants done before thanksgiving",
    langs: ["en"],
  });
  for (const b of allBullets(res.options)) {
    assert(!/thanksgiving/i.test(b), `deadline bullet kept: ${b}`);
  }
});

// REQ-659 (demo-loop cycle 5, M14): a markup or a labor rate is private
// pricing too — fleet-6 saw "Materials at cost +15%" in both options. Neither
// names a "$" amount, so REQ-261's filter let them through.
Deno.test("REQ-659 M14 a model bullet carrying a markup or a labor rate is dropped in every language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        en: {
          jobName: "Backsplash Tile",
          summary: "Kitchen backsplash tile",
          bullets: [
            "Kitchen backsplash tile",
            "Materials at cost +15%",
            "Labor 85/hr",
            "Grout and seal",
          ],
        },
        es: {
          jobName: "Azulejo de cocina",
          summary: "Azulejo de la cocina",
          bullets: [
            "Azulejo de la cocina",
            "Materiales al costo más 15%",
            "Mano de obra 85 por hora",
            "Lechada y sellado",
          ],
        },
      }],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Kitchen backsplash tile, grout and seal. Materials at cost +15%, labor 85/hr",
    langs: ["en", "es"],
  });
  assertEquals(res.options[0].byLang.en.bullets, [
    "Kitchen backsplash tile",
    "Grout and seal",
  ]);
  assertEquals(res.options[0].byLang.es.bullets, [
    "Azulejo de la cocina",
    "Lechada y sellado",
  ]);
});

// ── REQ-667 (demo-loop cycle 5, m49) ───────────────────────────────────────
// fleet-6: the customer's agreement carried the line "Alcance de trabajo
// conciso $18,750.00" and the /quotes drawer "Concise scope of work" — the
// concise option's summary named its internal role, and the picked summary
// became the quote's line description.

Deno.test("REQ-667 (m49) the prompt forbids the option roles in jobName and summary", async () => {
  const { llm, coord } = fresh();
  let user = "";
  llm.setHandler((req) => {
    user = String(req.messages[0].content);
    throw new Error("only reading the prompt");
  });
  await coord.run({ userId: "u1", raw: PRIYA_RAW, langs: ["en", "es"] });
  assert(
    /jobName and summary never (?:name|contain)[^.]*role/i.test(user),
    "the prompt does not forbid role words in jobName/summary",
  );
});

Deno.test("REQ-667 (m49) a summary or jobName that names the option's role is replaced, in every language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          en: {
            jobName: "Kitchen Remodel",
            summary: "Concise scope of work",
            bullets: ["Kitchen demolition and haul away", "New cabinets and quartz countertops"],
          },
          es: {
            jobName: "Remodelación de cocina",
            summary: "Alcance de trabajo conciso",
            bullets: ["Demolición de cocina y retiro", "Gabinetes nuevos y encimeras de cuarzo"],
          },
        },
        {
          en: {
            jobName: "Standard Scope",
            summary: "Standard scope of work",
            bullets: ["Kitchen demolition", "Haul away debris", "Install new cabinets", "Quartz countertops"],
          },
          es: {
            jobName: "Alcance estándar",
            summary: "Alcance de trabajo estándar",
            bullets: ["Demolición de cocina", "Retiro de escombros", "Instalar gabinetes nuevos", "Encimeras de cuarzo"],
          },
        },
        {
          en: {
            jobName: "Complete Kitchen Renovation",
            summary: "Detailed scope of work",
            bullets: [
              "Full kitchen demolition to the studs",
              "Haul away all demolition debris",
              "Install 22 lf of new cabinets",
              "48 sqft quartz countertops",
            ],
          },
          es: {
            jobName: "Renovación completa de cocina",
            summary: "Alcance de trabajo detallado",
            bullets: [
              "Demolición completa de la cocina",
              "Retiro de todos los escombros",
              "Instalar 22 lf de gabinetes nuevos",
              "48 sqft de encimeras de cuarzo",
            ],
          },
        },
      ],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Kitchen demo, haul away, 22 lf cabinets, 48 sqft quartz",
    langs: ["en", "es"],
  });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 3);
  const role = /concis|standard|est[aá]ndar|detailed|detallad|scope of work|alcance de trabajo/i;
  for (const o of res.options) {
    for (const text of [o.jobName, o.summary, ...Object.values(o.byLang).flatMap((l) => [l.jobName, l.summary])]) {
      assert(!role.test(text), `role word reaches the client: ${text}`);
    }
  }
  // The summary falls back to the option's own jobName.
  assertEquals(res.options[0].summary, "Kitchen Remodel");
  assertEquals(res.options[0].byLang.es.summary, "Remodelación de cocina");
  assertEquals(res.options[2].byLang.es.summary, "Renovación completa de cocina");
});

// ── REQ-722 (demo-loop cycle 5, p18-3b) ─────────────────────────────────────
// "'Jobsite cleanup' for a house clean": padToThree (and the heuristic
// fallback) built a "· Wider scope" version by appending a fixed,
// trade-agnostic "Jobsite cleanup" line — scope the contractor never stated,
// which the prompt itself forbids, and construction wording for a cleaner.
// Padding now only regroups what the contractor said; short of distinct
// regroupings, the picker shows fewer cards.

// Short lines, as in the demo: "+ Jobsite cleanup" is then far from a
// near-twin (REQ-584) and used to survive as a third card.
const CLEAN_EN = ["Deep clean kitchen", "Clean bathrooms", "Mop floors"];
const CLEAN_ES = ["Limpieza profunda de cocina", "Limpiar baños", "Trapear pisos"];

function words(lines: string[]): Set<string> {
  return new Set(
    lines.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

function assertNoInventedScope(
  options: Array<{ byLang: Record<string, { bullets: string[] }> }>,
  typed: Record<string, string[]>,
) {
  for (const [lang, lines] of Object.entries(typed)) {
    const allowed = words(lines);
    for (const o of options) {
      const bullets = o.byLang[lang].bullets;
      for (const b of bullets) {
        assert(
          b.toLowerCase() !== "jobsite cleanup" &&
            b.toLowerCase() !== "limpieza del sitio de trabajo",
          `${lang}: padded version adds "${b}"`,
        );
      }
      for (const w of words(bullets)) {
        assert(allowed.has(w), `${lang}: "${w}" is scope the contractor never stated: ${JSON.stringify(bullets)}`);
      }
    }
  }
}

Deno.test("REQ-722 (cycle 5, p18-3b) a house clean padded from one model option never gets 'Jobsite cleanup', in en or es", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [{
        en: { jobName: "House Deep Clean", summary: "Deep clean the whole house", bullets: CLEAN_EN },
        es: { jobName: "Limpieza Profunda", summary: "Limpieza profunda de la casa", bullets: CLEAN_ES },
      }],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: "Deep clean for the Garcia house: kitchen, bathrooms, floors",
    langs: ["en", "es"],
  });
  assertEquals(res.degraded, false);
  assert(res.options.length >= 1 && res.options.length <= 3);
  assertEquals(res.options[0].byLang.en.bullets, CLEAN_EN);
  assertNoInventedScope(res.options, { en: CLEAN_EN, es: CLEAN_ES });
});

Deno.test("REQ-722 (cycle 5, p18-3b) the heuristic fallback for a house clean never adds 'Jobsite cleanup', in en or es", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const res = await coord.run({ userId: "u1", raw: CLEAN_EN.join("\n"), langs: ["en", "es"] });
  assertEquals(res.degraded, true);
  assertEquals(res.options[0].bullets, CLEAN_EN);
  assertNoInventedScope(res.options, {
    en: res.options[0].byLang.en.bullets,
    es: res.options[0].byLang.es.bullets,
  });
});
