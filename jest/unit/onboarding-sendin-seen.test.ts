/**
 * REQ-498 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue m42: "Onboarding from
 * ?lang=es defaults 'Languages you send in' to English only".
 *
 * RCA (analyst LIKELY, skeptic UPHELD at cc5d4b0e): the business-name step's
 * default was `sendLanguagesOf(identity, ctx.snap.user.language)`, re-derived
 * on every render from the LIVE account language — and the wizard's own EN/ES
 * switch writes snap.user.language. A contractor created in Spanish (?lang=es)
 * who tapped EN on the name step met "English" alone on the next step; the
 * Spanish origin was forgotten.
 *
 * The rule now: the default is seeded from every language the account was in
 * during this onboarding visit — the one it opened in plus each one switched to
 * (`onboardingLanguagesSeen` / `onboardingSendLanguages`). A stored choice
 * still wins.
 */
import * as fs from "fs";
import * as path from "path";
import {
  onboardingLanguagesSeen,
  onboardingSendLanguages,
} from "../../shared/quote-flow/comms-language";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-498 the onboarding send-in default remembers the languages the account was in (demo m42, cycle 3)", () => {
  test("REQ-498 created in Spanish, switched to EN at step 1 → step 2 shows English AND Spanish", () => {
    const seen = onboardingLanguagesSeen(
      onboardingLanguagesSeen([], "es"),
      "en",
    );
    expect(seen).toEqual(["es", "en"]);
    expect(onboardingSendLanguages(null, seen)).toEqual(["en", "es"]);
  });

  test("REQ-498 an English account that never switched sends in English; one that tried ES keeps both", () => {
    expect(onboardingSendLanguages(null, ["en"])).toEqual(["en"]);
    expect(onboardingSendLanguages(null, [])).toEqual(["en"]);
    expect(onboardingSendLanguages(null, onboardingLanguagesSeen(["en"], "es")))
      .toEqual(["en", "es"]);
    expect(onboardingSendLanguages(null, ["es"])).toEqual(["en", "es"]);
  });

  test("REQ-498 the seen list ignores repeats and anything that is not en/es", () => {
    expect(onboardingLanguagesSeen(["es"], "es")).toEqual(["es"]);
    expect(onboardingLanguagesSeen(["es"], "fr")).toEqual(["es"]);
    expect(onboardingLanguagesSeen([], undefined)).toEqual([]);
    expect(onboardingLanguagesSeen([], " ES ")).toEqual(["es"]);
  });

  test("REQ-498 a stored choice still wins over the languages seen", () => {
    expect(onboardingSendLanguages({ commsLanguages: ["es"] }, ["en"]))
      .toEqual(["es"]);
    expect(onboardingSendLanguages({ commsLanguages: ["en"] }, ["es", "en"]))
      .toEqual(["en"]);
    expect(onboardingSendLanguages({ commsLanguage: "es" }, ["en"]))
      .toEqual(["es"]);
  });

  test("REQ-498 the wizard seeds the default from the languages seen — not the live account language", () => {
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    expect(wizard).toMatch(/onboardingSendLanguages\(/);
    expect(wizard).not.toMatch(
      /sendLanguagesOf\(\s*ctx\.snap\.identity,\s*ctx\.snap\.user\.language\s*\)/,
    );
    // the EN/ES switch records the language it moves to
    const switchFn = wizard.slice(wizard.indexOf("function switchLang("));
    expect(switchFn.slice(0, 600)).toMatch(/onboardingLanguagesSeen\(/);
  });
});
