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

export const SYSTEM_PROMPT_QUOTE = t("en", "prompts.systemQuote");

export const SYSTEM_PROMPT_TERMS = t("en", "prompts.systemTerms");
