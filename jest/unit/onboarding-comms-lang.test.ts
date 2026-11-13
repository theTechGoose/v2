/**
 * REQ-348 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m34: a contractor who signed up from the
 * Spanish landing page met no EN/ES switch in onboarding, and Settings →
 * "Languages you send in" showed English alone.
 *
 * RCA (m34): nothing wrote `identity.commsLanguages` at signup/onboarding —
 * Settings fell back to `[commsLanguage ?? "en"]` and never consulted the
 * contractor's own language (user.language). The rule now lives in ONE place,
 * shared/quote-flow/comms-language.ts:
 *   - defaultCommsLanguages(userLanguage): es → ["en", "es"] ("Spanish in,
 *     English out" — they can send in both, English first), else ["en"]
 *   - sendLanguagesOf(identity, userLanguage): the stored list, else the
 *     legacy single commsLanguage, else the default from user.language
 *   - commsLanguagesSeed(existing, patch, userLanguage): what the backend
 *     writes on an identity write that leaves the set unset
 */
import * as fs from "fs";
import * as path from "path";
import {
  commsLanguagesSeed,
  defaultCommsLanguages,
  sendLanguagesOf,
} from "../../shared/quote-flow/comms-language";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-348 the languages a contractor sends in default from their own language (demo m34)", () => {
  test("REQ-348 a Spanish-speaking contractor defaults to English AND Spanish; anyone else to English", () => {
    expect(defaultCommsLanguages("es")).toEqual(["en", "es"]);
    expect(defaultCommsLanguages("en")).toEqual(["en"]);
    expect(defaultCommsLanguages(undefined)).toEqual(["en"]);
    expect(defaultCommsLanguages(" ES ")).toEqual(["en", "es"]);
  });

  test("REQ-348 a stored set wins; else the legacy single language; else the default from user.language", () => {
    expect(sendLanguagesOf({ commsLanguages: ["es"] }, "en")).toEqual(["es"]);
    expect(sendLanguagesOf({ commsLanguage: "es" }, "en")).toEqual(["es"]);
    expect(sendLanguagesOf(null, "es")).toEqual(["en", "es"]);
    expect(sendLanguagesOf({ commsLanguages: [] }, "es")).toEqual([
      "en",
      "es",
    ]);
    expect(sendLanguagesOf(undefined, undefined)).toEqual(["en"]);
  });

  test("REQ-348 the seed fills an unset set from user.language and never overrides a choice", () => {
    // first write by a Spanish signup (the wizard's business name)
    expect(commsLanguagesSeed(null, { businessName: "Techos" }, "es"))
      .toEqual(["en", "es"]);
    expect(commsLanguagesSeed(null, {}, "en")).toEqual(["en"]);
    // a pre-existing record that never got a set
    expect(commsLanguagesSeed({ businessName: "x" }, {}, "es"))
      .toEqual(["en", "es"]);
    // the person picked — nothing to seed
    expect(commsLanguagesSeed(null, { commsLanguages: ["es"] }, "es"))
      .toBeUndefined();
    expect(commsLanguagesSeed({ commsLanguages: ["en"] }, {}, "es"))
      .toBeUndefined();
    // a legacy single choice stands
    expect(commsLanguagesSeed({ commsLanguage: "en" }, {}, "es"))
      .toBeUndefined();
    expect(commsLanguagesSeed(null, { commsLanguage: "es" }, "en"))
      .toBeUndefined();
  });

  test("REQ-348 Settings and the wizard read the one rule — no private ['en'] fallback", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/sendLanguagesOf\(/);
    expect(settings).not.toMatch(/\[snapshot\.identity\?\.commsLanguage \?\? "en"\]/);
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    // REQ-498: via onboardingSendLanguages, which reads sendLanguagesOf
    expect(wizard).toMatch(/onboardingSendLanguages\(/);
    expect(wizard).toMatch(/commsLanguages:/);
  });

  test("REQ-348 the backend seeds the set on the identity write", () => {
    const ctl = read(
      "backend/src/users/entrypoints/business-identity-controller/mod.ts",
    );
    expect(ctl).toMatch(/commsLanguagesSeed\(/);
  });
});
