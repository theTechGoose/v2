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
