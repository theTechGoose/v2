/**
 * REQ-277 (demo issue M31) — where a customer card's actions go.
 *
 * The card's footer nudge and the panel's "Message" were inert mock buttons.
 * Pure, i18n-free decisions (the island renders them; clients-display.ts maps
 * the CTA kind to its label):
 *  - `messageHrefFor` — a text to the customer's phone (sms:+1…), else an
 *    email, else nothing (the Message action is then not offered);
 *  - `ctaKindFor` — which verb the nudge reads (one precedence, shared with
 *    the label so the label and the action can never disagree);
 *  - `nudgeActionFor` — a message verb opens that text; "Open card", or a
 *    message verb with nowhere to send it, opens the card's panel.
 *
 * REQ-1029 (LOOP-007 q2-10): a phone REQ-569's `phoneCantReceiveTexts` flags
 * is never texted — the email, else nothing; and "Send a kind reminder"
 * runs the app's own invoice reminder (`reminderInvoiceFor` picks which).
 */
import { telHref } from "../../shared/quote-flow/format-helpers.ts";
import { phoneCantReceiveTexts } from "../../shared/quote-flow/sms-number.ts";
import { balanceWantsReminder } from "../../shared/card-actions/mod.ts";

/** the slice of a CustomerCard the actions read */
export interface ClientActionInput {
  balanceCents: number;
  status: string;
  phoneNumber?: string | null;
  email?: string | null;
  /** REQ-1066: how due the open balance is (the card's balanceSubParts) */
  balanceSubParts?: { kind: string; days?: number } | null;
}

export type CtaKind =
  | "reminder"
  | "progress"
  | "followUp"
  | "hello"
  | "openCard";

export type NudgeAction =
  | { kind: "message"; href: string }
  | { kind: "open" };

export function messageHrefFor(c: ClientActionInput): string | null {
  const phone = c.phoneNumber?.trim();
  if (phone && !phoneCantReceiveTexts(phone)) {
    return telHref(phone).replace(/^tel:/, "sms:");
  }
  const email = c.email?.trim();
  if (email) return `mailto:${email}`;
  return null;
}

export function ctaKindFor(c: ClientActionInput): CtaKind {
  // REQ-1066: a reminder only for money that is due (shared with the action);
  // a balance not yet due falls through to the status verb ("owes" → Open card)
  if (balanceWantsReminder(c)) return "reminder";
  if (c.status === "active") return "progress";
  if (c.status === "lead") return "followUp";
  if (c.status === "cold") return "hello";
  return "openCard";
}

export function nudgeActionFor(c: ClientActionInput): NudgeAction {
  if (ctaKindFor(c) === "openCard") return { kind: "open" };
  const href = messageHrefFor(c);
  return href ? { kind: "message", href } : { kind: "open" };
}

/** the slice of a CustomerCard document the reminder reads */
export interface ReminderDocInput {
  kind: string;
  id: string;
  number: string;
  state: string;
}

/**
 * REQ-1029: the invoice the board's "Send a kind reminder" is about — the
 * oldest one still out (issued, not paid, not void; one the customer says
 * they paid comes last). `documents` is newest first. Undefined when there
 * is none: the card opens instead.
 */
export function reminderInvoiceFor(
  documents: ReminderDocInput[] | null | undefined,
): ReminderDocInput | undefined {
  const out = (documents ?? []).filter((d) =>
    d.kind === "invoice" &&
    !["draft", "void", "paid"].includes(d.state)
  ).reverse();
  return out.find((d) => d.state !== "claimed") ?? out[0];
}
