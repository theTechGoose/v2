/**
 * RED (TDD) — landing copy, rotor grammar, and the single landing-offer source.
 *
 * P-16 "Root hero rotates into broken Spanish. 'Nosotros manejamos las contratos /
 *       las papeleo' — the fixed article 'las' only agrees with 2 of 4 rotor words."
 * P-08 "Two landing pages selling contradictory offers … the offer values come from
 *       a single configurable source (admin-editable)."
 * P-60 "/landing ES typos: 'Chatéa con nosotros' … 'Legitimiza' (prefer Legitima),
 *       'crecer tu negocio' anglicism. Desired: 'Chatea', 'Legitima', 'haz crecer
 *       tu negocio'."
 *
 * Expected NEW modules (missing today → intended red "Cannot find module"):
 *
 *   shared/quote-flow/landing-rotor.ts
 *     export interface RotorEntry { article: "el" | "la" | "los" | "las"; word: string }
 *     export const ES_ROTOR: readonly RotorEntry[]
 *       // one entry per real rotor word: los contratos, el papeleo,
 *       // las cotizaciones, las facturas
 *     export function buildRotorPhrase(e: RotorEntry): string  // → "los contratos."
 *     Wiring sites: front-end/routes/index.tsx rotor (~:217-235, data-es attrs) and
 *     front-end/static/landing-scripts.js ES dict "hero.h1b" (today the fixed-article
 *     prefix "Nosotros manejamos las" — must lose the article; each word carries its own).
 *
 *   shared/quote-flow/landing-offers.ts
 *     export const LANDING_OFFER: {
 *       trialDays: number;            // ONE trial claim for both pages
 *       priceFromCents: number;       // "from $99/month" — derives from the cheapest public paid plan
 *       unlimitedTier: string;        // id of the ONE plan sold as "unlimited" (a real plan id)
 *       socialProof: { contractors: number; docsSent: number };
 *     }
 *     export function formatSocialProof(n: number, lang: "en" | "es"): string
 *       // localized grouping: "1,200" (en) / "1.200" (es)
 *     Wiring sites: front-end/routes/index.tsx (hero trust, cf-trust, pricing),
 *     front-end/routes/landing.tsx (trial + pricing), front-end/static/landing-scripts.js
 *     (doc counter), and the admin endpoint GET /api/admin/landing-offers
 *     (see jest/integration/landing-pages.int.test.ts).
 *
 * GROUNDED DEVIATION from the task sheet: the P-60 typos do NOT live in
 * front-end/static/landing-scripts.js — the root page's dict already spells
 * "Chatea con nosotros" / "Legitima tu negocio" correctly. The /landing copy
 * source is lang/es.json (promoLanding.*: step1, subStrong1, metaDescription
 * carry "Chatéa"; pricingStarterBlurb carries "Legitimiza"; closeP carries the
 * bare "a crecer tu negocio"). The copy scan therefore covers BOTH files so the
 * two pages agree — red today via lang/es.json.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ================================================================== */
