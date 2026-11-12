/**
 * REQ-450 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 3 (run re05e1cbb), issue p4: "Placeholder
 * examples don't fit the flow or the trade."
 *
 * RCA: the composer example came off the business name only (REQ-343) and
 * every example ended in "what should I charge?" — even in the "I know my
 * price" flow; kitchen & bath, fencing, concrete and handyman names fell back
 * to the slab line; the New-invoice job-name placeholder was a fixed plumbing
 * job; the quote prompt's greeting listed "paint, tile, plumbing, anything".
 *
 * Unit level: the pure choice in shared/quote-flow/trade-fit.ts (trade x
 * flow → key), both dictionaries carrying every key, the island wiring and
 * the rewritten greeting.
 */
import * as fs from "fs";
import * as path from "path";
import {
  COMPOSER_TRADES,
  composerFlowFor,
  composerPlaceholderKey,
  composerTradeFor,
  invoiceJobNamePlaceholderKey,
} from "../../shared/quote-flow/trade-fit";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-450 p4 — the composer example fits the flow", () => {
  it("REQ-450: known-price, quick-quote and invoice flows are 'priced'; help-me-price and free chat 'ask'", () => {
    expect(composerFlowFor("knownPrice")).toBe("priced");
    expect(composerFlowFor("quickQuote")).toBe("priced");
    expect(composerFlowFor("invoiceDone")).toBe("priced");
    expect(composerFlowFor("helpPrice")).toBe("ask");
    expect(composerFlowFor(null)).toBe("ask");
    expect(composerFlowFor(undefined)).toBe("ask");
  });

  it("REQ-450: a priced flow's example states a price and never asks what to charge — every trade, en and es", () => {
    for (const trade of COMPOSER_TRADES) {
      const key = `asstChat.composer.priced.${trade}`;
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).toMatch(/\$\d/);
      expect(es[key]).toMatch(/\$\d/);
      expect(en[key]).not.toMatch(/what should I charge/i);
      expect(es[key]).not.toMatch(/cuánto debo cobrar/i);
    }
  });

  it("REQ-450: the help-me-price example asks what to charge — every trade, en and es", () => {
    for (const trade of COMPOSER_TRADES) {
      const key = trade === "general"
        ? "asstChat.composer.default"
        : `asstChat.composer.example.${trade}`;
      expect(en[key]).toMatch(/what should I charge\?/i);
      expect(es[key]).toMatch(/cuánto debo cobrar\?/i);
      expect(en[key]).not.toMatch(/\$\d/);
    }
  });

  it("REQ-450: the key follows trade AND flow", () => {
    expect(composerPlaceholderKey("Rivera Plumbing", "priced")).toBe(
      "asstChat.composer.priced.plumbing",
    );
    expect(composerPlaceholderKey("Rivera Plumbing", "ask")).toBe(
      "asstChat.composer.example.plumbing",
    );
    expect(composerPlaceholderKey("Acme LLC", "priced")).toBe(
      "asstChat.composer.priced.general",
    );
    // Default flow is "ask" — the REQ-343 behaviour is unchanged.
    expect(composerPlaceholderKey("Acme LLC")).toBe(
      "asstChat.composer.default",
    );
    expect(composerPlaceholderKey("Jim Paints")).toBe(
      "asstChat.composer.example.painting",
    );
  });
});

describe("REQ-450 p4 — the trades that fell back to the slab get their own example", () => {
  it("REQ-450: kitchen & bath, fencing, concrete, handyman, moving and pest names map to their trade", () => {
    expect(composerTradeFor("Kitchen & Bath Pros")).toBe("kitchenbath");
    expect(composerTradeFor("Hernandez Remodeling")).toBe("kitchenbath");
    expect(composerTradeFor("Cocinas y Baños Ruiz")).toBe("kitchenbath");
    expect(composerTradeFor("Lone Star Fence Co.")).toBe("fencing");
    expect(composerTradeFor("Solid Concrete LLC")).toBe("concrete");
    expect(composerTradeFor("Mike the Handyman")).toBe("handyman");
    expect(composerTradeFor("Two Guys Movers")).toBe("moving");
    expect(composerTradeFor("Bug Off Pest Control")).toBe("pest");
    // A trade the sample list names still wins over kitchen/bath words.
    expect(composerTradeFor("Kitchen & Bath Plumbing")).toBe("plumbing");
    expect(composerTradeFor("Acme LLC")).toBe("general");
  });

  it("REQ-450: each new trade's examples exist in en AND es and none is the slab", () => {
    for (const trade of ["kitchenbath", "fencing", "concrete", "handyman"]) {
      for (
        const key of [
          `asstChat.composer.example.${trade}`,
          `asstChat.composer.priced.${trade}`,
        ]
      ) {
        expect(typeof en[key]).toBe("string");
        expect(typeof es[key]).toBe("string");
        expect(en[key]).not.toMatch(/10'x10'/);
        expect(es[key]).not.toMatch(/10'x10'/);
      }
    }
  });

  it("REQ-450: the composer reads the flow off the starter chip", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /composerPlaceholder\(\s*messages,\s*lang,\s*from\?\.business,\s*composerFlowFor\(flowChip\),?\s*\)/,
    );
    expect(src).toMatch(/composerPlaceholderKey\(businessName, flow\)/);
  });
});

describe("REQ-450 p4 — the New-invoice job name fits the trade", () => {
  it("REQ-450: the job-name placeholder key follows the business name; every trade has one in en and es", () => {
    expect(invoiceJobNamePlaceholderKey("Sparkle Home Cleaning")).toBe(
      "invoicesPage.new.jobNamePlaceholder.cleaning",
    );
    expect(invoiceJobNamePlaceholderKey("Rivera Plumbing")).toBe(
      "invoicesPage.new.jobNamePlaceholder.plumbing",
    );
    expect(invoiceJobNamePlaceholderKey("Acme LLC")).toBe(
      "invoicesPage.new.jobNamePlaceholder",
    );
    expect(invoiceJobNamePlaceholderKey(undefined)).toBe(
      "invoicesPage.new.jobNamePlaceholder",
    );
    for (const trade of COMPOSER_TRADES) {
      if (trade === "general") continue;
      const key = `invoicesPage.new.jobNamePlaceholder.${trade}`;
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
    }
    // The generic one no longer names a plumbing job.
    expect(en["invoicesPage.new.jobNamePlaceholder"]).not.toMatch(/faucet/i);
    expect(es["invoicesPage.new.jobNamePlaceholder"]).not.toMatch(/grifo/i);
  });

  it("REQ-450: the New-invoice form reads it off the profile's business name", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/invoiceJobNamePlaceholderKey\(businessName\)/);
    expect(src).not.toMatch(
      /tFor\(lang, "invoicesPage\.new\.jobNamePlaceholder"\)/,
    );
    expect(src).toMatch(/p\?\.identity\?\.businessName/);
  });
});

describe("REQ-450 p4 — the quote prompt's greeting does not list trades", () => {
  it("REQ-450: no 'paint, tile, plumbing, anything' in the systemQuote greeting (en and es)", () => {
    for (const dict of [en, es]) {
      const p = dict["prompts.systemQuote"];
      expect(p).not.toMatch(/paint, tile, plumbing, anything/);
      expect(p).toMatch(
        /Input: 'hello' \/ 'hey'\n\s+Reply: 'Hey! Tell me about the job/,
      );
    }
  });
});
