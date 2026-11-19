/**
 * REQ-708 (demo-loop cycle 5, demo c1-setup-m15) — "fix every issue the demo
 * found, loop until there are none". The New customer modal in Clients says
 * what is wrong under each field (REQ-352), but the New invoice modal's
 * inline new-customer fields still leaned on the browser's own bubble
 * (required name, type=email, no novalidate), which the demo stage cannot
 * show; the public contact form did the same. The pure rules behind the
 * in-app messages:
 *
 *  - newInvoiceFieldErrors (shared/documents/invoice-form.ts): the New
 *    invoice form's per-field rule — the new client's name / phone / email
 *    (customerFormErrors) and the bill-to email.
 *  - contactFormErrors (front-end/lib/contact-form.ts): the /contact form's
 *    per-field rule — name, email, subject, message.
 */
import * as fs from "fs";
import * as path from "path";
import { newInvoiceFieldErrors } from "../../shared/documents/invoice-form.ts";
import { contactFormErrors } from "../../front-end/lib/contact-form.ts";

const ROOT = path.resolve(__dirname, "../..");
const dict = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8"));

describe("REQ-708 c1-setup-m15: the New invoice form's per-field rule", () => {
  test("REQ-708 a new client with 'bob@@gmail' is refused on the email field", () => {
    expect(
      newInvoiceFieldErrors({
        newClient: true,
        name: "Bob",
        phoneNumber: "",
        email: "bob@@gmail",
      }),
    ).toEqual({ email: "customer.invalidEmail" });
  });
  test("REQ-708 a new client with no name, a short phone and a bad email gets one message per field", () => {
    expect(
      newInvoiceFieldErrors({
        newClient: true,
        name: " ",
        phoneNumber: "555-12",
        email: "bob@@gmail",
      }),
    ).toEqual({
      name: "customer.nameRequired",
      phone: "customer.invalidPhone",
      email: "customer.invalidEmail",
    });
  });
  test("REQ-708 the new-client fields are not checked when an existing client (or none) is picked", () => {
    expect(
      newInvoiceFieldErrors({
        newClient: false,
        name: "",
        phoneNumber: "555-12",
        email: "bob@@gmail",
      }),
    ).toEqual({});
  });
  test("REQ-708 the bill-to email is checked with the same email rule; blank is fine", () => {
    expect(
      newInvoiceFieldErrors({ newClient: false, billEmail: "carl@" }),
    ).toEqual({ billEmail: "customer.invalidEmail" });
    expect(newInvoiceFieldErrors({ newClient: false, billEmail: "" }))
      .toEqual({});
    expect(
      newInvoiceFieldErrors({
        newClient: true,
        name: "Bob",
        phoneNumber: "(512) 555-0199",
        email: "bob@gmail.com",
        billEmail: "ap@bob.com",
      }),
    ).toEqual({});
  });
});

describe("REQ-708 c1-setup-m15: the /contact form's per-field rule", () => {
  test("REQ-708 an empty form names every required field", () => {
    expect(
      contactFormErrors({ name: "", email: "", subject: " ", message: "" }),
    ).toEqual({
      name: "contactPage.errName",
      email: "contactPage.errEmail",
      subject: "contactPage.errSubject",
      message: "contactPage.errMessage",
    });
  });
  test("REQ-708 'bob@@gmail' is refused on the email field only", () => {
    expect(
      contactFormErrors({
        name: "Bob",
        email: "bob@@gmail",
        subject: "Hi",
        message: "Hello",
      }),
    ).toEqual({ email: "contactPage.errEmail" });
  });
  test("REQ-708 a filled form has no errors", () => {
    expect(
      contactFormErrors({
        name: "Bob",
        email: "bob@gmail.com",
        subject: "Hi",
        message: "Hello",
      }),
    ).toEqual({});
  });
  test("REQ-708 every contact message exists in en and es", () => {
    for (const lang of ["en", "es"]) {
      const d = dict(lang);
      for (
        const k of [
          "contactPage.errName",
          "contactPage.errEmail",
          "contactPage.errSubject",
          "contactPage.errMessage",
        ]
      ) {
        expect(typeof d[k]).toBe("string");
        expect(d[k].length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * REQ-995 (LOOP-007 cycle 1, q1-80) — AMENDMENT to REQ-708: the New repeat
 * visit form on /field/subscriptions still left an empty service address to
 * the browser's own "Please fill out this field." bubble (no noValidate on
 * the subs-form), and its in-app empty-address branch set the error to the
 * placeholder example ("Ej: 123 Main St, Springfield") instead of saying the
 * address is needed.
 */
describe("REQ-995 q1-80: the New repeat visit form says an empty address in-app", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "front-end/islands/FieldSubscriptionsPage.tsx"),
    "utf8",
  );
  test("REQ-995 the subs-form <form> is noValidate — no browser bubble", () => {
    const tag = src.match(/<form\b[^>]*data-cy="subs-form"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag![0]).toMatch(/\bnoValidate\b/);
  });
  test("REQ-995 field.subs.addressRequired exists in en and es and is not the placeholder example", () => {
    for (const lang of ["en", "es"]) {
      const d = dict(lang);
      expect(typeof d["field.subs.addressRequired"]).toBe("string");
      expect(d["field.subs.addressRequired"].length).toBeGreaterThan(0);
      expect(d["field.subs.addressRequired"]).not.toBe(
        d["field.subs.addressPh"],
      );
    }
  });
  test("REQ-995 the empty-address check uses field.subs.addressRequired, never the placeholder as an error", () => {
    expect(src).toContain('"field.subs.addressRequired"');
    // the placeholder example is only ever a placeholder, never an error text
    const uses = [...src.matchAll(/(\w+)\s*[:=]\s*t\("field\.subs\.addressPh"\)/g)]
      .map((m) => m[1]);
    expect(uses.filter((k) => k !== "placeholder")).toEqual([]);
  });
});
