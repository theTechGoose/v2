/**
 * REQ-177 — "put the texting feature behind a feature flag on the account. add a tab called
 * 'accounts' this way we can enable and disable features per account."
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { featureOn, FEATURES, isFeatureKey } from "../../shared/features";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-177 feature flags", () => {
  test("the registry names the texting feature; a flag is on only when the account says true", () => {
    expect(FEATURES.map((f) => f.key)).toContain("fieldTexts");
    expect(FEATURES.every((f) => f.label.length > 0 && f.hint.length > 0)).toBe(
      true,
    );
    expect(featureOn(undefined, "fieldTexts")).toBe(false);
    expect(featureOn({}, "fieldTexts")).toBe(false);
    expect(featureOn({ fieldTexts: false }, "fieldTexts")).toBe(false);
    expect(featureOn({ fieldTexts: true }, "fieldTexts")).toBe(true);
    expect(isFeatureKey("fieldTexts")).toBe(true);
    expect(isFeatureKey("superAdmin")).toBe(false);
    expect(isFeatureKey(42)).toBe(false);
  });

  test("the admin page has a Users tab and an Accounts tab, and the Accounts tab renders one switch per registered feature", () => {
    const src = read("front-end/islands/AdminPage.tsx");
    expect(src).toMatch(/data-cy="adm-tab-users"/);
    expect(src).toMatch(/data-cy="adm-tab-accounts"/);
    expect(src).toMatch(/from "\.\.\/\.\.\/shared\/features(\.ts)?"/);
    expect(src).toMatch(/FEATURES\.map\(/);
    expect(src).toMatch(/data-cy=\{`adm-feature-\$\{/);
    expect(src).toMatch(/adminClient\.setFeature\(/);
  });

  test("the admin client puts the flag and the view carries the account's features", () => {
    const src = read("front-end/clients/admin.ts");
    expect(src).toMatch(/features\??: Features/);
    expect(src).toMatch(/setFeature:/);
    expect(src).toMatch(/\/admin\/users\/\$\{id\}\/features/);
  });
});
