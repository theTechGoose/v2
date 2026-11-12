/**
 * REQ-352 (demo-loop cycle 1, demo M38 / setup-m15 / p15-5) — "fix every
 * issue the demo found, loop until there are none". The demo saw only the
 * browser's own bubble for "bob@@gmail", a phone error printed under Email, a
 * silently disabled Add, and the onboarding wizard taking ZIP "7870" and a
 * Zelle handle "asdf". The pure rules behind the in-app messages:
 *
 *  - customerFormErrors (shared/quote-flow/customer-contact.ts): one message
 *    PER FIELD of the New customer modal — name, phone, email.
 *  - zipError / paymentHandleError (shared/quote-flow/business-fields.ts):
 *    the wizard's ZIP and Zelle / Venmo / Cash App handle formats.
 */
import * as fs from "fs";
import * as path from "path";
import { customerFormErrors } from "../../shared/quote-flow/customer-contact.ts";
import {
  isValidUsZip,
  paymentHandleError,
  zipError,
} from "../../shared/quote-flow/business-fields.ts";

const ROOT = path.resolve(__dirname, "../..");
const dict = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8"));

describe("REQ-352 M38: the New customer modal's per-field rule", () => {
  test("REQ-352 an empty name is named, not silently refused", () => {
    expect(customerFormErrors({ name: "  " })).toEqual({
      name: "customer.nameRequired",
    });
  });
  test("REQ-352 a bad phone AND a bad email are each reported on their own field", () => {
    expect(
      customerFormErrors({
        name: "Bob",
        phoneNumber: "555-12",
        email: "bob@@gmail",
      }),
    ).toEqual({
      phone: "customer.invalidPhone",
      email: "customer.invalidEmail",
    });
  });
  test("REQ-352 only the email is wrong → only the email carries a message", () => {
    expect(
      customerFormErrors({
        name: "Bob",
        phoneNumber: "(512) 555-0199",
        email: "bob@@gmail",
      }),
    ).toEqual({ email: "customer.invalidEmail" });
  });
  test("REQ-352 a good customer, and blank optional contacts, have no errors", () => {
    expect(customerFormErrors({ name: "Bob", phoneNumber: "", email: "" }))
      .toEqual({});
    expect(
      customerFormErrors({
        name: "Bob",
        phoneNumber: "5125550199",
        email: "bob@gmail.com",
      }),
    ).toEqual({});
  });
});

describe("REQ-352 M38: the wizard's ZIP rule", () => {
  test.each(["78701", "78701-1234", " 78701 "])("REQ-352 accepts %s", (z) => {
    expect(isValidUsZip(z)).toBe(true);
    expect(zipError(z)).toBeNull();
  });
  test.each(["7870", "787011", "7870a", "78701-12", "abcde"])(
    "REQ-352 refuses %s",
    (z) => {
      expect(isValidUsZip(z)).toBe(false);
      expect(zipError(z)).toBe("welcome.address.zipInvalid");
    },
  );
  test("REQ-352 a blank ZIP is not a format error (the step needs any one field)", () => {
    expect(zipError("")).toBeNull();
  });
});

describe("REQ-352 M38: Zelle / Venmo / Cash App handles", () => {
  test("REQ-352 Zelle takes a phone or an email, never 'asdf'", () => {
    expect(paymentHandleError("zelle", "asdf")).toBe(
      "welcome.payment.invalid.zelle",
    );
    expect(paymentHandleError("zelle", "@bob")).toBe(
      "welcome.payment.invalid.zelle",
    );
    expect(paymentHandleError("zelle", "(512) 555-0199")).toBeNull();
    expect(paymentHandleError("zelle", "bob@gmail.com")).toBeNull();
  });
  test("REQ-352 Venmo takes an @username, a phone or an email", () => {
    expect(paymentHandleError("venmo", "asdf")).toBe(
      "welcome.payment.invalid.venmo",
    );
    expect(paymentHandleError("venmo", "@")).toBe(
      "welcome.payment.invalid.venmo",
    );
    expect(paymentHandleError("venmo", "@bob-roofing")).toBeNull();
    expect(paymentHandleError("venmo", "5125550199")).toBeNull();
    expect(paymentHandleError("venmo", "bob@gmail.com")).toBeNull();
  });
  test("REQ-352 Cash App takes a $cashtag, a phone or an email", () => {
    expect(paymentHandleError("cashapp", "asdf")).toBe(
      "welcome.payment.invalid.cashapp",
    );
    expect(paymentHandleError("cashapp", "$")).toBe(
      "welcome.payment.invalid.cashapp",
    );
    expect(paymentHandleError("cashapp", "$BobRoofing")).toBeNull();
    expect(paymentHandleError("cashapp", "5125550199")).toBeNull();
  });
  test("REQ-352 a blank handle is the 'required' check's job, not a format error", () => {
    expect(paymentHandleError("zelle", "  ")).toBeNull();
  });
});

describe("REQ-352: every message the rules name is in both dictionaries", () => {
  const keys = [
    "customer.nameRequired",
    "customer.invalidPhone",
    "customer.invalidEmail",
    "clientsPage.added",
    "welcome.address.zipInvalid",
    "welcome.payment.invalid.zelle",
    "welcome.payment.invalid.venmo",
    "welcome.payment.invalid.cashapp",
  ];
  test.each(["en", "es"])("REQ-352 %s carries them", (lang) => {
    const d = dict(lang);
    for (const k of keys) expect([k, typeof d[k]]).toEqual([k, "string"]);
    expect(d["clientsPage.added"]).toContain("{name}");
  });
});
