/**
 * REQ-992 (LOOP-007 cycle 1, q1-74) — the customer form took State
 * "Texasssss" and ZIP "ABCDE", saved them, and the composed address
 * "1200 Barton Springs Rd, Austin, Texasssss ABCDE" went onto every invoice,
 * quote and PDF. The form's one rule (shared/customer-form validateCustomerForm,
 * the only source of CustomerFormDialog's errors) must refuse a bad state and
 * a bad ZIP, the same ZIP rule onboarding already uses (REQ-352), and both
 * dictionaries must carry the messages shown under those fields.
 */
import * as fs from "fs";
import * as path from "path";
import {
  emptyCustomerForm,
  validateCustomerForm,
} from "../../shared/customer-form/mod";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const form = (patch: Record<string, string>) => ({
  ...emptyCustomerForm(),
  name: "Ann",
  street: "1200 Barton Springs Rd",
  city: "Austin",
  ...patch,
});

// deno-lint-ignore no-explicit-any
const errs = (patch: Record<string, string>): Record<string, any> =>
  validateCustomerForm(form(patch));

describe("REQ-992 q1-74 the customer form refuses an absurd state and ZIP", () => {
  test.each(["ABCDE", "7870", "787041", "78704-12"])(
    "REQ-992 ZIP %s is refused",
    (zip) => {
      expect(errs({ state: "TX", zip }).zip).toBe("invalid");
    },
  );

  test.each(["Texasssss", "Txx", "ZZ", "Narnia"])(
    "REQ-992 state %s is refused",
    (state) => {
      expect(errs({ state, zip: "78704" }).state).toBe("invalid");
    },
  );

  test("REQ-992 the tester's exact entry — 'Texasssss' + 'ABCDE' — flags both fields", () => {
    const e = errs({ state: "Texasssss", zip: "ABCDE" });
    expect(e.state).toBe("invalid");
    expect(e.zip).toBe("invalid");
  });

  test.each([
    ["TX", "78704"],
    ["tx", "78704-1234"],
    ["Texas", "78704"],
    ["New York", "10001"],
    ["", ""],
  ])("REQ-992 state %p with ZIP %p is accepted", (state, zip) => {
    const e = errs({ state, zip });
    expect(e.state).toBeUndefined();
    expect(e.zip).toBeUndefined();
  });

  test("REQ-992 both dictionaries carry the state and ZIP messages", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      for (const k of ["customerForm.err.stateInvalid", "customerForm.err.zipInvalid"]) {
        expect(typeof dict[k] === "string" && dict[k].trim().length > 0)
          .toBe(true);
      }
    }
  });
});
