/**
 * REQ-1069 — Raphael (LOOP-007): "test every single aspect of this application
 * … one Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green". QA issue q2-58, cycle 2: the
 * /welcome step 10 sample for "Ruiz Lawn & Pool Care" was a "Paver Patio
 * Installation" — a hardscape build for a lawn & pool maintenance business.
 *
 * Root cause: shared/quote-flow/sample-quote.ts put lawn-care stems (lawn,
 * garden, yard, tree, pasto, jardín) and hardscape stems (paver, patio,
 * hardscap) in ONE "landscaping" trade, whose one sample is the paver patio,
 * and had no pool trade at all.
 *
 * Unit level: the pure trade pick + the dictionary copy each pick reads.
 */
import * as fs from "fs";
import * as path from "path";
import {
  inferSampleTrade,
  SAMPLE_PRICES,
  SAMPLE_TRADES,
  sampleQuoteKeys,
} from "../../shared/quote-flow/sample-quote";
import { tradeKindFor } from "../../shared/quote-flow/trade-fit";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const HARDSCAPE = /paver|patio|adoqu/i;
const sampleText = (name: string) => {
  const keys = sampleQuoteKeys(inferSampleTrade(name));
  return Object.values(keys).flatMap((k) => [en[k] ?? "", es[k] ?? ""]).join(
    " | ",
  );
};

describe("REQ-1069 (LOOP-007 q2-58) a lawn or pool business's sample is a service visit, not a paver patio", () => {
  test("REQ-1069 'Ruiz Lawn & Pool Care' is not the landscaping (paver patio) trade and its sample names no paver/patio/adoquín", () => {
    const name = "Ruiz Lawn & Pool Care";
    expect([name, inferSampleTrade(name)]).not.toEqual([name, "landscaping"]);
    expect(sampleText(name)).not.toMatch(HARDSCAPE);
    expect(en[sampleQuoteKeys(inferSampleTrade(name)).jobName]).not.toBe(
      "Paver Patio Installation",
    );
  });

  test("REQ-1069 lawn-care and pool names get their own trades: pool → pool, lawn/garden/yard/tree → lawncare", () => {
    const cases: Array<[string, string]> = [
      ["Blue Pool Service", "pool"],
      ["Piscinas del Sol", "pool"],
      ["Alberca Limpia", "pool"],
      ["Green Lawn Mowing", "lawncare"],
      ["Jardinería López", "lawncare"],
      ["Rivera Tree Service", "lawncare"],
      ["Happy Yard Care", "lawncare"],
    ];
    expect(cases.map(([n]) => [n, inferSampleTrade(n)])).toEqual(cases);
  });

  test("REQ-1069 the paver patio stays landscaping's alone — hardscape names keep it", () => {
    expect(inferSampleTrade("Stone Path Landscaping")).toBe("landscaping");
    expect(inferSampleTrade("Austin Paver Pros")).toBe("landscaping");
    expect(inferSampleTrade("Hill Country Hardscapes")).toBe("landscaping");
    expect(en[sampleQuoteKeys("landscaping").jobName]).toMatch(/paver/i);
  });

  test("REQ-1069 no lawn / garden / tree / pool business gets hardscape copy, in English or Spanish", () => {
    const names = [
      "Ruiz Lawn & Pool Care",
      "Blue Pool Service",
      "Green Lawn Mowing",
      "Jardinería López",
      "Rivera Tree Service",
      "Pasto Verde",
      "Garden Helpers",
    ];
    const bad = names.filter((n) => HARDSCAPE.test(sampleText(n)));
    expect(bad).toEqual([]);
  });

  test("REQ-1069 the new pool and lawncare trades exist with prices and their three keys in both dictionaries", () => {
    for (const trade of ["pool", "lawncare"]) {
      expect(SAMPLE_TRADES as readonly string[]).toContain(trade);
      const t = trade as (typeof SAMPLE_TRADES)[number];
      const [materials, labor] = SAMPLE_PRICES[t] ?? [0, 0];
      expect([trade, materials > 0 && labor > 0]).toEqual([trade, true]);
      for (const k of Object.values(sampleQuoteKeys(t))) {
        expect([k, typeof en[k], typeof es[k]]).toEqual([k, "string", "string"]);
        expect(es[k]).not.toBe(en[k]);
        expect(`${en[k]} ${es[k]}`).not.toMatch(HARDSCAPE);
      }
    }
  });

  test("REQ-1069 the trade kind agrees with the sample: a lawn & pool business is a SERVICE trade (REQ-343)", () => {
    for (
      const n of ["Ruiz Lawn & Pool Care", "Blue Pool Service", "Jardinería López"]
    ) {
      expect([n, tradeKindFor(n)]).toEqual([n, "service"]);
    }
  });
});
