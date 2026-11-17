/**
 * REQ-620 — demo-loop cycle 4, issue p4-p6b ("fix every issue the demo found,
 * loop until there are none"). Onboarding offered "Venmo / Zelle / Cash App /
 * Cheque / Efectivo / ACH / Banco"; Settings offered "Venmo / Cash App / Zelle
 * / PayPal / Check / Direct deposit / Credit card / Cash" — two hard-coded
 * catalogues (WelcomeWizard PAYMENT_METHODS, SettingsPage PAY_ROWS) writing
 * the same identity.acceptedPaymentMethods map under different labels.
 *
 * One catalogue (shared/identity/payment-methods.ts) now feeds both surfaces:
 * the same ids, in the same order, under the same `paymentMethod.*` labels.
 */
import * as fs from "fs";
import * as path from "path";
import {
  PAYMENT_METHOD_CATALOG,
  paymentMethodIds,
} from "../../shared/identity/payment-methods";
import { paymentHandleError } from "../../shared/quote-flow/business-fields";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const WIZARD = read("front-end/islands/WelcomeWizard.tsx");
const SETTINGS = read("front-end/islands/SettingsPage.tsx");

describe("REQ-620 (cycle 4, p4-p6b): one payment-method catalogue for onboarding and Settings", () => {
  it("lists every method the backend accepts, once, in one order", () => {
    expect(paymentMethodIds()).toEqual([
      "venmo",
      "cashapp",
      "zelle",
      "paypal",
      "check",
      "ach",
      "card",
      "cash",
    ]);
  });

  it("labels every method with a paymentMethod.* key present in en and es", () => {
    for (const m of PAYMENT_METHOD_CATALOG) {
      expect(m.labelKey).toMatch(/^paymentMethod\./);
      expect(en[m.labelKey]).toBeTruthy();
      expect(es[m.labelKey]).toBeTruthy();
      if (m.placeholderKey) {
        expect(en[m.placeholderKey]).toBeTruthy();
        expect(es[m.placeholderKey]).toBeTruthy();
      }
    }
  });

  it("the wizard and Settings both render the shared catalogue — no local list", () => {
    for (const src of [WIZARD, SETTINGS]) {
      expect(src).toMatch(
        /from "(\.\.\/)+shared\/identity\/payment-methods\.ts"/,
      );
      expect(src).toMatch(/PAYMENT_METHOD_CATALOG\.map\(/);
    }
    expect(WIZARD).not.toMatch(/const PAYMENT_METHODS\b/);
    expect(SETTINGS).not.toMatch(/const PAY_ROWS\b/);
  });

  it("both surfaces label a method by the catalogue's labelKey, never welcome.payment.method.*", () => {
    expect(WIZARD).not.toMatch(/welcome\.payment\.method\./);
    expect(WIZARD).toMatch(/t\(m\.labelKey\)/);
    expect(SETTINGS).toMatch(/tFor\(lang, r\.labelKey\)/);
    for (const k of Object.keys(en).concat(Object.keys(es))) {
      expect(k.startsWith("welcome.payment.method.")).toBe(false);
    }
  });

  it("the same method reads the same in both languages on both surfaces (ach is not 'ACH / Bank' in one and 'Direct deposit' in the other)", () => {
    const ach = PAYMENT_METHOD_CATALOG.find((m) => m.id === "ach")!;
    expect(en[ach.labelKey]).toBe("Direct deposit");
    expect(es[ach.labelKey]).toBe("Depósito directo");
  });

  it("the wizard can take a PayPal handle: an email, a phone or paypal.me/name — not junk", () => {
    expect(paymentHandleError("paypal", "pay@crew.com")).toBeNull();
    expect(paymentHandleError("paypal", "(512) 555-0142")).toBeNull();
    expect(paymentHandleError("paypal", "paypal.me/crewco")).toBeNull();
    expect(paymentHandleError("paypal", "asdf")).toBe(
      "welcome.payment.invalid.paypal",
    );
    expect(en["welcome.payment.invalid.paypal"]).toBeTruthy();
    expect(es["welcome.payment.invalid.paypal"]).toBeTruthy();
  });
});
