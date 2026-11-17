/**
 * REQ-708 (demo-loop cycle 5, c1-setup-m15) — the /contact form's own
 * per-field rule, so the form can be novalidate and say what is wrong under
 * each field in-app (the browser's bubble cannot be shown on the demo stage).
 * Mirrors the backend ContactDto: name, subject and message are required, the
 * email must be an address (REQ-050's shape). The phone stays optional.
 */
import { isValidCustomerEmail } from "../../shared/quote-flow/customer-contact.ts";

export interface ContactFormErrors {
  name?: "contactPage.errName";
  email?: "contactPage.errEmail";
  subject?: "contactPage.errSubject";
  message?: "contactPage.errMessage";
}

export function contactFormErrors(form: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): ContactFormErrors {
  const out: ContactFormErrors = {};
  if (!form.name.trim()) out.name = "contactPage.errName";
  if (!isValidCustomerEmail(form.email)) out.email = "contactPage.errEmail";
  if (!form.subject.trim()) out.subject = "contactPage.errSubject";
  if (!form.message.trim()) out.message = "contactPage.errMessage";
  return out;
}
