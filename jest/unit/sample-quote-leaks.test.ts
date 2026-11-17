/**
 * REQ-360 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m11: "Onboarding sample quote looks like
 * real data (in search with Resend) and doesn't fit the trade".
 *
 * The demo saw, in its own words:
 *   - global search for "roof" listed "Roof Shingle Replacement #9876481D
 *     $8,000.00 Draft" — the onboarding sample — next to the real Q-001;
 *   - /quotes "Drafting · 0 quotes" with a SAMPLE card under it;
 *   - the sample card's back offered "Resend" for a quote never sent (and the
 *     Resend button did nothing on any card);
 *   - a junk-removal business got the general "Home Repair Visit" sample.
 *
 * RCA (cycle 1, m11): the isSample flag (P-15) is honoured by the dashboard
 * aggregates only. shared/documents/search.ts never learned about it, so the
 * unnumbered sample became a row with docNumberOf's "#<id>" fallback; the
 * Drafting track never got the "+ sample" note the Out track has; QuoteCard's
 * back face rendered Resend (onClick = stopPropagation only) and Copy link on
 * every card; REQ-256's trade table knew seven trades.
 */
import * as fs from "fs";
import * as path from "path";
import { searchRecords } from "../../shared/documents/search";
import {
  inferSampleTrade,
  SAMPLE_TRADES,
  sampleQuoteKeys,
} from "../../shared/quote-flow/sample-quote";
import { sampleTrackCounts } from "../../front-end/lib/headline-counts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const customers = [{ id: "c1", number: "C-001", name: "Tom Reyes" }];
const realQuote = {
  id: "q-real",
  number: "Q-001",
  seq: 1,
  customerId: "c1",
  summary: "Roof leak repair",
  jobName: "Roof Leak Repair",
  status: "sent",
  estimatedTotal: 120000,
};
// what EnsureSampleQuote stores: flagged, unnumbered, a draft, no customer
const sample = {
  id: "9876481d-aaaa-bbbb-cccc-000000000000",
  isSample: true,
  summary: "Roof Shingle Replacement",
  jobName: "Roof Shingle Replacement",
  status: "draft",
  estimatedTotal: 800000,
};
// a legacy sample: no flag, the old onboarding summary tag
const legacySample = {
  id: "legacy-sample",
  summary: "onboarding-sample-v1 Roof Shingle Replacement",
  jobName: "Roof Shingle Replacement",
  status: "sent",
  estimatedTotal: 800000,
};
const data = {
  customers,
  quotes: [realQuote, sample, legacySample],
  invoices: [],
};

describe("REQ-360 (m11) the onboarding sample never shows up in global search", () => {
  test("REQ-360 'roof' finds the real Q-001 and not the sample (flagged or legacy-tagged); no '#<id>' row", () => {
    const hits = searchRecords(data, "roof");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("q-real");
    expect(ids).not.toContain(sample.id);
    expect(ids).not.toContain(legacySample.id);
    expect(hits.some((h) => /^#/.test(h.number ?? ""))).toBe(false);
  });

  test("REQ-360 the sample's job name, its id prefix and 'draft' find nothing", () => {
    expect(searchRecords(data, "shingle")).toEqual([]);
    expect(searchRecords(data, "9876481D")).toEqual([]);
    expect(
      searchRecords(data, "draft", { types: ["quote"] }).map((h) => h.id),
    ).toEqual([]);
  });

  test("REQ-360 a customer's quote count never counts a sample", () => {
    const withCustomer = {
      ...data,
      quotes: [realQuote, { ...sample, customerId: "c1" }],
    };
    const hit = searchRecords(withCustomer, "Tom Reyes")
      .find((h) => h.type === "customer");
    expect(hit?.counts?.quotes).toBe(1);
  });
});

describe("REQ-360 (m11) /quotes: the Drafting track says the sample is there", () => {
  test("REQ-360 sampleTrackCounts splits real cards from the badged sample", () => {
    expect(sampleTrackCounts([{ isSample: true }])).toEqual({
      real: 0,
      sample: 1,
    });
    expect(sampleTrackCounts([{}, { isSample: true }, {}])).toEqual({
      real: 2,
      sample: 1,
    });
  });

  test("REQ-360 the Drafting track is bound to the sample count, like the Out track", () => {
    const page = read("front-end/islands/QuotesPage.tsx");
    expect(page).toMatch(
      /quotesPage\.track\.drafting"\)[\s\S]{0,400}sampleCount=\{draftCounts\.sample\}/,
    );
    expect(page).toMatch(/sampleCount=\{outCounts\.sample\}/);
  });
});

describe("REQ-360 (m11) the sample fits more trades, in both languages", () => {
  test("REQ-360 junk removal, handyman, fencing, concrete, pest control and moving each get their own job", () => {
    expect(inferSampleTrade("Haul-Away Junk Removal")).toBe("junk");
    expect(inferSampleTrade("Retiro de Basura Ortiz")).toBe("junk");
    expect(inferSampleTrade("Mr. Fix-It Handyman")).toBe("handyman");
    expect(inferSampleTrade("Manitas Pérez")).toBe("handyman");
    expect(inferSampleTrade("Lone Star Fence Co")).toBe("fencing");
    expect(inferSampleTrade("Cercas y Portones Ruiz")).toBe("fencing");
    expect(inferSampleTrade("Solid Concrete LLC")).toBe("concrete");
    expect(inferSampleTrade("Concreto Garza")).toBe("concrete");
    expect(inferSampleTrade("Bug Busters Pest Control")).toBe("pest");
    expect(inferSampleTrade("Control de Plagas Díaz")).toBe("pest");
    expect(inferSampleTrade("Two Guys Moving")).toBe("moving");
    expect(inferSampleTrade("Mudanzas Rápidas")).toBe("moving");
    // the REQ-256 trades still win where they did
    expect(inferSampleTrade("Rivera Plumbing LLC")).toBe("plumbing");
    expect(inferSampleTrade("Sparkle Cleaning")).toBe("cleaning");
    expect(inferSampleTrade("Green Lawn Landscaping")).toBe("landscaping");
    expect(inferSampleTrade("Acme Holdings")).toBe("general");
  });

  test("REQ-360 every new trade has a job name and two line items in EN and ES, distinct from the general job", () => {
    for (
      const trade of [
        "junk",
        "handyman",
        "fencing",
        "concrete",
        "pest",
        "moving",
      ]
    ) {
      expect(SAMPLE_TRADES as readonly string[]).toContain(trade);
      const keys = sampleQuoteKeys(trade as (typeof SAMPLE_TRADES)[number]);
      for (const k of Object.values(keys)) {
        expect([k, typeof en[k], typeof es[k]]).toEqual([
          k,
          "string",
          "string",
        ]);
        expect(es[k]).not.toBe(en[k]);
      }
      expect(en[keys.jobName]).not.toBe(
        en["ensureSampleQuote.general.jobName"],
      );
    }
  });
});
