/**
 * REQ-692 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues p18-6a "Signature labels
 * wrong ('CARMEN NÚÑEZ SIGNATURE', 'SIGN HERE' after signing, name
 * spelling)" and c3-p8-pair5-e "Contractor signature filled in
 * automatically".
 *
 * - EN quoteDoc.signatureOf is possessive: "{name}'s signature".
 * - Once signed the section is titled "Signatures" / "Firmas".
 * - The contractor column says it was signed by sending, on the sent date.
 * - Before signing, a typed name that differs from the one on file only by
 *   accents or case gets the on-file spelling suggested (never rejected).
 */
import * as fs from "fs";
import * as path from "path";
import { onFileSpellingSuggestion } from "../../shared/quote-flow/signer-name.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-692 (cycle 5, p18-6a + c3-p8-pair5-e) signature section copy", () => {
  test("EN signatureOf is possessive; ES stays 'Firma de {name}'", () => {
    expect(en["quoteDoc.signatureOf"]).toBe("{name}'s signature");
    expect(es["quoteDoc.signatureOf"]).toBe("Firma de {name}");
  });

  test("a signed section title exists in en and es", () => {
    expect(en["quoteDoc.signatures"]).toBe("Signatures");
    expect(es["quoteDoc.signatures"]).toBe("Firmas");
  });

  test("the contractor column explains it was signed by sending, with a date", () => {
    expect(en["quoteDoc.contractorSignedBySending"]).toBe(
      "Signed by sending this agreement on {date}",
    );
    expect(es["quoteDoc.contractorSignedBySending"]).toContain("{date}");
    expect(es["quoteDoc.contractorSignedBySending"]).toMatch(
      /^Firmado al enviar/,
    );
  });

  test("the spelling-suggestion copy exists in en and es", () => {
    for (const d of [en, es]) {
      expect(d["publicSign.nameSuggest"]).toContain("{name}");
      expect(typeof d["publicSign.nameSuggestUse"]).toBe("string");
    }
  });
});

describe("REQ-692 (cycle 5, p18-6a) onFileSpellingSuggestion", () => {
  test("accent-only or case-only differences suggest the on-file spelling", () => {
    expect(onFileSpellingSuggestion("Carmen Nunez", "Carmen Núñez")).toBe(
      "Carmen Núñez",
    );
    expect(onFileSpellingSuggestion("carmen núñez", "Carmen Núñez")).toBe(
      "Carmen Núñez",
    );
    expect(onFileSpellingSuggestion("  CARMEN   NUNEZ ", " Carmen Núñez")).toBe(
      "Carmen Núñez",
    );
  });

  test("an exact match, a different name, or no name on file suggests nothing", () => {
    expect(onFileSpellingSuggestion("Carmen Núñez", "Carmen Núñez"))
      .toBeUndefined();
    expect(onFileSpellingSuggestion(" Carmen  Núñez ", "Carmen Núñez"))
      .toBeUndefined();
    expect(onFileSpellingSuggestion("Carmen Lopez", "Carmen Núñez"))
      .toBeUndefined();
    expect(onFileSpellingSuggestion("Carmen Nunez", undefined)).toBeUndefined();
    expect(onFileSpellingSuggestion("", "Carmen Núñez")).toBeUndefined();
  });
});
