/**
 * REQ-591 (demo-loop cycle 4, M32), Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * M32: the English email preview of a Spanish-drafted quote had an English
 * subject ("Faucet Repair", from jobNameByLang.en) but a Spanish hero
 * ("Reparación De Grifo Y Puertas Interiores") — renderQuoteHtml read the
 * raw `summary`. quoteSummary(q, lang) is the one localized-summary reader:
 * the summary in `lang`, else the job name in `lang`, else the base summary.
 */
import { quoteSummary } from "../../shared/quote-flow/quote-translations";

const spanishDraft = {
  lang: "es",
  summary: "Reparación de grifo y puertas interiores",
  jobName: "Reparación de grifo",
  jobNameByLang: { es: "Reparación de grifo", en: "Faucet Repair" },
};

describe("REQ-591 (cycle 4, M32) quoteSummary — the summary in the document's language", () => {
  it("REQ-591: an English read of a Spanish-drafted quote uses summaryByLang.en", () => {
    expect(
      quoteSummary({
        ...spanishDraft,
        summaryByLang: { en: "Faucet and interior door repair" },
      }, "en"),
    ).toBe("Faucet and interior door repair");
  });

  it("REQ-591: with no English summary it falls back to the English job name, never the Spanish summary", () => {
    expect(quoteSummary(spanishDraft, "en")).toBe("Faucet Repair");
  });

  it("REQ-591: the base language reads the typed summary", () => {
    expect(
      quoteSummary(
        { ...spanishDraft, summaryByLang: { es: "parafraseado" } },
        "es",
      ),
    ).toBe("Reparación de grifo y puertas interiores");
  });

  it("REQ-591: with nothing in the language it falls back to the base summary, then undefined", () => {
    expect(quoteSummary({ summary: "Paint the bathroom" }, "es")).toBe(
      "Paint the bathroom",
    );
    expect(quoteSummary({}, "en")).toBeUndefined();
    expect(quoteSummary({ summary: "  " }, "en")).toBeUndefined();
  });
});
