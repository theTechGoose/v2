/**
 * REQ-343 — Raphael, 2026-11-11: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 1, issues p3 ("Examples and questions
 * don't fit the trade: slab placeholder, warranty for cleaning") and p6 ("Odd
 * duration choices: 'Job completed' for a future job, no hours, Custom
 * defaults to 3 weeks").
 *
 * Unit level: the pure trade fit (shared/quote-flow/trade-fit.ts) — which
 * businesses are SERVICE trades (hours, no warranty) and which composer
 * example a business gets; both dictionaries carrying every example and the
 * hours presets; the duration extracted from the typed job; the hover style
 * no longer wearing the selected/suggested green; the custom duration picker
 * opening empty.
 */
import * as fs from "fs";
import * as path from "path";
import {
  COMPOSER_TRADES,
  composerPlaceholderKey,
  composerTradeFor,
  tradeKindFor,
} from "../../shared/quote-flow/trade-fit";
import { extractDuration } from "../../shared/quote-flow/quote-facts";
import { termLabel } from "../../shared/quote-flow/terms-i18n";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-343 p3 — the composer example and the wizard fit the trade", () => {
  it("REQ-343: service trades (cleaning, lawn, junk removal) are 'service'; builders are 'project'", () => {
    expect(tradeKindFor("Sparkle Home Cleaning")).toBe("service");
    expect(tradeKindFor("Limpieza Garcia")).toBe("service");
    expect(tradeKindFor("Green Lawn Care")).toBe("service");
    expect(tradeKindFor("Joe's Junk Removal")).toBe("service");
    expect(tradeKindFor("Haul-It-Away")).toBe("service");
    expect(tradeKindFor("Riley Roofing Co.")).toBe("project");
    expect(tradeKindFor("Rivera Plumbing")).toBe("project");
    expect(tradeKindFor("Jim Paints")).toBe("project");
    expect(tradeKindFor("")).toBe("project");
    expect(tradeKindFor(undefined)).toBe("project");
  });

  it("REQ-343: the composer example follows the business name; a tradeless name keeps the generic example", () => {
    expect(composerTradeFor("Jim Paints")).toBe("painting");
    expect(composerTradeFor("Sparkle Home Cleaning")).toBe("cleaning");
    expect(composerTradeFor("Green Lawn Care")).toBe("landscaping");
    expect(composerTradeFor("Joe's Junk Removal")).toBe("junk");
    expect(composerTradeFor("Volt Electric")).toBe("electrical");
    expect(composerTradeFor("Acme LLC")).toBe("general");
    expect(composerPlaceholderKey("Jim Paints")).toBe("asstChat.composer.example.painting");
    // The generic fallback is the existing key, so nothing regresses for a
    // name that names no trade.
    expect(composerPlaceholderKey("Acme LLC")).toBe("asstChat.composer.default");
    expect(composerPlaceholderKey(undefined)).toBe("asstChat.composer.default");
  });

  it("REQ-343: every trade example exists in en AND es, and none of them is the slab", () => {
    for (const trade of COMPOSER_TRADES) {
      if (trade === "general") continue;
      const key = `asstChat.composer.example.${trade}`;
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).not.toMatch(/slab/i);
      expect(es[key]).not.toMatch(/losa/i);
    }
  });

  it("REQ-343: the composer reads the example off the business name", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/composerPlaceholderKey\(/);
    expect(src).toMatch(/composerPlaceholder\(messages,\s*lang,\s*from\?\.business\)/);
  });
});

describe("REQ-343 p6 — duration choices", () => {
  it("REQ-343: the hours presets and 'Half a day' exist in en AND es", () => {
    for (const key of [
      "termsWizard.wraps.twoHours",
      "termsWizard.wraps.fourHours",
      "termsWizard.wraps.halfDay",
      "quoteDoc.termValue.halfDay",
      "renderQuotePdf.termValue.halfDay",
    ]) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
    }
    expect(en["termsWizard.wraps.twoHours"]).toBe("2 hours");
    expect(es["termsWizard.wraps.twoHours"]).toBe("2 horas");
  });

  it("REQ-343: a duration in the typed job is extracted (hours, days, weeks, months; EN and ES)", () => {
    expect(extractDuration("Thinking 4 weeks for the remodel")).toEqual({ n: 4, unit: "weeks" });
    expect(extractDuration("a 4-hour deep clean")).toEqual({ n: 4, unit: "hours" });
    expect(extractDuration("should take about 3 days")).toEqual({ n: 3, unit: "days" });
    expect(extractDuration("unos 2 meses de obra")).toEqual({ n: 2, unit: "months" });
    expect(extractDuration("toma 5 horas")).toEqual({ n: 5, unit: "hours" });
    expect(extractDuration("Kitchen remodel $18,000 half deposit")).toBeNull();
    // Net terms are not a duration.
    expect(extractDuration("net 30 days")).toBeNull();
  });

  it("REQ-343: termLabel speaks hours in both languages", () => {
    expect(termLabel({ kind: "duration", value: { n: 2, unit: "hours" } }, "en")).toBe("2 hours");
    expect(termLabel({ kind: "duration", value: { n: 1, unit: "hours" } }, "es")).toBe("1 hora");
    expect(termLabel({ kind: "duration", value: { n: 4, unit: "hours" } }, "es")).toBe("4 horas");
  });

  it("REQ-343: the custom duration picker opens with an EMPTY number (or the job's own duration), never '3 weeks'", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("function CustomDurationPickerForm(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, start + 4000);
    expect(body).not.toMatch(/useState\("3"\)/);
    expect(body).toMatch(/useState\(\s*props\.initial\?\.n != null \? String\(props\.initial\.n\) : ""/);
    // The call site hands it the duration extracted from the job.
    expect(src).toMatch(/<CustomDurationPickerForm[\s\S]{0,300}initial=\{quoteFacts\.duration/);
  });

  it("REQ-343: a hovered option does not wear the selected/suggested green", () => {
    const css = read("front-end/static/assistant-page.css");
    const m = css.match(/\.wiz-opt:hover\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/brand-green/);
    expect(m![1]).toMatch(/border-color:\s*var\(--brand-teal\)/);
  });
});
