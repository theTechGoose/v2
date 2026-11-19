/**
 * REQ-978 (LOOP-007 cycle 1, q1-58) — Settings → "Edit your details" promises "saved instantly",
 * but an out-of-range number was put back silently on blur: -5 days to pay snapped back to 45,
 * 500 in % overhead became 0, a negative chargeback fee snapped back — no message, no save.
 * The number fields must follow REQ-501's pattern: a pure rule in
 * shared/quote-flow/settings-fields.ts returns an i18n key, the card shows it inline under the
 * field (aria-invalid) and keeps the typed value instead of the silent revert.
 */
import * as fs from "fs";
import * as path from "path";
import * as fields from "../../shared/quote-flow/settings-fields";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

type Rule = (...a: unknown[]) => string | null;
const rule = (name: string): Rule => {
  const fn = (fields as Record<string, unknown>)[name];
  if (typeof fn !== "function") {
    throw new Error(
      `shared/quote-flow/settings-fields.ts has no ${name}() — the number fields have no rule`,
    );
  }
  return fn as Rule;
};
const expectKey = (key: string | null, what: string) => {
  expect({ what, key }).toEqual({ what, key: expect.any(String) });
  expect({ what, key, en: en[key as string] }).toEqual({
    what,
    key,
    en: expect.any(String),
  });
  expect({ what, key, es: es[key as string] }).toEqual({
    what,
    key,
    es: expect.any(String),
  });
};

describe("REQ-978 q1-58 Settings number fields refuse bad input with a message", () => {
  test("REQ-978 netDaysError: -5, 366, 1.5, blank, 'abc' → an en+es key; 0, 45, 365 → null", () => {
    const netDaysError = rule("netDaysError");
    for (const bad of ["-5", "366", "1.5", "", "  ", "abc"]) {
      expectKey(netDaysError(bad), `netDays ${JSON.stringify(bad)}`);
    }
    for (const ok of ["0", "45", "365", " 30 "]) {
      expect({ ok, err: netDaysError(ok) }).toEqual({ ok, err: null });
    }
  });

  test("REQ-978 overheadError: % mode 500, 101, -1, blank → an en+es key; 0, 12.5, 100 → null", () => {
    const overheadError = rule("overheadError");
    for (const bad of ["500", "101", "-1", ""]) {
      expectKey(overheadError(bad, "percent"), `overhead % ${bad}`);
    }
    for (const ok of ["0", "12.5", "100"]) {
      expect({ ok, err: overheadError(ok, "percent") }).toEqual({
        ok,
        err: null,
      });
    }
  });

  test("REQ-978 overheadError: $ mode -1, blank → an en+es key; 0, 25.50, 500 → null", () => {
    const overheadError = rule("overheadError");
    for (const bad of ["-1", ""]) {
      expectKey(overheadError(bad, "flat"), `overhead $ ${bad}`);
    }
    for (const ok of ["0", "25.50", "500"]) {
      expect({ ok, err: overheadError(ok, "flat") }).toEqual({ ok, err: null });
    }
  });

  test("REQ-978 moneyError (chargeback fee): -1, blank, 'abc' → an en+es key; 0, 35 → null", () => {
    const moneyError = rule("moneyError");
    for (const bad of ["-1", "", "abc"]) {
      expectKey(moneyError(bad), `money ${bad}`);
    }
    for (const ok of ["0", "35", "35.00"]) {
      expect({ ok, err: moneyError(ok) }).toEqual({ ok, err: null });
    }
  });

  const src = read("front-end/islands/SettingsPage.tsx");

  test("REQ-978 the Settings card asks the rules on blur and renders each error under its field", () => {
    expect(src).toMatch(/netDaysError\(/);
    expect(src).toMatch(/overheadError\(/);
    expect(src).toMatch(/moneyError\(/);
    expect(src).toMatch(/data-cy="settings-net-days-error"/);
    expect(src).toMatch(/data-cy="settings-overhead-error"/);
    expect(src).toMatch(/data-cy="settings-chargeback-fee-error"/);
    expect((src.match(/aria-invalid=/g) ?? []).length).toBeGreaterThanOrEqual(
      5, // email + business name (REQ-501) + the three number fields
    );
  });

  test("REQ-978 a bad blur no longer silently puts the stored value back", () => {
    // the q1-58 silent reverts: restore the stored value, return, nothing shown
    expect(src).not.toMatch(
      /n > 365\)\s*\{\s*setNetDays\(\s*String\(accountNetDays/,
    );
    expect(src).not.toMatch(
      /pct > 100\s*\)\s*\{\s*setOverhead\(String\(current\)\);\s*return;/,
    );
    expect(src).not.toMatch(
      /cents < 0\s*\)\s*\{\s*setOverhead\(\(current \/ 100\)\.toFixed\(2\)\);\s*return;/,
    );
    expect(src).not.toMatch(
      /cents < 0\) \{\s*setCbFee\(\(savedCbFee \/ 100\)\.toFixed\(2\)\);\s*return;/,
    );
  });
});
