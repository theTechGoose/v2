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
