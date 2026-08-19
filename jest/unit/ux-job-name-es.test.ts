/**
 * RED (TDD) — Spanish job-name / version-title derivation contracts.
 *
 * UX-05    "Spanish stopword Title-Casing in generated version titles becomes the
 *           customer-facing job name … 'Instalación De Patio' … STORED as jobName"
 * UX-41(c) "the ES Title-Casing convention shows again ('Cambiar 12 Tablas') —
 *           Spanish titles should be sentence case throughout"
 * UX-26(c) "'Pintar La Sala' — stopword Title-Casing again in the SMS job name"
 * UX-29    "'El patio de adoquines de María Nguyen, $3,700' → jobName 'El patio de'
 *           … Trim leading articles and never end on a stopword ('Patio de adoquines')"
 *
 * Phones used by this file: NONE (pure logic, no network).
 *
 * TARGET CONTRACT — extension of the EXISTING module (no new module):
 *
 * shared/quote-flow/job-name.ts
 *   export function summarizeJobName(details: string, lang?: "en" | "es"): string
 *     — lang omitted / "en": today's behavior, unchanged (frozen green by
 *       jest/unit/job-name.test.ts — do not break it).
 *     — lang "es": Spanish derivation of the ≤3-word job name:
 *         * Spanish connector/stopwords (de, del, la, el, los, las, un, una,
 *           y, o, para, por, con, en, al) are KEPT mid-name as connectors —
 *           NOT dropped the way the EN path drops its stopwords — but they
 *           are (1) never the first word (leading articles/connectors are
 *           trimmed), (2) never the last word (no stopword tail), and
 *           (3) always lowercase mid-name.
 *         * Sentence case: first word capitalized; other words keep their
 *           input casing when already capitalized (proper nouns: "María"),
 *           otherwise stay lowercase — never blanket Title Case.
 *         * Accent-safe: casing must be code-point aware (charAt/slice or
 *           \p{L}-class regex), NEVER the \b\w-class trick P-07 banned for
 *           email heroes ("InstalacióN" must be impossible).
 *         * Punctuation/bullets stripped and ≤3 words, as today; the result
 *           still satisfies isValidJobName.
 *
 * WHY summarizeJobName today is the wrong machine for Spanish (read live):
 *   shared/quote-flow/job-name.ts:11-15  — STOPWORDS is English-only, so
 *     "de/del/la/el/para/y" count as significant words;
 *   shared/quote-flow/job-name.ts:17-19  — titleCase() uppercases EVERY word;
 *   shared/quote-flow/job-name.ts:22-43  — no lang parameter at all.
 *   Verified live: summarizeJobName("El patio de adoquines de María Nguyen,
 *   $3,700") === "El Patio De" — leading article kept, stopword tail,
 *   Title-Cased.
 *
 * WIRING SITES the green agent must route through the lang-aware derivation
 * (each read in the prod source; the same title-casing bug is duplicated
 * inline at the agents coordinators):
 *   backend/src/paperwork/domain/data/quote-store/mod.ts:28-31
 *     — `quote.jobName = summarizeJobName(source)` on POST /quotes when no
 *       jobName is supplied; must pass the quote's language (owner's comms/
 *       app language). This string headlines the customer's /q page.
 *   backend/src/agents/domain/coordinators/generate-job-options/mod.ts
 *     :210-217 clampJobName / :219-221 deriveJobName / :223-226 titleCaseWord
 *       — lang-blind Title Case applied to every option jobName;
 *     :140-143 normalizeOneLang — clamps the LLM-supplied per-language
 *       jobName without knowing which language it is normalizing;
 *     :240-260 fallbackOptions.perLang — `lang` is in scope but unused for
 *       the jobName casing (only the versionTitle qualifier is localized).
 *   backend/src/agents/domain/coordinators/polish-job-details/mod.ts
 *     :132-139 clampJobName / :141-143 deriveJobName / :145-148 titleCaseWord
 *       — same duplicated lang-blind Title Case;
 *     :150-159 fallback — `lang` is in scope at :156 but unused for casing.
 *   front-end/islands/AsstChat.tsx:214 (localFallbackOptions),
 *   front-end/islands/AsstChat.tsx:2023 (write-it-myself custom option),
 *   front-end/islands/AsstChat.tsx:3137 (facturar flow — this raw 3-word
 *     slice is what produced the LITERAL "El patio de" invoice headline of
 *     UX-29) — all three derive a jobName with a bare
 *     `split(/\s+/).slice(0, 3)` and should use the shared derivation.
 *   backend/src/paperwork/entrypoints/invoice-controller/mod.ts:217
 *     — `dto.jobName ??= q.jobName ?? q.summary`: the invoice inherits the
 *       quote's jobName, so fixing the quote derivation also fixes the /i
 *       headline (pinned over HTTP in jest/integration/ux-job-name.int.test.ts).
 *
 * NOT in scope here: shared/quote-flow/email-format.ts#titleCaseJobName —
 * that is P-07's EMAIL-hero contract ("Instalación de Baño y Cocina", Title
 * Case with lowercase stopwords) and stays as-is; this file pins the
 * version-title/jobName DERIVATION path, whose ES convention is sentence
 * case (UX-41).
 */
import { summarizeJobName } from "../../shared/quote-flow/job-name";
import { versionTitle } from "../../shared/quote-flow/version-titles";

// The extended signature under test. Today's export takes one argument
// (extra args are ignored at runtime — ts-jest diagnostics are off), so
// every ES expectation below fails against the current EN-only behavior.
const summarize = summarizeJobName as unknown as (
  details: string,
  lang?: "en" | "es",
) => string;

/** The ES connector/stopword set of the contract (kept in sync with the
 *  header). Used for property assertions only. */
