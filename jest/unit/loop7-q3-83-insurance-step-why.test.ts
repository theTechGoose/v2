/**
 * REQ-1151 — LOOP-007 cycle 3, issue q3-83 [minor/BUG_CONTRADICTION]: "Wizard
 * insurance step promises attaching proof but has no upload".
 *
 * The /welcome insurance step shows `welcome.insurance.why` — "Lets you attach
 * proof of insurance to your quotes." / "Te permite adjuntar comprobante de
 * seguro a tus cotizaciones." — but InsuranceStep
 * (front-end/islands/WelcomeWizard.tsx) renders only the provider and the
 * policy-number text boxes: no file input. The certificate upload exists only
 * in Settings (InsuranceEditCard), and no quote surface (PDF, /q, email) reads
 * any insurance data. The "why" line must only promise what the step (and the
 * product) does — unless the step itself grows a file input.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** InsuranceStep's own source, from its declaration to the next top-level function */
function insuranceStepSource(): string {
  const src = read("front-end/islands/WelcomeWizard.tsx");
  const start = src.indexOf("function InsuranceStep(");
  if (start < 0) throw new Error("InsuranceStep not found in WelcomeWizard.tsx");
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export\s+)?(?:async\s+)?function\s/);
  return next < 0 ? rest : rest.slice(0, next);
}

const stepHasUpload = () => /type=["{]?["']?file/.test(insuranceStepSource());

describe("REQ-1151 (q3-83) the wizard insurance step promises only what it does", () => {
  test("REQ-1151 en: welcome.insurance.why does not promise attaching proof to quotes when the step has no file input", () => {
    const why = en["welcome.insurance.why"];
    expect(typeof why).toBe("string");
    if (!stepHasUpload()) {
      expect(why).not.toMatch(/attach/i);
      expect(why).not.toMatch(/proof of insurance to your quotes/i);
    }
  });

  test("REQ-1151 es: welcome.insurance.why does not promise adjuntar comprobante a las cotizaciones when the step has no file input", () => {
    const why = es["welcome.insurance.why"];
    expect(typeof why).toBe("string");
    if (!stepHasUpload()) {
      expect(why).not.toMatch(/adjuntar/i);
      expect(why).not.toMatch(/comprobante de seguro a tus cotizaciones/i);
    }
  });
});
