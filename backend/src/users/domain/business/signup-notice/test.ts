// REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
// hello@documonster.com". REQ-112 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Send
// new-signup notifications. Whenever someone completes signup for Monster Free, Monster, or
// Monster Assist, automatically send an email to hello@documonster.com. Include all information
// collected, their selected plan, signup status/stage, and payment status where applicable."
// Pure: the email an account generates — to the one address, saying what happened, with
// everything the account has said, its plan, its stage and its payment. No env, no KV.
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { User } from "@users/dto/user.ts";
import type { SignupSnapshot } from "@users/domain/business/signup-progress/mod.ts";
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
const bare = (user: User): SignupSnapshot => ({ user, identity: null, address: null, insurance: null, plan: null });

Deno.test("REQ-103 signupNoticeEmail — every sign-up is an email to hello@documonster.com, and no env var has a say", () => {
  assertEquals(SIGNUP_INBOX, "hello@documonster.com");
  assertEquals(signupNoticeEmail(bare(byPhone), "signed up").to, "hello@documonster.com");
  assertEquals(signupNoticeEmail(bare(byEmail), "signed up").to, "hello@documonster.com");
});

Deno.test("REQ-103/112 signupNoticeEmail — a phone sign-up with nothing answered yet: the subject says what happened, no plan yet and the phone; the body has how it was opened, the stage, the phone, the language, the id and the time — never the placeholder name, never an empty line", () => {
  const mail = signupNoticeEmail(bare(byPhone), "signed up");
  assertEquals(mail.subject, "DocuMonster signup — signed up — no plan yet — +15125550103");
  assertStringIncludes(mail.htmlBody, "<strong>What happened:</strong> signed up");
  assertStringIncludes(mail.htmlBody, "<strong>Opened:</strong> by phone");
  assertStringIncludes(mail.htmlBody, "<strong>Plan:</strong> none yet");
  assertStringIncludes(mail.htmlBody, "<strong>Payment:</strong> none");
  assertStringIncludes(mail.htmlBody, "<strong>Stage:</strong> signed up — nothing answered yet, next the name");
  assertStringIncludes(mail.htmlBody, "<strong>Phone:</strong> +15125550103");
  assertStringIncludes(mail.htmlBody, "<strong>Language:</strong> es");
  assertStringIncludes(mail.htmlBody, "<strong>User ID:</strong> u-103");
  assertStringIncludes(mail.htmlBody, `<strong>Signed up:</strong> ${at}`);
  assert(!mail.htmlBody.includes("Nuevo usuario"), "the placeholder name is not a fact about the person");
  for (const empty of ["Name:", "Email:", "Business:", "Website:", "Address:", "City", "Payment methods:", "Insurance:", "Onboarded:"]) {
    assert(!mail.htmlBody.includes(empty), `no empty ${empty} line`);
  }
});

Deno.test("REQ-103 signupNoticeEmail — an email sign-up (no phone, REQ-050): the subject names the address, the body prints no empty phone", () => {
  const mail = signupNoticeEmail(bare(byEmail), "signed up");
  assertEquals(mail.subject, "DocuMonster signup — signed up — no plan yet — ana@tunegocio.com");
  assertStringIncludes(mail.htmlBody, "<strong>Opened:</strong> by email");
  assertStringIncludes(mail.htmlBody, "<strong>Email:</strong> ana@tunegocio.com");
  assertStringIncludes(mail.htmlBody, "<strong>Language:</strong> en");
  assert(!mail.htmlBody.includes("Phone:"), "no empty phone line");
});

