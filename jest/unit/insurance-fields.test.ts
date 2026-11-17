/**
 * REQ-503 (demo-loop cycle 3, demo m62) — "fix every issue the demo found,
 * loop until there are none". The onboarding wizard took insurer "!!!" and a
 * 120-character policy number (fleet-9). The insurance answers get the same
 * kind of format rule REQ-352 gave the ZIP and the payment handles:
 *
 *  - insurerError: at least two letters, at most 80 characters.
 *  - policyNumberError: letters, digits and dashes, at most 40 characters.
 *
 * Both live in shared/quote-flow/business-fields.ts and are used by the
 * wizard's InsuranceStep, Settings' InsuranceEditCard and the backend DTO.
 */
import * as fs from "fs";
import * as path from "path";
import {
  INSURER_MAX,
  insurerError,
  POLICY_NUMBER_MAX,
  policyNumberError,
} from "../../shared/quote-flow/business-fields.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dict = (lang: string) => JSON.parse(read(`lang/${lang}.json`));

describe("REQ-503 m62: the insurer rule", () => {
  test.each([
    "State Farm",
    "Hartford",
    "AT&T Insurance Co.",
    "Next Insurance (NEXT)",
    "Seguros Atlas",
    "Mapfre España",
    " Progressive ",
    "AB",
  ])("REQ-503 accepts %s", (v) => {
    expect(insurerError(v)).toBeNull();
  });

  test.each(["!!!", "1", "A", "123", "A!", "@@@###", "x".repeat(81)])(
    "REQ-503 refuses %s",
    (v) => {
      expect(insurerError(v)).toBe("welcome.insurance.providerInvalid");
    },
  );

  test("REQ-503 the limits are 80 and 40 characters", () => {
    expect(INSURER_MAX).toBe(80);
    expect(POLICY_NUMBER_MAX).toBe(40);
    expect(insurerError("A".repeat(80))).toBeNull();
  });

  test("REQ-503 a blank insurer is the step's 'required' check, not a format error", () => {
    expect(insurerError("   ")).toBeNull();
    expect(insurerError("")).toBeNull();
  });
});

describe("REQ-503 m62: the policy-number rule", () => {
  test.each(["POL-1234", "12345678", "ab-12-cd", " HX99 ", "9".repeat(40)])(
    "REQ-503 accepts %s",
    (v) => {
      expect(policyNumberError(v)).toBeNull();
    },
  );

  test.each([
    "1".repeat(120),
    "9".repeat(41),
    "POL 1234",
    "POL#1234",
    "!!!",
    "---",
    "pol_1234",
  ])("REQ-503 refuses %s", (v) => {
    expect(policyNumberError(v)).toBe("welcome.insurance.policyInvalid");
  });

  test("REQ-503 a blank policy number is fine (it is optional)", () => {
    expect(policyNumberError("")).toBeNull();
    expect(policyNumberError("  ")).toBeNull();
  });
});

describe("REQ-503: the messages are in both dictionaries", () => {
  test.each(["en", "es"])("REQ-503 %s carries them", (lang) => {
    const d = dict(lang);
    for (
      const k of [
        "welcome.insurance.providerInvalid",
        "welcome.insurance.policyInvalid",
      ]
    ) expect([k, typeof d[k]]).toEqual([k, "string"]);
  });
});

describe("REQ-503: every surface that saves insurance uses the rules", () => {
  test("REQ-503 the wizard's InsuranceStep gates Continue on both rules", () => {
    const src = read("front-end/islands/WelcomeWizard.tsx");
    const step = src.slice(src.indexOf("function InsuranceStep"));
    const body = step.slice(0, step.indexOf("\nfunction ", 10));
    expect(body).toContain("insurerError(provider)");
    expect(body).toContain("policyNumberError(policyNumber)");
    expect(body).not.toMatch(/const valid = provider\.trim\(\)\.length > 0;/);
  });

  test("REQ-503 Settings' InsuranceEditCard checks both before saving", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    const card = src.slice(src.indexOf("function InsuranceEditCard"));
    const body = card.slice(0, card.indexOf("\nfunction ", 10));
    expect(body).toContain("insurerError(");
    expect(body).toContain("policyNumberError(");
  });

  test("REQ-503 the backend DTO enforces both", () => {
    const src = read("backend/src/users/dto/business-insurance.ts");
    expect(src).toMatch(/INSURER_PATTERN/);
    expect(src).toMatch(/POLICY_NUMBER_PATTERN/);
    expect(src).toMatch(/@MaxLength\(INSURER_MAX\)/);
    expect(src).toMatch(/@MaxLength\(POLICY_NUMBER_MAX\)/);
  });
});
