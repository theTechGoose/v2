/**
 * PDF p7 — "Add a business name on the Wizard": the "Who is this for?" step
 * currently collects Name / Phone Number / Email (optional). It must also
 * offer a Business Name field.
 *
 * Target: shared/quote-flow/wizard-steps.ts
 */
import { WHO_IS_THIS_FOR_FIELDS } from "../../shared/quote-flow/wizard-steps";

type Field = { key: string; required: boolean };

describe("Who is this for? step schema", () => {
  const byKey = new Map((WHO_IS_THIS_FOR_FIELDS as Field[]).map((f) => [f.key, f]));

  it("keeps the existing name / phone / email fields", () => {
    expect(byKey.has("name")).toBe(true);
    expect(byKey.has("phone")).toBe(true);
    expect(byKey.has("email")).toBe(true);
  });

  it("adds a businessName field", () => {
    expect(byKey.has("businessName")).toBe(true);
  });

  it("businessName is optional — homeowners don't have one", () => {
    expect(byKey.get("businessName")?.required).toBe(false);
  });

  it("email stays optional as labeled in the UI", () => {
    expect(byKey.get("email")?.required).toBe(false);
  });
});