/* P-16 — rotor grammar                                                */
/* ================================================================== */
describe("P-16 ES rotor words carry their own agreeing article (shared/quote-flow/landing-rotor)", () => {
  // The grammatically correct article for each of the 4 real rotor words
  // (routes/index.tsx ~:217-235: cotizaciones. / contratos. / facturas. / papeleo.)
  const EXPECTED_ARTICLES: Record<string, string> = {
    contratos: "los",
    papeleo: "el",
    cotizaciones: "las",
    facturas: "las",
  };

  it("P-16 ES_ROTOR pairs every real rotor word with its agreeing article", () => {
    const { ES_ROTOR } = require("../../shared/quote-flow/landing-rotor");
    const byWord = new Map<string, string>(
      (ES_ROTOR as Array<{ word: string; article: string }>).map((
        e,
      ) => [e.word, e.article]),
    );
    for (const [word, article] of Object.entries(EXPECTED_ARTICLES)) {
      expect({ word, article: byWord.get(word) }).toEqual({ word, article });
    }
    // A fixed-article implementation ("las" for everything) cannot pass:
    const articles = new Set(byWord.values());
    expect(articles.size).toBeGreaterThan(1);
  });

  it("P-16 ES_ROTOR covers the rotor words actually wired in routes/index.tsx", () => {
    const { ES_ROTOR } = require("../../shared/quote-flow/landing-rotor");
    const src = read("front-end/routes/index.tsx");
    // Matches both today's bare data-es="contratos." and a fixed
    // data-es="los contratos." — the marquee's long data-es never matches.
    const wired = [
      ...src.matchAll(/data-es="(?:(?:el|la|los|las)\s+)?([a-zá-úñ]+)\."/g),
    ].map((m) => m[1]);
    const moduleWords = (ES_ROTOR as Array<{ word: string }>).map((e) =>
      e.word
    );
    for (const w of Object.keys(EXPECTED_ARTICLES)) {
      expect(moduleWords).toContain(w);
    }
    for (const w of wired) expect(moduleWords).toContain(w);
  });

  it('P-16 buildRotorPhrase renders "<article> <word>." — grammatical for EVERY entry', () => {
    const { ES_ROTOR, buildRotorPhrase } = require(
      "../../shared/quote-flow/landing-rotor",
    );
    for (const e of ES_ROTOR) {
      expect(buildRotorPhrase(e)).toBe(`${e.article} ${e.word}.`);
    }
    expect(buildRotorPhrase({ article: "los", word: "contratos" })).toBe(
      "los contratos.",
    );
    expect(buildRotorPhrase({ article: "el", word: "papeleo" })).toBe(
      "el papeleo.",
    );
  });

  it('P-16 the ES hero prefix drops the one-size-fits-none article ("Nosotros manejamos las")', () => {
    // Red today: front-end/static/landing-scripts.js:158
    //   "hero.h1b": "Nosotros manejamos las",
    // Desired: the prefix carries NO article; each rotor word brings its own.
    const scripts = read("front-end/static/landing-scripts.js");
    expect(scripts).not.toContain("Nosotros manejamos las");
  });
});

/* ================================================================== */
/* P-08 — one configurable offer source                                */
/* ================================================================== */
describe("P-08 single landing-offer source (shared/quote-flow/landing-offers)", () => {
  it("P-08 exports ONE offer config: trialDays, priceFromCents, unlimitedTier, socialProof", () => {
    const { LANDING_OFFER } = require("../../shared/quote-flow/landing-offers");
    expect(Number.isInteger(LANDING_OFFER.trialDays)).toBe(true);
    expect(LANDING_OFFER.trialDays).toBeGreaterThanOrEqual(0);
    expect(LANDING_OFFER.priceFromCents).toBeGreaterThan(0);
    expect(typeof LANDING_OFFER.unlimitedTier).toBe("string");
    expect(Number.isInteger(LANDING_OFFER.socialProof?.contractors)).toBe(true);
    expect(LANDING_OFFER.socialProof.contractors).toBeGreaterThan(0);
    expect(Number.isInteger(LANDING_OFFER.socialProof?.docsSent)).toBe(true);
    expect(LANDING_OFFER.socialProof.docsSent).toBeGreaterThan(0);
  });

  it("P-08 the offer DERIVES from the pricing plans (from-price = cheapest public paid plan; unlimitedTier is a public plan id)", () => {
    const { LANDING_OFFER } = require("../../shared/quote-flow/landing-offers");
    const { PUBLIC_PLANS } = require("../../shared/quote-flow/pricing-plans");
    type P = { id: string; priceCents: number };
    const paid = (PUBLIC_PLANS as P[])
      .filter((p) => p.priceCents > 0)
      .sort((a, b) => a.priceCents - b.priceCents)[0];
    expect(paid).toBeDefined();
    // Both pages say "from $99/month" / "desde $99" — one number, one source.
    expect(LANDING_OFFER.priceFromCents).toBe(paid.priceCents);
    expect((PUBLIC_PLANS as P[]).map((p) => p.id)).toContain(
      LANDING_OFFER.unlimitedTier,
    );
  });

  it("P-08 formatSocialProof localizes the counters per language", () => {
    const { formatSocialProof } = require(
      "../../shared/quote-flow/landing-offers",
    );
    expect(formatSocialProof(1200, "en")).toBe("1,200");
    expect(formatSocialProof(1200, "es")).toBe("1.200");
    expect(formatSocialProof(48215, "es")).toBe("48.215");
  });

  it('P-08 routes/index.tsx no longer hardcodes the "34 contractors" weekly counter', () => {
    // Red today: front-end/routes/index.tsx:1020
    //   <strong>34 contractors</strong> signed up this week   (English-only, no data-i18n)
    // Desired: the count comes from LANDING_OFFER.socialProof and the line is i18n-keyed.
    const src = read("front-end/routes/index.tsx");
    expect(src).not.toContain("34 contractors");
  });

  it("P-08 landing-scripts.js no longer hardcodes the 48217 documents-sent counter", () => {
    // Red today: front-end/static/landing-scripts.js:808  `const target = 48217;`
    // Desired: the counter target derives from LANDING_OFFER.socialProof.docsSent
    // (e.g. SSR-injected), not a magic number in a static script.
    const scripts = read("front-end/static/landing-scripts.js");
    expect(scripts).not.toContain("48217");
  });
});

