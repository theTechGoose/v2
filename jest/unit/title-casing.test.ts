/**
 * REQ-394 — "fix every issue the demo found, loop until there are none"
 * (demo-loop cycle 2, issue p9): titles in Title Case or the wrong language.
 *
 * RCA (demo-report r561db6d4, analyst + skeptic UPHELD at deb85b35):
 *   - priceProblemItem returned the raw line description, leading capital
 *     and all, into the middle of a sentence: "What should Recessed lighting
 *     installation (6 lights) cost?" (quote-price-guard.ts:88-96).
 *   - The Spanish agreement title glued the job name in with its capital:
 *     "Acuerdo de Corte de césped semanal de Ana López" (agreement-title.ts:37).
 *   - /quotes titled every card and the open panel with the stored primary
 *     jobName, so a quote made in English stayed English in the Spanish app
 *     even when jobNameByLang.es existed (QuotesPage.tsx mapCard + panel).
 *
 * The casing rule: an English job name is a LABEL and keeps its Title Case
 * where it stands alone (sidebar row, card heading, "Bob's Deck Repair
 * Agreement"); wherever a job name or line description lands MID-SENTENCE it
 * is lowered — first word only for a sentence-case phrase, every word for a
 * Title Case one — and acronyms (LED, HVAC) and mixed-case words (iPhone,
 * McDonald) are never touched.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jn = (): any => require("../../shared/quote-flow/job-name");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg = (): any => require("../../shared/quote-flow/quote-price-guard");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (): any => require("../../shared/quote-flow/agreement-title");

describe("REQ-394 (p9) jobNameInSentence — a name mid-sentence is lower case", () => {
  test("REQ-394 a sentence-case phrase loses its leading capital", () => {
    expect(jn().jobNameInSentence("Recessed lighting installation (6 lights)"))
      .toBe("recessed lighting installation (6 lights)");
    expect(jn().jobNameInSentence("Corte de césped semanal"))
      .toBe("corte de césped semanal");
  });

  test("REQ-394 a Title Case label is lowered word by word", () => {
    expect(jn().jobNameInSentence("Recessed Lighting Installation"))
      .toBe("recessed lighting installation");
    expect(jn().jobNameInSentence("Master Bath Remodel"))
      .toBe("master bath remodel");
  });

  test("REQ-394 acronyms and mixed-case words keep their case", () => {
    expect(jn().jobNameInSentence("LED Strip Install")).toBe(
      "LED strip install",
    );
    expect(jn().jobNameInSentence("HVAC tune-up")).toBe("HVAC tune-up");
    expect(jn().jobNameInSentence("iPhone screen repair"))
      .toBe("iPhone screen repair");
    expect(jn().jobNameInSentence("McDonald fence")).toBe("McDonald fence");
  });

  test("REQ-394 whitespace is normalised and empty stays empty", () => {
    expect(jn().jobNameInSentence("  Panel   swap ")).toBe("panel swap");
    expect(jn().jobNameInSentence("")).toBe("");
  });
});

describe("REQ-394 (p9) priceProblemItem — the ask reads as a sentence", () => {
  test("REQ-394 'What should recessed lighting installation (6 lights) cost?'", () => {
    expect(
      pg().priceProblemItem(
        [{
          description: "Recessed lighting installation (6 lights)",
          amountCents: 0,
        }],
        "Quote",
      ),
    ).toBe("recessed lighting installation (6 lights)");
  });

  test("REQ-394 the summary fallback is lowered too", () => {
    expect(pg().priceProblemItem([], "Deck Repair")).toBe("deck repair");
  });

  test("REQ-394 the price ask template puts {item} mid-sentence in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["chatCoordinator.priceMissing"]).toMatch(
      /What should \{item\} cost\?/,
    );
    expect(es["chatCoordinator.priceMissing"]).toMatch(/costar \{item\}\?/);
  });
});

describe("REQ-394 (p9) agreementTitle — 'Acuerdo de corte de césped…'", () => {
  test("REQ-394 es: the job's first letter is lower case after 'Acuerdo de'", () => {
    expect(
      at().agreementTitle({
        customer: "Ana López",
        job: "Corte de césped semanal",
        lang: "es",
      }),
    ).toBe("Acuerdo de corte de césped semanal para Ana López");
  });

  test("REQ-394 es: a Title Case job is sentence-cased in the title", () => {
    expect(
      at().agreementTitle({
        customer: "Ana López",
        job: "Corte De Césped",
        lang: "es",
      }),
    ).toBe("Acuerdo de corte de césped para Ana López");
  });

  test("REQ-394 es: an acronym keeps its case", () => {
    expect(
      at().agreementTitle({
        customer: "Ana",
        job: "HVAC mantenimiento",
        lang: "es",
      }),
    ).toBe("Acuerdo de HVAC mantenimiento para Ana");
  });

  test("REQ-394 en keeps the Title Case label (unchanged REQ-036 shape)", () => {
    expect(
      at().agreementTitle({
        customer: "Godzilla",
        job: "Concrete Patio",
        lang: "en",
      }),
    ).toBe("Godzilla's Concrete Patio Agreement");
  });
});

describe("REQ-394 (p9) quoteJobTitle — /quotes titles follow the app language", () => {
  const q = {
    jobName: "Master Bath Remodel",
    jobNameByLang: { en: "Master Bath Remodel", es: "Remodelación de baño" },
    summary: "Complete master bath gut job",
    summaryByLang: { es: "Remodelación completa del baño principal" },
  };

  test("REQ-394 the current language's name wins over the stored primary", () => {
    expect(jn().quoteJobTitle(q, "es")).toBe("Remodelación de baño");
    expect(jn().quoteJobTitle(q, "en")).toBe("Master Bath Remodel");
  });

  test("REQ-394 no per-language name → the primary jobName, then the summary", () => {
    expect(jn().quoteJobTitle({ jobName: "Deck Repair" }, "es")).toBe(
      "Deck Repair",
    );
    expect(
      jn().quoteJobTitle({
        summary: "Fix deck",
        summaryByLang: { es: "Arreglar terraza" },
      }, "es"),
    ).toBe("Arreglar terraza");
    expect(jn().quoteJobTitle({}, "es")).toBeUndefined();
  });

  test("REQ-394 QuotesPage titles cards and the open panel through quoteJobTitle", () => {
    const page = read("front-end/islands/QuotesPage.tsx");
    expect(page).toMatch(
      /import \{[^}]*quoteJobTitle[^}]*\} from "..\/..\/shared\/quote-flow\/job-name.ts"/,
    );
    expect(page).not.toMatch(/c\.jobName\?\.trim\(\) \|\| c\.summary/);
    expect(page).not.toMatch(/q\.jobName\?\.trim\(\) \|\| q\.summary/);
    expect((page.match(/quoteJobTitle\(/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
});
