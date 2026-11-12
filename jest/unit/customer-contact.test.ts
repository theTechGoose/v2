/**
 * REQ-278 (demo M16) — a customer's phone and email are checked when the
 * customer is SAVED, not only when paperwork is sent: "123", "555-12",
 * "512-555-01" and "davis@@gmail" never reach the customer record.
 *
 * One pure rule (shared/quote-flow/customer-contact.ts) serves the backend
 * DTO gate, the assistant's create_new path, the assistant's "Who is this
 * for?" form and the /customers "Add client" modal.
 */
import * as fs from "fs";
import * as path from "path";
import {
  customerContactError,
  customerPhoneE164,
  isValidCustomerEmail,
  isValidCustomerPhone,
} from "../../shared/quote-flow/customer-contact.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-278 M16: customer phone rule", () => {
  test.each(["123", "555-12", "512-555-01", "(512) 555", "22345678901", "+12"])(
    "REQ-278 rejects %s",
    (raw) => {
      expect(isValidCustomerPhone(raw)).toBe(false);
      expect(customerPhoneE164(raw)).toBeNull();
    },
  );

  test.each([
    ["(512) 555-1234", "+15125551234"],
    ["512-555-1234", "+15125551234"],
    ["5125551234", "+15125551234"],
    ["1 512 555 1234", "+15125551234"],
    ["+15125551234", "+15125551234"],
    ["+525512345678", "+525512345678"],
  ])("REQ-278 accepts %s as %s", (raw, e164) => {
    expect(isValidCustomerPhone(raw)).toBe(true);
    expect(customerPhoneE164(raw)).toBe(e164);
  });
});

describe("REQ-278 M16: customer email rule", () => {
  test.each(["davis@@gmail", "carl@", "carl@x", "no-at.com", "a b@c.com"])(
    "REQ-278 rejects %s",
    (raw) => expect(isValidCustomerEmail(raw)).toBe(false),
  );
  test.each(["davis@gmail.com", " Jane@Client.com "])(
    "REQ-278 accepts %s",
    (raw) => expect(isValidCustomerEmail(raw)).toBe(true),
  );
});

describe("REQ-278 M16: customerContactError", () => {
  test("REQ-278 blank contact is not a format error (it is optional here)", () => {
    expect(customerContactError({})).toBeNull();
    expect(customerContactError({ email: "  ", phoneNumber: "" })).toBeNull();
  });
  test("REQ-278 names the bad field with a dictionary key", () => {
    expect(customerContactError({ phoneNumber: "555-12" })).toBe(
      "customer.invalidPhone",
    );
    expect(customerContactError({ email: "davis@@gmail" })).toBe(
      "customer.invalidEmail",
    );
    expect(
      customerContactError({ email: "ok@x.com", phoneNumber: "5125551234" }),
    ).toBeNull();
  });
});

describe("REQ-278 M16: both dictionaries carry the messages", () => {
  for (const lang of ["en", "es"]) {
    test(`REQ-278 lang/${lang}.json has customer.invalidPhone and customer.invalidEmail`, () => {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(typeof dict["customer.invalidPhone"]).toBe("string");
      expect(typeof dict["customer.invalidEmail"]).toBe("string");
      expect(dict["customer.invalidPhone"].length).toBeGreaterThan(0);
    });
  }
});

describe("REQ-278 M16: both customer forms use the shared rule", () => {
  test("REQ-278 AsstChat's create form blocks Next and explains a bad contact", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/customer-contact\.ts"/,
    );
    // REQ-390 amends: the chat form asks the same rule per field
    // (customerStepFeedback, built on customerFormErrors) and Next follows it.
    expect(src).toMatch(/customerStepFeedback\(/);
    expect(src).toMatch(/submitDisabled[^;]*feedback\.canSubmit/s);
  });
  test("REQ-278 the /customers Add modal refuses a bad contact before POST", () => {
    const src = read("front-end/islands/ClientsPage.tsx");
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/quote-flow\/customer-contact\.ts"/,
    );
    // REQ-352 amends: the modal asks the same rule per field
    // (customerFormErrors, through its errorsFor helper) before POST.
    expect(src).toMatch(/customerFormErrors\(/);
    const submit = src.slice(src.indexOf("async function submitAddClient"));
    const check = submit.indexOf("errorsFor(");
    const post = submit.indexOf("clientsClient.create(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(post);
  });
});
