/**
 * REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
 * hello@documonster.com". Pure: the email a new account generates — the one address (no env var
 * has a say), what the account carries and how it was opened. The outbox's sweep (CrmLeadCapture)
 * mails it through SignupNotice after the sign-up has replied.
 */
import type { User } from "@users/dto/user.ts";

/** where every sign-up is announced */
export const SIGNUP_INBOX = "hello@documonster.com";

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

export function signupNoticeEmail(user: User): SignupNoticeEmail {
  const phone = user.phoneNumber.trim();
  const email = user.email?.trim() ?? "";
  // REQ-050 — an account born from the email login has no phone
  const how = phone ? "by phone" : "by email";
  const rows: [string, string][] = [];
  if (phone) rows.push(["Phone", phone]);
  if (email) rows.push(["Email", email]);
  rows.push(["Language", user.language ?? "not set"], ["User ID", user.id], [
    "Signed up",
    user.createdAt,
  ]);
  const list = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${esc(v)}</li>`)
    .join("");
  return {
    to: SIGNUP_INBOX,
    subject: `New DocuMonster signup — ${phone || email || user.id}`,
    htmlBody:
      `<h2>New DocuMonster signup</h2><p>A new account was just opened, ${how}.</p><ul>${list}</ul>`,
  };
}