/* ================================================================== */
/* P-60 — /landing Spanish copy (lang/es.json promoLanding.*)          */
/* ================================================================== */
describe("P-60 /landing Spanish copy is correct Spanish", () => {
  const esDict = () =>
    JSON.parse(read("lang/es.json")) as Record<string, string>;

  it('P-60 says "Chatea", never "Chatéa" — and both pages agree', () => {
    // Red today: lang/es.json promoLanding.step1 + promoLanding.subStrong1 +
    // promoLanding.metaDescription all read "Chatéa con nosotros…".
    const esRaw = read("lang/es.json");
    expect(esRaw).not.toContain("Chatéa");
    expect(esDict()["promoLanding.step1"]).toContain("Chatea con nosotros");
    expect(esDict()["promoLanding.subStrong1"]).toContain(
      "Chatea con nosotros",
    );
    // The root page already spells it right ("how.s1.h": "Chatea con nosotros")
    // — it must stay right so the two pages agree.
    expect(read("front-end/static/landing-scripts.js")).not.toContain("Chatéa");
  });

  it('P-60 says "Legitima", not the invented "Legitimiza" — and both pages agree', () => {
    // Red today: lang/es.json promoLanding.pricingStarterBlurb read
    // "Legitimiza tu negocio por menos de lo que cuesta Netflix…". The
    // Netflix pitch is gone (Free now leads with "Facturas ilimitadas"); the
    // invented verb must never come back anywhere in the Spanish dict.
    const esRaw = read("lang/es.json");
    expect(esRaw).not.toContain("Legitimiza");
    expect(esDict()["promoLanding.pricingFreeBlurb"]).toMatch(
      /^Facturas ilimitadas/,
    );
    // Root dict already says "Legitima tu negocio" — must stay that way.
    expect(read("front-end/static/landing-scripts.js")).not.toContain(
      "Legitimiza",
    );
  });

  it('P-60 closing line reads "haz crecer tu negocio" (not the anglicism "a crecer tu negocio")', () => {
    // Red today: lang/es.json promoLanding.closeP =
    // "Dedica más tiempo a crecer tu negocio. Nosotros nos encargamos del papeleo."
    const closeP = esDict()["promoLanding.closeP"];
    expect(closeP).toContain("haz crecer tu negocio");
    expect(closeP).not.toContain("tiempo a crecer");
  });
});
