/**
 * REQ-441 (demo-loop cycle 3, issue M23), Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * M23: in "help me price it" the contractor confirmed the drafted scope and
 * added a line with "Add your own…". The quote's English description had 11
 * lines, its Spanish copy 10 — startQuoteFromRaw wrote every other language
 * from the ORIGINAL pre-generated option, and TranslateQuote saw Spanish as
 * already present and never refilled it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  confirmedDescriptionByLang,
  missingQuoteTranslations,
  previewTranslationMissing,
} from "../../shared/quote-flow/quote-translations";

const EN = [
  "Remove old vanity",
  "Install 60in double vanity",
  "Connect plumbing",
];
const ES = [
  "Retirar el mueble viejo",
  "Instalar mueble doble de 60in",
  "Conectar plomería",
];
const byLang = {
  en: { bullets: EN },
  es: { bullets: ES },
};

describe("REQ-441 (M23) the confirmed option's pre-generated translations", () => {
  it("REQ-441 unedited bullets reuse the pre-generated translation", () => {
    const r = confirmedDescriptionByLang(byLang, "en", EN.join("\n"));
    expect(r.descriptionByLang).toEqual({
      en: EN.join("\n"),
      es: ES.join("\n"),
    });
    expect(r.stale).toEqual([]);
  });

  it("REQ-441 a line added with 'Add your own…' leaves Spanish out (stale) — never the old 3-line copy", () => {
    const raw = [...EN, "Haul away debris"].join("\n");
    const r = confirmedDescriptionByLang(byLang, "en", raw);
    expect(r.descriptionByLang).toEqual({ en: raw });
    expect(r.stale).toEqual(["es"]);
  });

  it("REQ-441 an edited (reworded) line is stale too, and so is a deleted one", () => {
    const reworded = ["Remove old vanity", "Install 72in vanity", EN[2]];
    expect(
      confirmedDescriptionByLang(byLang, "en", reworded.join("\n")).stale,
    ).toEqual(["es"]);
    expect(
      confirmedDescriptionByLang(byLang, "en", EN.slice(0, 2).join("\n"))
        .stale,
    ).toEqual(["es"]);
  });

  it("REQ-441 whitespace around lines is not an edit", () => {
    const raw = `  ${EN[0]}\n${EN[1]}  \n\n${EN[2]}\n`;
    expect(confirmedDescriptionByLang(byLang, "en", raw).stale).toEqual([]);
  });

  it("REQ-441 a Spanish contractor's edit marks English stale", () => {
    const raw = [...ES, "Retirar escombros"].join("\n");
    const r = confirmedDescriptionByLang(byLang, "es", raw);
    expect(r.descriptionByLang).toEqual({ es: raw });
    expect(r.stale).toEqual(["en"]);
  });

  it("REQ-441 no app-language bullets to compare with → every other language is stale", () => {
    const r = confirmedDescriptionByLang({ es: { bullets: ES } }, "en", "x");
    expect(r.descriptionByLang).toEqual({ en: "x" });
    expect(r.stale).toEqual(["es"]);
  });
});

describe("REQ-441 (M23) server guard — a cached copy with a different line count is stale", () => {
  const description = [...EN, "Haul away debris"].join("\n");

  it("REQ-441 es with 3 lines for a 4-line description is re-translated", () => {
    const q = {
      lang: "en",
      description,
      descriptionByLang: { en: description, es: ES.join("\n") },
    };
    expect(missingQuoteTranslations(q)).toEqual([
      {
        lang: "es",
        descriptionLines: [...EN, "Haul away debris"],
        lineIndexes: [],
      },
    ]);
    expect(previewTranslationMissing(q, "es")).toBe(true);
  });

  it("REQ-441 es with the same line count is kept", () => {
    const q = {
      lang: "en",
      description,
      descriptionByLang: {
        en: description,
        es: [...ES, "Retirar escombros"].join("\n"),
      },
    };
    expect(missingQuoteTranslations(q)).toEqual([]);
  });

  it("REQ-441 the base slot with a stale line count is refilled too (asked with '')", () => {
    const q = {
      lang: "en",
      description,
      descriptionByLang: { en: EN.join("\n") },
    };
    expect(missingQuoteTranslations(q, ["en"], "").map((m) => m.lang))
      .toEqual(["en"]);
  });
});

describe("REQ-441 (M23) AsstChat wiring", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../front-end/islands/AsstChat.tsx"),
    "utf8",
  );
  const start = src.indexOf("async function startQuoteFromRaw(");
  const body = src.slice(start, src.indexOf("const quoteFields", start));

  it("REQ-441 startQuoteFromRaw seeds descriptionByLang through confirmedDescriptionByLang", () => {
    expect(body).toContain("confirmedDescriptionByLang(");
    expect(body).not.toMatch(/v\.bullets\.join\("\\n"\)/);
  });

  it("REQ-441 stale languages are translated from the live lines", () => {
    expect(body).toMatch(/assistantClient\.translate\(/);
  });
});