const ES_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una",
  "y", "o", "para", "por", "con", "en", "al",
]);
const ES_ARTICLES = new Set(["el", "la", "los", "las", "un", "una"]);

const words = (s: string) => s.trim().split(/\s+/);
const lastWord = (s: string) => words(s)[words(s).length - 1];

describe("UX-05: ES derived jobName keeps stopwords lowercase (sentence case, accent-safe)", () => {
  it("UX-05: 'instalación de patio…' → 'Instalación de patio', never 'Instalación De Patio'", () => {
    const out = summarize("instalación de patio de adoquines 20x15", "es");
    // Current behavior (verified live): "Instalación De Patio".
    expect(out).toBe("Instalación de patio");
    expect(out).not.toBe("Instalación De Patio");
    // Accent-safety guard: the fix must not reintroduce the \b\w-class bug
    // (uppercase glued after a lowercase inside a word, e.g. "InstalacióN").
    expect(/\p{Ll}\p{Lu}/u.test(out)).toBe(false);
    expect(out).not.toContain("InstalacióN");
  });

  it("UX-05: ES connectors are KEPT in the name (not dropped) and lowercase mid-name", () => {
    // Current behavior (verified live): "Cambio De Llaves".
    expect(summarize("Cambio de llaves de María Nguyen", "es"))
      .toBe("Cambio de llaves");
  });

  it("UX-05: the ES version-title composition carries the sentence-cased base name", () => {
    // generate-job-options/mod.ts:253 + AsstChat.tsx:223 compose
    // versionTitle(<derived jobName>, variant, lang) — the qualifier is
    // already localized; the BASE name is the broken half.
    const title = versionTitle(
      summarize("instalación de patio de adoquines 20x15", "es"),
      "short",
      "es",
    );
    // Current behavior (verified live): "Instalación De Patio · Versión breve".
    expect(title).toBe("Instalación de patio · Versión breve");
  });
});

describe("UX-41: ES titles are sentence case, not Title Case", () => {
  it("UX-41: 'cambiar 12 tablas…' → 'Cambiar 12 tablas', not 'Cambiar 12 Tablas'", () => {
    // Current behavior (verified live): "Cambiar 12 Tablas".
    expect(summarize("cambiar 12 tablas del deck", "es"))
      .toBe("Cambiar 12 tablas");
    // Same facet, second input — no stopword involved at all: sentence case
    // must hold even where there is no stopword to exempt.
    // Current behavior (verified live): "Reparar 2 Puertas".
    expect(summarize("reparar 2 puertas dañadas", "es"))
      .toBe("Reparar 2 puertas");
  });
});

describe("UX-26(c): the SMS job name casing", () => {
  it("UX-26(c): 'pintar la sala' → 'Pintar la sala', never 'Pintar La Sala'", () => {
    // Current behavior (verified live): "Pintar La Sala". The stored jobName
    // is what the send-contract SMS interpolates, so this string IS the
    // "Pintar La Sala" the customer received in UX-26.
    const out = summarize("pintar la sala", "es");
    expect(out).toBe("Pintar la sala");
    expect(out).not.toContain("La Sala");
  });
});

describe("UX-29: derivation trims leading articles and never ends on a stopword", () => {
  it("UX-29: 'El patio de adoquines de María Nguyen, $3,700' → 'Patio de adoquines', never 'El patio de'", () => {
    // Current behavior (verified live): "El Patio De" — leading article
    // kept, stopword tail, Title Case: all three UX-29 defects in one string.
    const out = summarize("El patio de adoquines de María Nguyen, $3,700", "es");
    expect(out).toBe("Patio de adoquines");
    expect(out.toLowerCase()).not.toBe("el patio de");
    expect(words(out)[0].toLowerCase()).not.toBe("el");
    expect(ES_STOPWORDS.has(lastWord(out).toLowerCase())).toBe(false);
  });

  it("UX-29: never ends on de/del/la/el/para/y — stopword-tail grid", () => {
    // Each input's naive first-3-word window ends on the named stopword.
    // Current behavior (verified live, in order): "Limpieza Profunda Del",
    // "Instalación De La", "Pintar Todo El", "Cotización Urgente Para",
    // "Demolición Limpieza Y".
    const grid: Array<[tail: string, details: string]> = [
      ["del", "Limpieza profunda del jardín trasero"],
      ["la", "Instalación de la cerca nueva"],
      ["el", "Pintar todo el interior de la casa"],
      ["para", "Cotización urgente para remodelación completa"],
      ["y", "Demolición, limpieza y acarreo de escombros"],
    ];
    for (const [tail, details] of grid) {
      const out = summarize(details, "es");
      // Structural contract only (the exact wording is implementation room):
      expect(out.trim().length).toBeGreaterThan(0);
      expect(words(out).length).toBeLessThanOrEqual(3);
      // the reason this grid exists:
      expect(ES_STOPWORDS.has(lastWord(out).toLowerCase())).toBe(false);
      expect(lastWord(out).toLowerCase()).not.toBe(tail);
      // sentence-case + accent-safety hold across the grid too:
      expect(/\p{Ll}\p{Lu}/u.test(out)).toBe(false);
      for (const w of words(out).slice(1)) {
        if (ES_STOPWORDS.has(w.toLowerCase())) expect(w).toBe(w.toLowerCase());
      }
    }
  });

  it("UX-29: leading articles are trimmed — a name never starts with el/la/los/las/un/una", () => {
    // Current behavior (verified live): "La Cocina Completa".
    const out = summarize("La cocina completa remodelada por dentro", "es");
    expect(ES_ARTICLES.has(words(out)[0].toLowerCase())).toBe(false);
    // and the first (significant) word is capitalized — it heads the /q page.
    expect(words(out)[0][0]).toBe(words(out)[0][0].toUpperCase());
  });
});
