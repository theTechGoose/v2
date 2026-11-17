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
 */
import { telHref } from "../../shared/quote-flow/format-helpers.ts";

/** the slice of a CustomerCard the actions read */
export interface ClientActionInput {
  balanceCents: number;
  status: string;
  phoneNumber?: string | null;
  email?: string | null;
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
  if (phone) return telHref(phone).replace(/^tel:/, "sms:");
  const email = c.email?.trim();
  if (email) return `mailto:${email}`;
  return null;
}

export function ctaKindFor(c: ClientActionInput): CtaKind {
  if (c.balanceCents > 0) return "reminder";
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
