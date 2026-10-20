// REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
// hello@documonster.com". Pure: the email a new account generates — to the one address, naming
// how they signed up and what the account carries. No env, no KV.
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { User } from "@users/dto/user.ts";
import { SIGNUP_INBOX, signupNoticeEmail } from "./mod.ts";

const at = "2026-10-20T15:04:05.000Z";
const byPhone: User = {
  id: "u-103",
  phoneNumber: "+15125550103",
  language: "es",
  name: "Nuevo usuario",
  createdAt: at,
  updatedAt: at,
};
const byEmail: User = {
  id: "u-104",
  phoneNumber: "",
  email: "ana@tunegocio.com",
  language: "en",
  name: "New user",
  createdAt: at,
  updatedAt: at,
};

Deno.test("REQ-103 signupNoticeEmail — every sign-up is an email to hello@documonster.com, and no env var has a say", () => {
  assertEquals(SIGNUP_INBOX, "hello@documonster.com");
  assertEquals(signupNoticeEmail(byPhone).to, "hello@documonster.com");
  assertEquals(signupNoticeEmail(byEmail).to, "hello@documonster.com");
});

Deno.test("REQ-103 signupNoticeEmail — a phone sign-up: the subject names the phone, the body says how, the phone, the language, the id and the time, and never the placeholder name", () => {
  const mail = signupNoticeEmail(byPhone);
  assertEquals(mail.subject, "New DocuMonster signup — +15125550103");
  assertStringIncludes(mail.htmlBody, "by phone");
  assertStringIncludes(mail.htmlBody, "<strong>Phone:</strong> +15125550103");
  assertStringIncludes(mail.htmlBody, "<strong>Language:</strong> es");
  assertStringIncludes(mail.htmlBody, "<strong>User ID:</strong> u-103");
  assertStringIncludes(mail.htmlBody, `<strong>Signed up:</strong> ${at}`);
  assert(
    !mail.htmlBody.includes("Nuevo usuario"),
    "the placeholder name is not a fact about the person",
  );
  assert(!mail.htmlBody.includes("Email:"), "no empty email line");
});

Deno.test("REQ-103 signupNoticeEmail — an email sign-up (no phone, REQ-050): the subject names the address, the body says email and prints no empty phone", () => {
  const mail = signupNoticeEmail(byEmail);
  assertEquals(mail.subject, "New DocuMonster signup — ana@tunegocio.com");
  assertStringIncludes(mail.htmlBody, "by email");
  assertStringIncludes(
    mail.htmlBody,
    "<strong>Email:</strong> ana@tunegocio.com",
  );
  assertStringIncludes(mail.htmlBody, "<strong>Language:</strong> en");
  assert(!mail.htmlBody.includes("Phone:"), "no empty phone line");
});
