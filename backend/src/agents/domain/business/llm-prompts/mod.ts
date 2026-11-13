/**
 * Phase-specific system prompts. Public so the OpenAI client can pick
 * the right one based on the conversation's currentPhase.
 *
 * The 'quote' prompt pushes Bossie to draft fast from minimal input
 * with named assumptions, rather than stacking clarifying questions.
 * The 'terms' prompt only fires when the user types free-form during the
 * wizard; the wizard itself is server-driven (no LLM).
 */
import { t } from "@core/i18n/mod.ts";
import { isQuoteIssued, isQuoteLocked } from "#documents/versions.ts";

/** REQ-368 (demo-loop cycle 1, M30 + M32): both phases answer pricing
 *  questions (never "I can't provide pricing advice") and know that signing
 *  already sent the first invoice (never re-lock a signed quote for it). */
const PRICING_AND_BILLING = t("en", "prompts.pricingAndBilling");

export const SYSTEM_PROMPT_QUOTE = `${
  t("en", "prompts.systemQuote")
}\n\n${PRICING_AND_BILLING}`;

export const SYSTEM_PROMPT_TERMS = `${
  t("en", "prompts.systemTerms")
}\n\n${PRICING_AND_BILLING}`;

/** The bound quote, as far as the terms prompt needs it. */
export interface TermsPromptQuote {
  status?: string | null;
  sentAt?: string | null;
  lockedAt?: string | null;
  acceptedAt?: string | null;
}

/** Which price-change instruction the terms prompt carries. */
export type TermsPriceChange = "signed" | "issued" | "lockedCard" | "open";

/**
 * REQ-375 (demo-loop cycle 2, M11): the conversation stays in the terms phase
 * after the send, and the old prompt said "tap Re-open on the quote card
 * above" whatever the quote's state — on a sent quote there is no such button
 * (and ReopenQuote refuses an issued quote); the know-my-price path has no
 * card at all. Re-open is named only for a locked, unsent quote whose card is
 * in the thread; a sent quote is changed with revise_quote as its next
 * Version; a signed one only with a change order.
 */
export function termsPriceChange(
  quote: TermsPromptQuote | undefined,
  opts: { hasActionCard: boolean },
): TermsPriceChange {
  if (!quote) return "open";
  const q = {
    status: quote.status ?? undefined,
    sentAt: quote.sentAt ?? undefined,
    acceptedAt: quote.acceptedAt ?? undefined,
  };
  if (isQuoteLocked(q)) return "signed";
  if (isQuoteIssued(q)) return "issued";
  if (quote.lockedAt && opts.hasActionCard) return "lockedCard";
  return "open";
}

/** The terms-phase system prompt for the bound quote's state (REQ-375). */
export function systemPromptTermsFor(
  quote: TermsPromptQuote | undefined,
  opts: { hasActionCard: boolean },
): string {
  const priceChange = t(
    "en",
    `prompts.termsPriceChange.${termsPriceChange(quote, opts)}`,
  );
  return `${
    t("en", "prompts.systemTerms")
  }\n\n${priceChange}\n\n${PRICING_AND_BILLING}`;
}
