/**
 * REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
 * hello@documonster.com". REQ-112 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Send
 * new-signup notifications. Whenever someone completes signup for Monster Free, Monster, or
 * Monster Assist, automatically send an email to hello@documonster.com. Include all information
 * collected, their selected plan, signup status/stage, and payment status where applicable."
 *
 * Pure: the email an account generates — the one address (no env var has a say), what happened
 * (signed up · completed onboarding · skipped setup · paid), everything the account has said, its
 * plan, where its payment stands and the stage it reached (REQ-111's words). The outbox's sweep
 * (CrmLeadCapture) mails it through SignupNotice after the request has replied.
 */
import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";
import { type SignupSnapshot, signupProgress } from "@users/domain/business/signup-progress/mod.ts";

/** where every sign-up is announced */
export const SIGNUP_INBOX = "hello@documonster.com";

/** what happened to the account that the notice tells */
export type NoticeReason = "signed up" | "completed onboarding" | "skipped setup" | "paid";
export const NOTICE_REASONS: readonly NoticeReason[] = ["signed up", "completed onboarding", "skipped setup", "paid"];
export function noticeReasonOf(raw: unknown): NoticeReason {
  return (NOTICE_REASONS as readonly unknown[]).includes(raw) ? raw as NoticeReason : "signed up";
}

export interface SignupNoticeEmail {
  to: string;
  subject: string;
  htmlBody: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
const said = (v: string | undefined | null): string => (v ?? "").trim();

/** the payment methods switched on, by name */
function paymentMethods(identity: SignupSnapshot["identity"]): string {
  const methods = (identity?.acceptedPaymentMethods ?? {}) as Record<string, { enabled?: boolean } | null | undefined>;
  return Object.entries(methods).filter(([, m]) => Boolean(m?.enabled)).map(([k]) => k).join(", ");
}

function addressLine(address: SignupSnapshot["address"]): string {
  if (!address) return "";
  const street = said(address.street);
  const town = [said(address.city), said(address.state)].filter(Boolean).join(", ");
  const place = [town, said(address.postal)].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

export function signupNoticeEmail(snapshot: SignupSnapshot, reason: NoticeReason): SignupNoticeEmail {
  const { user, identity, insurance, plan } = snapshot;
  const progress = signupProgress(snapshot);
  const phone = said(user.phoneNumber);
  const email = said(user.email);
  const name = isPlaceholderName(user.name) ? "" : said(user.name);
  // REQ-050 — an account born from the email login has no phone
  const how = phone ? "by phone" : "by email";
  const rows: [string, string][] = [
    ["What happened", reason],
    ["Opened", how],
    ["Plan", progress.plan || "none yet"],
    ["Payment", progress.payment],
    ["Stage", progress.stage],
    ["Name", name],
    ["Business", said(identity?.businessName)],
    ["Phone", phone],
    ["Email", email],
    ["Website", said(identity?.websiteUrl)],
    ["Address", addressLine(snapshot.address)],
    ["Payment methods", paymentMethods(identity)],
    ["Insurance", said(insurance?.provider)],
    ["Merchant account", said(plan?.merchant)],
    ["Language", user.language ?? "not set"],
    ["Signed up", user.createdAt],
    ["Onboarded", said(user.onboardedAt)],
    ["User ID", user.id],
  ];
  const list = rows.filter(([, v]) => v !== "").map(([k, v]) => `<li><strong>${k}:</strong> ${esc(v)}</li>`).join("");
  return {
    to: SIGNUP_INBOX,
    subject: `DocuMonster signup — ${reason} — ${progress.plan || "no plan yet"} — ${phone || email || user.id}`,
    htmlBody: `<h2>DocuMonster signup — ${esc(reason)}</h2><ul>${list}</ul>`,
  };
}
