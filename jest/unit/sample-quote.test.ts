/**
 * REQ-256 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue onboarding-dashboard-settings-p2: the onboarding sample quote was
 * always "Paver Patio Installation", its To card read "TO —", it was marked
 * Sent (and took Q-001), and its content stayed English on a Spanish page.
 *
 * Unit level: the pure pick of the sample's job (shared/quote-flow/sample-quote.ts),
 * both dictionaries carrying every trade's copy, the public document's wiring
 * for a sample (placeholder customer, sample headline, per-language line items),
 * and the wizard generating the sample at its own step (not at mount) and
 * opening it in the wizard's language.
 */
import * as fs from "fs";
import * as path from "path";
import {
  inferSampleTrade,
  SAMPLE_PRICES,
  SAMPLE_TRADES,
  sampleQuoteKeys,
} from "../../shared/quote-flow/sample-quote";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-256 the sample quote fits the business, in both languages", () => {
  test("REQ-256 the trade comes from the business name, English or Spanish; a name with no trade is general, never a paver patio", () => {
    expect(inferSampleTrade("Rivera Plumbing LLC")).toBe("plumbing");
    expect(inferSampleTrade("Plomería Rivera")).toBe("plumbing");
    expect(inferSampleTrade("Bright Spark Electric")).toBe("electrical");
    expect(inferSampleTrade("Techos García")).toBe("roofing");
    expect(inferSampleTrade("Austin Roofing Co")).toBe("roofing");
    expect(inferSampleTrade("Pinturas del Valle")).toBe("painting");
    expect(inferSampleTrade("Cool Breeze HVAC")).toBe("hvac");
    expect(inferSampleTrade("Sparkle Cleaning")).toBe("cleaning");
    expect(inferSampleTrade("Green Lawn Landscaping")).toBe("landscaping");
    expect(inferSampleTrade("Acme Holdings")).toBe("general");
    expect(inferSampleTrade("")).toBe("general");
    expect(inferSampleTrade(undefined)).toBe("general");
  });

  test("REQ-256 every trade has a job name and two line items in English AND Spanish, and they differ", () => {
    for (const trade of SAMPLE_TRADES) {
      const keys = sampleQuoteKeys(trade);
      for (const k of Object.values(keys)) {
        expect([trade, k, typeof en[k]]).toEqual([trade, k, "string"]);
        expect([trade, k, typeof es[k]]).toEqual([trade, k, "string"]);
        expect(en[k].trim().length).toBeGreaterThan(0);
        expect(es[k]).not.toBe(en[k]);
      }
      const [materials, labor] = SAMPLE_PRICES[trade];
      expect(Number.isInteger(materials) && materials > 0).toBe(true);
      expect(Number.isInteger(labor) && labor > 0).toBe(true);
    }
    // only the landscaping sample is a paver patio
    const paver = SAMPLE_TRADES.filter((tr) =>
      /paver/i.test(en[sampleQuoteKeys(tr).jobName] ?? "")
    );
    expect(paver).toEqual(["landscaping"]);
  });

  test("REQ-256 the sample's To card and headline have their own copy in both languages", () => {
    for (const k of ["quoteDoc.sampleCustomer", "quoteDoc.sampleHeadline"]) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
      expect(es[k]).not.toBe(en[k]);
    }
  });

  test("REQ-256 the public document renders a sample with the placeholder customer, the sample headline and per-language line items", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    expect(doc).toMatch(/isSample\?: boolean/);
    expect(doc).toMatch(/quoteDoc\.sampleCustomer/);
    expect(doc).toMatch(/quoteDoc\.sampleHeadline/);
    // reconciled on demo-fixes: the per-language line text comes through
    // REQ-264's localizeLineItems, which reads descriptionByLang[lang]
    expect(doc).toMatch(/localizeLineItems\(quote\.lineItems, lang\)/);
    expect(read("shared/quote-flow/quote-translations.ts")).toMatch(
      /li\.descriptionByLang!\[lang\]/,
    );
    const parts = read("front-end/components/doc-parts.tsx");
    expect(parts).toMatch(
      /interface LineItem \{[^}]*descriptionByLang\?: Record<string, string>/s,
    );
  });

  test("REQ-256 the wizard makes the sample at the sample step, not at mount, and opens it in the wizard's language", () => {
    const wiz = read("front-end/islands/WelcomeWizard.tsx");
    // the old mount-time effect is gone
    expect(wiz).not.toMatch(
      /useEffect\(\(\) => \{\s*ensureSampleQuote\(\);\s*\}, \[\]\);/,
    );
    // generation is tied to the sample step being on screen
    expect(wiz).toMatch(
      /step\.id === "sampleQuote"[\s\S]{0,80}ensureSampleQuote\(\)/,
    );
    // the preview frame and the full-page link carry the language
    expect(wiz).toMatch(/\/q\/\$\{quoteId\}\?lang=\$\{/);
  });
});
