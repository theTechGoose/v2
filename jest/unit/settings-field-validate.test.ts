/**
 * REQ-501 (demo-loop cycle 3, M35) — Settings saved the email "carl@@jensen" and an empty
 * business name on blur, with no check; the hero then rendered "" because `??` does not skip an
 * empty string. One rule (shared/quote-flow/settings-fields.ts) is asked by the Settings card on
 * blur and by the backend on PUT /me and PUT /profile/identity.
 */
import * as fs from "fs";
import * as path from "path";
import {
  accountEmailError,
  businessNameError,
} from "../../shared/quote-flow/settings-fields";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-501 M35 Settings field validation", () => {
  test("accountEmailError: malformed → customer.invalidEmail; valid or blank (clear) → null", () => {
    for (
      const bad of ["carl@@jensen", "carl@", "carl@jensen", "carl jensen@x.com"]
    ) {
      expect(accountEmailError(bad)).toBe("customer.invalidEmail");
    }
    expect(accountEmailError("carl@jensen.com")).toBeNull();
    expect(accountEmailError("  carl@jensen.com ")).toBeNull();
    expect(accountEmailError("")).toBeNull();
    expect(accountEmailError("   ")).toBeNull();
    expect(accountEmailError(undefined)).toBeNull();
  });

  test("businessNameError: blank once a name is set → welcome.nameBlank; otherwise null", () => {
    expect(businessNameError("", "Jensen Roofing")).toBe("welcome.nameBlank");
    expect(businessNameError("   ", "Jensen Roofing")).toBe(
      "welcome.nameBlank",
    );
    expect(businessNameError("Jensen & Sons", "Jensen Roofing")).toBeNull();
    expect(businessNameError("", undefined)).toBeNull();
    expect(businessNameError("", "")).toBeNull();
    expect(businessNameError(undefined, "Jensen Roofing")).toBeNull();
  });

  test("the copy exists in both languages", () => {
    for (const d of [en, es]) {
      expect(d["customer.invalidEmail"]).toBeTruthy();
      expect(d["welcome.nameBlank"]).toBeTruthy();
    }
  });

  const src = read("front-end/islands/SettingsPage.tsx");

  test("the Settings card checks the email and the business name before it saves on blur", () => {
    expect(src).toMatch(/accountEmailError\(email\)/);
    expect(src).toMatch(/businessNameError\(\s*biz,/);
    expect(src).toMatch(/data-cy="settings-email-error"/);
    expect(src).toMatch(/data-cy="settings-biz-error"/);
  });

  test("the hero skips an empty business name (|| not ??)", () => {
    expect(src).not.toMatch(/p\.identity\?\.businessName \?\?/);
    expect(src).toMatch(/p\.identity\?\.businessName \|\|/);
  });

  test("the backend asks the same rule", () => {
    expect(read("backend/src/users/dto/user.ts")).toMatch(/accountEmailError/);
    expect(
      read("backend/src/users/entrypoints/business-identity-controller/mod.ts"),
    ).toMatch(/businessNameError/);
  });
});
