/**
 * REQ-400 (demo-loop cycle 2: M5, M21, m32) — Raphael: "fix every issue the
 * demo found, loop until there are none."
 *
 * M5  — the quote mixed languages: the job name was never translated
 *       (TranslateQuote filled the description and the lines, never
 *       jobNameByLang / summaryByLang), and "Edit job details" seeded the
 *       picker with the PREVIEW-language rows, which applyJobOption then
 *       stored as the app-language text (English preview: 3 Spanish bullets,
 *       then 3 English ones).
 * M21 — each job-description "version" held a third of the job: the prompt's
 *       fixed three-bullet example + "never two options with the same
 *       bullets" made the model split a gut job across the options, and
 *       nothing on the server checked coverage. "Edit job details"
 *       regenerated from the current three bullets alone.
 * m32 — "Servicio para Ana López" / "Cliente: Ana López" were scope bullets
 *       on the sent quote.
 *
 * These pin the shared, pure half: what a bullet may be, when an option is
 * the whole job, what the edit pencil seeds, and which job names still need
 * a translation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanScopeBullet,
  customerFactsFrom,
  distinctScopeItems,
  groupedBullets,
  missedScopeItems,
  partitionByCoverage,
} from "../../shared/quote-flow/option-bullets";
import { editJobDetailsSeed } from "../../shared/quote-flow/edit-job-details";
import { reviewJobDetails } from "../../shared/quote-flow/review-job-details";
import {
  headingTranslationsStale,
  missingHeadingTranslations,
} from "../../shared/quote-flow/quote-translations";
import { translatedJobNameCase } from "../../shared/quote-flow/job-name";
import {
  emptyAssistantDraft,
  parseAssistantDraft,
} from "../../shared/quote-flow/assistant-draft";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const prompt = (file: string) =>
  JSON.parse(read(file))["prompts.generateJobOptions"] as string;

// ── m32: a bullet is scope of work, never the customer ────────────────────
describe("REQ-400 (m32) a job-option bullet is scope, never the customer, their contact or the duration", () => {
  const RAW =
    "Corte de césped semanal para Ana López, 4 semanas, $400 en total";
  const facts = customerFactsFrom(RAW);

  it("REQ-400 the customer named in the typed message is known to the filter", () => {
    expect(facts.name).toBe("Ana López");
    const withContact = customerFactsFrom(
      "Bath remodel for Maria Gutierrez 512-555-0188 maria.g@example.com",
    );
    expect(withContact.name).toBe("Maria Gutierrez");
    expect(withContact.phone).toBe("512-555-0188");
    expect(withContact.email).toBe("maria.g@example.com");
  });

  it("REQ-400 the demo's customer bullets are dropped (pair 2: 'Servicio para Ana López', 'Cliente: Ana López')", () => {
    for (
      const b of [
        "Servicio para Ana López",
        "Cliente: Ana López",
        "Customer: Ana López",
        "Service for Ana López",
        "Ana López",
        "Para Ana Lopez",
        "Trabajo para la señora Ana López",
      ]
    ) {
      expect([b, cleanScopeBullet(b, facts)]).toEqual([b, null]);
    }
  });

  it("REQ-400 a 'Service for <Name>' label is dropped even when the message named no one", () => {
    expect(cleanScopeBullet("Servicio para Ana", {})).toBeNull();
    expect(cleanScopeBullet("Service for Dave Roof", {})).toBeNull();
    expect(cleanScopeBullet("Cliente: Dave", {})).toBeNull();
  });

  it("REQ-400 a bullet carrying a phone number or an e-mail is contact, not scope", () => {
    expect(cleanScopeBullet("Llamar al 512-555-0199 antes de llegar", facts))
      .toBeNull();
    expect(cleanScopeBullet("Email: ana@example.com", facts)).toBeNull();
    expect(cleanScopeBullet("(512) 555-0199", {})).toBeNull();
  });

  it("REQ-400 a duration-only bullet is dropped — the wizard asks for the duration", () => {
    for (
      const b of [
        "Duración de 4 semanas",
        "4 semanas",
        "4 weeks",
        "Duration: 3 days",
        "2–3 días",
        "Approximately 2 weeks",
        "4-week duration",
      ]
    ) {
      expect([b, cleanScopeBullet(b, facts)]).toEqual([b, null]);
    }
  });

  it("REQ-400 real scope survives untouched", () => {
    for (
      const b of [
        "Corte de césped semanal",
        "Weekly lawn mowing",
        "Install 4 recessed lights",
        "Paint 3 bedrooms and the hallway",
        "Replace 10 squares of shingles",
        "Weekly visits for 4 weeks",
        "Service the AC unit",
        // REQ-330's fourteen-item gut job: a hyphenated word is not a label
        "Customer-supplied vanity",
        "Owner-supplied tile",
        // an acronym after "for" is not a name
        "Service for HVAC",
      ]
    ) {
      expect(cleanScopeBullet(b, facts)).toBe(b);
    }
  });

  it("REQ-400 a scope line that also names the customer keeps the scope and loses the name", () => {
    expect(cleanScopeBullet("Weekly lawn mowing for Ana López", facts)).toBe(
      "Weekly lawn mowing",
    );
    expect(cleanScopeBullet("Corte de césped semanal para Ana Lopez", facts))
      .toBe("Corte de césped semanal");
  });
});

// ── M21: every version is the WHOLE job ──────────────────────────────────
// Pair 7 (Priya, 09:08:44): "the 3 versions each hold only 1/3 of the scope:
// v1 (tub out, curbless shower, tile), v2 (drain+niche, glass, vanity),
// v3 (drain move, fan+lights, heated floor)".
const V1 = [
  "Remove old tub/shower combo",
  "Install walk-in shower with curbless entry",
  "Porcelain tile 12x24 on walls",
];
const V2 = ["Linear drain and niche", "Frameless glass panel", "Double vanity"];
const V3 = [
  "Move drain on slab",
  "Exhaust fan and recessed lights",
  "Heated floor",
];

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

describe("REQ-400 (M21) a job option is a version of the whole job, never a part of it", () => {
  it("REQ-400 the demo's three thirds: no option is the whole job", () => {
    const options = [
      { id: "opt1", bullets: V1 },
      { id: "opt2", bullets: V2 },
      { id: "opt3", bullets: V3 },
    ];
    const { complete, partial, items } = partitionByCoverage(options);
    expect(complete).toEqual([]);
    expect(partial.map((o) => o.id)).toEqual(["opt1", "opt2", "opt3"]);
    // The job is every distinct item across the three — each exactly once.
    expect(items).toEqual([...V1, ...V2, ...V3]);
    expect(missedScopeItems(V1, items).length).toBeGreaterThan(3);
  });

  it("REQ-400 one complete option among partial ones: only the complete one is a version of the job", () => {
    const options = [
      {
        id: "concise",
        bullets: [
          "Gut and rebuild the bathroom",
          "Curbless shower with glass",
          "New vanity and fixtures",
        ],
      },
      { id: "detailed", bullets: GUT_JOB_ITEMS },
      { id: "half", bullets: GUT_JOB_ITEMS.slice(0, 5) },
    ];
    const { complete, partial } = partitionByCoverage(options);
    expect(complete.map((o) => o.id)).toEqual(["detailed"]);
    expect(partial.map((o) => o.id)).toEqual(["concise", "half"]);
  });

  it("REQ-400 honest versions — concise grouping, standard, detailed — are all the whole job", () => {
    const options = [
      {
        id: "concise",
        bullets: [
          "Gut fixtures and tile; slab cut for a linear drain",
          "Curbless shower, frameless glass, hex mosaic floor",
          "72 inch double vanity with two widespread faucets",
          "Exhaust fan, recessed lights and the permit",
        ],
      },
      {
        id: "standard",
        bullets: [
          "Gutted old fixtures and tile",
          "Curbless shower on a slab-cut linear drain",
          "Frameless glass enclosure and hex mosaic floor",
          "72 inch double vanity, two widespread faucets",
          "Exhaust fan and recessed lights",
          "Pull the permit",
        ],
      },
      { id: "detailed", bullets: GUT_JOB_ITEMS },
    ];
    const { complete, partial } = partitionByCoverage(options);
    expect(partial).toEqual([]);
    expect(complete.map((o) => o.id)).toEqual([
      "concise",
      "standard",
      "detailed",
    ]);
  });

  it("REQ-400 a one-item job's rewordings are all the whole job", () => {
    const { complete } = partitionByCoverage([
      { id: "a", bullets: ["Weekly lawn mowing"] },
      { id: "b", bullets: ["Lawn mowing, every week"] },
      { id: "c", bullets: ["Mow the lawn weekly"] },
    ]);
    expect(complete.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("REQ-400 the job's items are named once: a reworded repeat adds nothing", () => {
    expect(
      distinctScopeItems([
        "Remove old tub/shower combo",
        "Tub and shower combo removal",
        "Heated floor",
        "Install a heated floor",
      ]),
    ).toEqual(["Remove old tub/shower combo", "Heated floor"]);
  });

  it("REQ-400 the 'short version' keeps every item — fewer lines, nothing dropped", () => {
    const short = groupedBullets(GUT_JOB_ITEMS);
    expect(short.length).toBe(5);
    for (const item of GUT_JOB_ITEMS) {
      expect(short.join(" | ").toLowerCase()).toContain(item.toLowerCase());
    }
    expect(groupedBullets(["Replace a toilet"])).toEqual(["Replace a toilet"]);
    expect(groupedBullets(["A", "B", "C"]).length).toBe(2);
  });

  it("REQ-400 no padding or fallback variant slices the job: the island and the coordinator group instead", () => {
    const island = read("front-end/islands/AsstChat.tsx");
    const start = island.indexOf("function localFallbackOptions(");
    const body = island.slice(start, island.indexOf("\n}\n", start));
    expect(body).not.toMatch(/base\.slice\(0,\s*3\)/);
    expect(body).toMatch(/groupedBullets\(/);
    const coord = read(
      "backend/src/agents/domain/coordinators/generate-job-options/mod.ts",
    );
    expect(coord).not.toMatch(/base\.slice\(0,\s*3\)/);
    expect(coord).not.toMatch(/bullets\.slice\(0,\s*Math\.max\(1,/);
    expect(coord).toMatch(/groupedBullets\(/);
  });

  it("REQ-400 the prompt, in both dictionaries, shows no fixed three-bullet example and says every option covers every item", () => {
    for (const f of ["lang/en.json", "lang/es.json"]) {
      const p = prompt(f);
      expect(p).not.toMatch(
        /"<scope line>",\s*"<scope line>",\s*"<scope line>"/,
      );
      expect(p).toMatch(/every option/i);
      expect(p).toMatch(/whole job/i);
      // REQ-446 (cycle 3, m13) superseded "differ only in wording and
      // grouping" (three near-identical cards) with concise / standard /
      // detailed — still never a difference in which items are covered.
      expect(p).toMatch(/never in which items they include/i);
      // m32: never the customer, their contact or the duration as a bullet
      expect(p).toMatch(/customer's name/i);
      expect(p).toMatch(/duration/i);
      // REQ-330's rules stay
      expect(p).toMatch(/same bullets/i);
      expect(p).toMatch(/more than 12/i);
    }
    const coord = read(
      "backend/src/agents/domain/coordinators/generate-job-options/mod.ts",
    );
    expect(coord).not.toMatch(/"bullets": \["\.\.\.", "\.\.\.", "\.\.\."\]/);
  });
});

// ── M5: Edit job details seeds the base language and the typed message ───
const EN_LINES = [
  "Remove old tub/shower combo",
  "Install curbless walk-in shower",
  "Porcelain tile 12x24 on walls",
];
const ES_LINES = [
  "Retirar la bañera/ducha antigua",
  "Instalar ducha a nivel del suelo",
  "Azulejos de porcelana 12x24 en paredes",
];
const TYPED =
  "Master bath gut for Maria Gutierrez: remove tub/shower combo, curbless walk-in shower " +
  "w/ linear drain + niche, 12x24 porcelain on walls, frameless glass, 60in double vanity, " +
  "move drain on slab, fan + 4 recessed lights, heated floor, permit, toilet reset.";

describe("REQ-400 (M5 + M21) 'Edit job details' starts from the base-language lines and the typed message", () => {
  const quote = {
    description: EN_LINES.join("\n"),
    descriptionByLang: {
      en: EN_LINES.join("\n"),
      es: ES_LINES.join("\n"),
    },
  };

  it("REQ-400 preview in Spanish → edit → add an English line: the English description has no Spanish line", () => {
    // What the card SHOWS with the toggle on Español (the demo's seed).
    const shown = reviewJobDetails({
      previewLang: "es",
      descriptionByLang: quote.descriptionByLang,
      description: quote.description,
    }).map((r) => r.text);
    expect(shown).toEqual(ES_LINES);

    // What the pencil seeds: the quote's own (base-language) lines.
    const seed = editJobDetailsSeed({
      description: quote.description,
      originalRaw: TYPED,
    });
    expect(seed.lines).toEqual(EN_LINES);

    // applyJobOption stores the picked card's live lines as the app-language
    // description — the seeded lines plus the one the contractor added.
    const description = [...seed.lines, "Heated floor"].join("\n");
    for (const line of description.split("\n")) {
      expect(ES_LINES).not.toContain(line);
    }
  });

  it("REQ-400 the regeneration reads the typed message AND the current lines, never the lines alone", () => {
    const seed = editJobDetailsSeed({
      description: quote.description,
      originalRaw: TYPED,
    });
    expect(seed.raw).toContain(TYPED);
    for (const l of EN_LINES) expect(seed.raw).toContain(l);
  });

  it("REQ-400 with no typed message on file the current lines are the regeneration input (as before)", () => {
    const seed = editJobDetailsSeed({ description: quote.description });
    expect(seed.raw).toBe(EN_LINES.join("\n"));
  });

  it("REQ-400 a chat-drafted quote (no description) seeds its line items' own text", () => {
    const seed = editJobDetailsSeed({
      description: undefined,
      lineItems: [{ description: "Reparación de puerta de baño" }],
    });
    expect(seed.lines).toEqual(["Reparación de puerta de baño"]);
  });

  it("REQ-400 with nothing at all the summary is the regeneration input", () => {
    const seed = editJobDetailsSeed({ fallback: "Deck repair" });
    expect(seed.lines).toEqual([]);
    expect(seed.raw).toBe("Deck repair");
  });

  it("REQ-400 the island's pencil seeds from editJobDetailsSeed with the quote's own description, not the preview rows", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("const editJobDetails = () => {");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("};", start));
    expect(body).toMatch(/editJobDetailsSeed\(/);
    expect(body).toMatch(/quote\?\.description/);
    expect(body).toMatch(/originalRaw/);
    expect(body).not.toMatch(/jobPolishRawRef\.current = lines/);
    // REQ-330 stays: the current details are the seeded first card.
    expect(body).toMatch(/openJobPicker\(\s*\{/);
  });

  it("REQ-400 the typed message rides the flow draft (it outlives the page load into the wizard)", () => {
    expect(emptyAssistantDraft().originalRaw).toBeNull();
    const d = parseAssistantDraft({
      ...emptyAssistantDraft(),
      originalRaw: TYPED,
      jobDetailsRaw: EN_LINES.join("\n"),
    });
    expect(d?.originalRaw).toBe(TYPED);
    expect(parseAssistantDraft({ originalRaw: 42 })?.originalRaw).toBeNull();
    const src = read("front-end/islands/AsstChat.tsx");
    // set where the contractor submits what they typed, never overwritten
    // by the confirm step; carried by the draft the server stores.
    const submit = src.slice(src.indexOf("function submitJobDetails("));
    expect(submit.slice(0, submit.indexOf("\n  }\n"))).toMatch(
      /setOriginalRaw\(trimmed\)/,
    );
    const draft = src.slice(src.indexOf("function currentDraft()"));
    expect(draft.slice(0, draft.indexOf("\n  }\n"))).toMatch(/originalRaw/);
  });
});

// ── M5: the job name and summary are translated like the description ─────
describe("REQ-400 (M5) the job name and summary need a translation in every document language", () => {
  const spanishChatQuote = {
    jobName: "Reparación de puerta",
    summary: "Reparación de puerta de baño — Maria Lopez",
  };

  it("REQ-400 a Spanish quote's name and summary are missing in English; the base language is never missing", () => {
    expect(missingHeadingTranslations(spanishChatQuote, ["en", "es"], "es"))
      .toEqual([{
        lang: "en",
        jobName: "Reparación de puerta",
        summary: "Reparación de puerta de baño — Maria Lopez",
      }]);
    // The base slot is filled verbatim by TranslateQuote — asked with "" it
    // shows as missing like any other.
    expect(missingHeadingTranslations(spanishChatQuote, ["es"], "")).toEqual([
      {
        lang: "es",
        jobName: "Reparación de puerta",
        summary: "Reparación de puerta de baño — Maria Lopez",
      },
    ]);
  });

  it("REQ-400 a filled language needs nothing; an English-only pick still needs Spanish (pair 4)", () => {
    expect(
      missingHeadingTranslations(
        {
          ...spanishChatQuote,
          jobNameByLang: { en: "Door Repair", es: "Reparación de puerta" },
          summaryByLang: { en: "Bathroom door repair", es: "Reparación" },
        },
        ["en", "es"],
        "es",
      ),
    ).toEqual([]);
    expect(
      missingHeadingTranslations(
        {
          jobName: "Roof Replacement",
          jobNameByLang: { en: "Roof Replacement" },
        },
        ["en", "es"],
        "en",
      ),
    ).toEqual([{ lang: "es", jobName: "Roof Replacement" }]);
  });

  it("REQ-400 a renamed job's per-language names are stale unless the rename writes new ones", () => {
    const prev = {
      jobName: "Roof Replacement",
      jobNameByLang: { en: "Roof Replacement", es: "Reemplazo de techo" },
      summary: "Replace the roof",
      summaryByLang: { en: "Replace the roof", es: "Reemplazar el techo" },
    };
    expect(headingTranslationsStale(prev, { jobName: "Deck Repair" })).toEqual(
      { jobName: true, summary: false },
    );
    expect(
      headingTranslationsStale(prev, {
        jobName: "Deck Repair",
        jobNameByLang: { en: "Deck Repair" },
      }),
    ).toEqual({ jobName: false, summary: false });
    expect(
      headingTranslationsStale(prev, {
        jobName: "Roof Replacement",
        summary: "Replace the whole roof",
      }),
    ).toEqual({ jobName: false, summary: true });
  });

  it("REQ-400 a translated job name is cased for its language: Spanish sentence case, English Title Case", () => {
    expect(translatedJobNameCase("Reemplazo De Techo", "es")).toBe(
      "Reemplazo de techo",
    );
    expect(translatedJobNameCase("door repair", "en")).toBe("Door Repair");
    expect(translatedJobNameCase("repair of the bathroom door", "en")).toBe(
      "Repair of the Bathroom Door",
    );
    expect(translatedJobNameCase("  Roof   Replacement ", "en")).toBe(
      "Roof Replacement",
    );
  });
});
