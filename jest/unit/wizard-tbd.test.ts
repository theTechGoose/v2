/**
 * REQ-046 / REQ-047 (2026-09-30), Raphael: "in the wizard we need to add TBD
 * to when does the job start and how long will the job take."
 *
 * The wizard's option labels resolve from the shared dictionaries (the
 * backend emits them via t(lang, key)); the stored term value is the English
 * "TBD", and every renderer skips the "Estimated …" wrapper for it through
 * one shared predicate.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");
import { isTbdTermValue, TERM_VALUE_TBD } from "../../shared/quote-flow/terms-i18n";

describe("REQ-046 start-date TBD copy", () => {
  it("REQ-046 the start-date step's TBD option is labelled TBD (en) / Por definir (es)", () => {
    expect(en["termsWizard.startDate.tbd"]).toBe("TBD");
    expect(es["termsWizard.startDate.tbd"]).toBe("Por definir");
    // The term-edit fallback picker (AsstChat TERM_OPTIONS_FALLBACK) mirrors it.
    expect(en["asstChat.terms.startDate.tbd"]).toBe("TBD");
    expect(es["asstChat.terms.startDate.tbd"]).toBe("Por definir");
  });
});

describe("REQ-047 duration TBD copy", () => {
  it("REQ-047 the duration step's TBD option is labelled TBD (en) / Por definir (es)", () => {
    expect(en["termsWizard.wraps.tbd"]).toBe("TBD");
    expect(es["termsWizard.wraps.tbd"]).toBe("Por definir");
    expect(en["asstChat.duration.preset.tbd"]).toBe("TBD");
    expect(es["asstChat.duration.preset.tbd"]).toBe("Por definir");
  });
});

describe("REQ-046/047 the stored TBD term value", () => {
  it("REQ-046/047 the web agreement and the PDFs localize the stored 'TBD' through their term-value keys", () => {
    expect(en["quoteDoc.termValue.tbd"]).toBe("TBD");
    expect(es["quoteDoc.termValue.tbd"]).toBe("Por definir");
    expect(en["renderQuotePdf.termValue.tbd"]).toBe("TBD");
    expect(es["renderQuotePdf.termValue.tbd"]).toBe("Por definir");
  });

  it("REQ-047 isTbdTermValue recognizes the stored value (any case, padded) and nothing else", () => {
    expect(TERM_VALUE_TBD).toBe("TBD");
    expect(isTbdTermValue("TBD")).toBe(true);
    expect(isTbdTermValue(" tbd ")).toBe(true);
    expect(isTbdTermValue("3 weeks")).toBe(false);
    expect(isTbdTermValue("Job completed")).toBe(false);
    expect(isTbdTermValue("")).toBe(false);
  });
});
