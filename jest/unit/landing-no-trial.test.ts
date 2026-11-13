/**
 * REQ-505 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 3 (run re05e1cbb), issue m5 — "Landing
 * promises a 30-day free trial; plan step charges $99 today".
 *
 * RCA (CONFIRMED / UPHELD at cc5d4b0e): LANDING_OFFER.trialDays = 30 fed
 * "Try Monster free for {d} days" (front-end/lib/landing-dict.ts), the /landing
 * badge + H2 + CTA ("{d} days free", "Try DocuMonster FREE for {d} Days",
 * "Start My Free Trial"), while billing has no trial: the plan step reads
 * "{due} today · prorated on the 1st · then {monthly}/month".
 *
 * Fix: no landing string promises a trial; the offer has no trialDays; the copy
 * says what billing does (Monster Free is free, paid plans are monthly, cancel
 * anytime).
 */
import * as fs from "fs";
import * as path from "path";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** A trial claim, en or es. Deliberately not "free" / "gratis" alone — Monster
 *  Free is a real free plan — nor "frees up" / "Prueba con …". */
const TRIAL_RE =
  /\btrials?\b|\{d\}|\bdays? free\b|free for \d+ days|free for \{d\}|prueba gratis|periodo de prueba|\bd[ií]as gratis\b|gratis por \d+|gratis por \{d\}/i;

/** Every landing namespace in lang/*.json (/landing, the alt landings). */
const LANDING_NS = /^(promoLanding|landing\d*)\./;

function langLanding(lang: "en" | "es"): [string, string][] {
  const dict = JSON.parse(read(`lang/${lang}.json`)) as Record<string, unknown>;
  return Object.entries(dict)
    .filter(([k, v]) => LANDING_NS.test(k) && typeof v === "string")
    .map(([k, v]) => [k, v as string]);
}

describe("REQ-505 (demo cycle 3, m5) no landing string promises a free trial", () => {
  it("REQ-505 the root landing dictionary (en + es) carries no trial claim", () => {
    for (const lang of ["en", "es"] as const) {
      const hits = Object.entries(LANDING_DICT[lang])
        .filter(([, v]) => TRIAL_RE.test(v))
        .map(([k, v]) => `${lang} ${k}: ${v}`);
      expect(hits).toEqual([]);
    }
  });

  it("REQ-505 the /landing + alt-landing lang keys (en + es) carry no trial claim", () => {
    for (const lang of ["en", "es"] as const) {
      const entries = langLanding(lang);
      expect(entries.length).toBeGreaterThan(20);
      const hits = entries
        .filter(([, v]) => TRIAL_RE.test(v))
        .map(([k, v]) => `${lang} ${k}: ${v}`);
      expect(hits).toEqual([]);
    }
  });

  it("REQ-505 LANDING_OFFER has no trialDays — billing has no trial to advertise", () => {
    const { LANDING_OFFER } = require("../../shared/quote-flow/landing-offers");
    expect("trialDays" in LANDING_OFFER).toBe(false);
  });

  it("REQ-505 no page, script or admin echo fills a trial-days placeholder", () => {
    for (
      const f of [
        "front-end/routes/index.tsx",
        "front-end/routes/landing.tsx",
        "front-end/static/landing-scripts.js",
        "backend/src/users/entrypoints/admin-controller/mod.ts",
      ]
    ) {
      expect({ f, trialDays: read(f).includes("trialDays") }).toEqual({
        f,
        trialDays: false,
      });
    }
  });

  it("REQ-505 the pricing note matches billing: paid plans are monthly, cancel anytime", () => {
    expect(LANDING_DICT.en["price.plans.terms"]).toMatch(/cancel anytime/i);
    expect(LANDING_DICT.es["price.plans.terms"]).toMatch(
      /cancela cuando quieras/i,
    );
    expect(LANDING_DICT.en["price.plans.trial"]).toBeUndefined();
    expect(LANDING_DICT.es["price.plans.trial"]).toBeUndefined();
  });
});
