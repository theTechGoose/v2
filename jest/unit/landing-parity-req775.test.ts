/**
 * REQ-775 — demo-loop cycle dv1, issue d2: "Spanish and English landing pages
 * make the same promises". Raphael: "Spanish and English landing pages should
 * say pretty much the same thing, even though they don't translate as much."
 *
 * The root page "/" paints every claim from ONE dictionary
 * (front-end/lib/landing-dict.ts). Wording may be adapted per language, but no
 * claim may exist in one language only and none may contradict the other.
 * The demo read EN "in their language" next to ES "en inglés perfecto".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const enJson = JSON.parse(read("lang/en.json")) as Record<string, string>;
const esJson = JSON.parse(read("lang/es.json")) as Record<string, string>;
// deno-lint-ignore no-explicit-any
const { LANDING_DICT } = require("../../front-end/lib/landing-dict") as any;
const EN = LANDING_DICT.en as Record<string, string>;
const ES = LANDING_DICT.es as Record<string, string>;

describe("REQ-775 (dv1 d2) / says the same thing in English and Spanish", () => {
  test("REQ-775 every landing key exists in both languages (no one-language claim)", () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
    for (const k of Object.keys(EN)) {
      expect([k, ES[k].trim().length > 0]).toEqual([k, true]);
    }
  });

  test("REQ-775 numbers, prices and placeholders match key by key", () => {
    // Digits (counts, prices, days) and {placeholders} are the hard claims;
    // the wording around them may be adapted. Dates/times in the hero mock
    // are formatted per language, so only claim keys are compared.
    const tokens = (s: string) =>
      (s.match(/\{\w+\}|\$?\d[\d,.]*/g) ?? []).map((t) =>
        t.replace(/[.,]$/, "")
      )
        .sort();
    const claimKey =
      /^(hero\.(lead|kicker|trust\w*)|problem|docs\.(lead|eyebrow)|feat|how|demo\.(h2|lead)|price|cta\.(b1|b3|fromPrice|lead|h2)|head\.metaDescription)/;
    const drift: string[] = [];
    for (const k of Object.keys(EN).filter((k) => claimKey.test(k))) {
      if (tokens(EN[k]).join("|") !== tokens(ES[k]).join("|")) {
        drift.push(`${k}: en ${tokens(EN[k])} / es ${tokens(ES[k])}`);
      }
    }
    expect(drift).toEqual([]);
  });

  test("REQ-775 the language promise is the same: talk in either language, clients get their own", () => {
    // EN: "Talk to us in English or Spanish. Everything goes out to your
    // clients in their language, ready to sign."
    expect(EN["hero.lead"]).toMatch(/English or Spanish/);
    expect(EN["hero.lead"]).toMatch(/in their language/);
    expect(EN["hero.lead"]).toMatch(/ready to sign/);
    // ES must promise the same three things — not "Spanish in, perfect
    // English out", which contradicts "in their language".
    expect(ES["hero.lead"]).toMatch(
      /español o (en )?inglés|inglés o (en )?español/,
    );
    expect(ES["hero.lead"]).toMatch(/en su idioma/);
    expect(ES["hero.lead"]).toMatch(/listo para firmar/);
    expect(ES["hero.lead"]).not.toMatch(/inglés perfecto/);
  });

  test("REQ-775 no landing string on / promises Spanish-in / English-out in only one language", () => {
    const oneWayEs = /inglés perfecto|escribes en español, sale en inglés/i;
    const oneWayEn = /perfect English|Spanish in, English out/i;
    const hitsEs = Object.entries(ES).filter(([, v]) => oneWayEs.test(v));
    const hitsEn = Object.entries(EN).filter(([, v]) => oneWayEn.test(v));
    expect(hitsEs).toEqual([]);
    expect(hitsEn).toEqual([]);
  });

  test("REQ-775 the lang/*.json mirror carries the same Spanish lead as the dictionary", () => {
    expect(esJson["landing.hero.lead"]).toBe(ES["hero.lead"]);
    expect(enJson["landing.hero.lead"]).toBe(EN["hero.lead"]);
  });
});