Deno.test("REQ-112 signupNoticeEmail — a completed signup carries everything collected: the person, the business, the website, the address, the payment methods, the insurance, the plan, its payment status, the stage and the dates — escaped", () => {
  const snap: SignupSnapshot = {
    user: { ...byPhone, name: "Ana <García>", email: "ana@roof.test", onboardedAt: "2026-10-21T16:00:00.000Z" },
    identity: { userId: "u-103", businessName: "Ana Roofing & Sons", websiteUrl: "https://ana-roofing.test", logoFileId: "f-1", acceptedPaymentMethods: { cash: { enabled: true }, zelle: { enabled: true, handle: "@ana" }, venmo: { enabled: false } }, createdAt: at, updatedAt: at },
    address: { userId: "u-103", street: "1600 Congress Ave", city: "Austin", state: "TX", postal: "78701", createdAt: at, updatedAt: at },
    insurance: { userId: "u-103", provider: "State Farm", createdAt: at, updatedAt: at },
    plan: { userId: "u-103", planId: "assist", status: "active", chosenAt: at, activatedAt: at, updatedAt: at, merchant: "primary" },
  };
  const mail = signupNoticeEmail(snap, "completed onboarding");
  assertEquals(mail.subject, "DocuMonster signup — completed onboarding — Monster Assist — +15125550103");
  assertStringIncludes(mail.htmlBody, "<h2>DocuMonster signup — completed onboarding</h2>");
  assertStringIncludes(mail.htmlBody, "<strong>Plan:</strong> Monster Assist");
  assertStringIncludes(mail.htmlBody, "<strong>Payment:</strong> paid");
  assertStringIncludes(mail.htmlBody, "<strong>Stage:</strong> onboarding complete");
  assertStringIncludes(mail.htmlBody, "<strong>Name:</strong> Ana &lt;García&gt;");
  assertStringIncludes(mail.htmlBody, "<strong>Business:</strong> Ana Roofing &amp; Sons");
  assertStringIncludes(mail.htmlBody, "<strong>Phone:</strong> +15125550103");
  assertStringIncludes(mail.htmlBody, "<strong>Email:</strong> ana@roof.test");
  assertStringIncludes(mail.htmlBody, "<strong>Website:</strong> https://ana-roofing.test");
  assertStringIncludes(mail.htmlBody, "<strong>Address:</strong> 1600 Congress Ave, Austin, TX 78701");
  assertStringIncludes(mail.htmlBody, "<strong>Payment methods:</strong> cash, zelle");
  assertStringIncludes(mail.htmlBody, "<strong>Insurance:</strong> State Farm");
  assertStringIncludes(mail.htmlBody, "<strong>Onboarded:</strong> 2026-10-21T16:00:00.000Z");
  assertStringIncludes(mail.htmlBody, "<strong>Merchant account:</strong> primary");
});

Deno.test("REQ-112 signupNoticeEmail — a paid pick waiting on its pay page says so: the plan, awaiting payment, the stage naming it; a payment that landed says paid", () => {
  const picked: SignupSnapshot = { ...bare({ ...byPhone, name: "Ana", email: "ana@roof.test" }), plan: { userId: "u-103", planId: "monster", status: "pending", chosenAt: at, updatedAt: at, merchant: "primary" } };
  const waiting = signupNoticeEmail(picked, "signed up");
  assertEquals(waiting.subject, "DocuMonster signup — signed up — Monster — +15125550103");
  assertStringIncludes(waiting.htmlBody, "<strong>Payment:</strong> awaiting payment");
  assertStringIncludes(waiting.htmlBody, "Monster picked, awaiting payment");
  const paid = signupNoticeEmail({ ...picked, plan: { ...picked.plan!, status: "active", activatedAt: at } }, "paid");
  assertEquals(paid.subject, "DocuMonster signup — paid — Monster — +15125550103");
  assertStringIncludes(paid.htmlBody, "<strong>What happened:</strong> paid");
  assertStringIncludes(paid.htmlBody, "<strong>Payment:</strong> paid");
});

Deno.test("REQ-113 signupNoticeEmail — a $99 sign-up that has not reached its payment page yet: the subject and the Plan row say Monster from the sign-up on, the payment none", () => {
  const mail = signupNoticeEmail(bare({ ...byPhone, signupPlan: "monster" }), "signed up");
  assertEquals(mail.subject, "DocuMonster signup — signed up — Monster — +15125550103");
  assertStringIncludes(mail.htmlBody, "<strong>Plan:</strong> Monster</li>");
  assertStringIncludes(mail.htmlBody, "<strong>Payment:</strong> none");
  assertStringIncludes(mail.htmlBody, "<strong>Stage:</strong> signed up — nothing answered yet, next the name");
});
