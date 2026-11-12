/**
 * REQ-392 (demo-loop cycle 2, M7) — the pure rules behind a message typed in
 * the compact "Tell the assistant…" box on a guided step (the box itself and
 * the step hint are shared/quote-flow/step-composer.ts).
 *
 *   stepScopeText       — what the pricing engine reads beside the job on a
 *                         Pick-a-price correction (the correction rides with the
 *                         confirmed scope, never in the job text, whose amounts
 *                         are the cost floor)
 *   stepJobOptionsRaw   — what the job-options engine rewrites on a Job-details
 *                         correction: the job, the version on screen, the
 *                         correction
 *   stepContextLine     — the line the chat model reads on a wizard question /
 *                         the Ready-to-send review
 *   stepTools           — the review may also revise a line (revise_quote)
 *   isFallbackPricing   — the pricing engine answered with its generic tiers
 *                         (the model was unreachable or answered junk), which
 *                         must never replace the tiers on screen
 *   priceStepReply / jobOptionsStepReply — the server's own reply on the two
 *                         pre-quote steps, in the contractor's language
 *   stepLangs           — the languages the rewritten versions carry
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import type { ChatStepHint } from "#quote-flow/step-composer.ts";
import type { LLMToolName } from "@agents/domain/business/llm/base/mod.ts";
import { requestedLangs } from "@agents/domain/business/requested-langs/mod.ts";
import { ES_TRADE_GLOSSARY } from "@agents/domain/business/es-trade-glossary/mod.ts";

/** "$28,000" — cents only when there are any ("$1,850.50"). */
export function stepMoney(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function correctionLine(correction: string): string {
  return t("en", "prompts.chatStep.correction", { text: correction.trim() });
}

/** The confirmed scope with the correction under it — SuggestPrices' `scope`.
 *  No confirmed scope: the correction alone. */
export function stepScopeText(
  scope: string | undefined,
  correction: string,
): string {
  const s = scope?.trim() ?? "";
  return s
    ? `${s}\n\n${correctionLine(correction)}`
    : correctionLine(correction);
}

/** The job, the version on screen, then the correction — GenerateJobOptions'
 *  `raw`. */
export function stepJobOptionsRaw(
  job: string,
  scope: string | undefined,
  correction: string,
): string {
  const parts = [job.trim()];
  const shown = scope?.trim();
  if (shown) {
    parts.push(t("en", "prompts.chatStep.onScreen", { scope: shown }));
  }
  parts.push(correctionLine(correction));
  return parts.filter(Boolean).join("\n\n");
}

/** The line the chat model reads beside the quote. Only the wizard question
 *  and the review steer the model; the pre-quote steps never reach it. */
export function stepContextLine(
  hint: ChatStepHint | undefined,
  opts: { question?: string } = {},
): string | undefined {
  if (hint?.id === "wizard") {
    const question = opts.question?.trim() || hint.wizardStepId || "terms";
    return t("en", "prompts.chatStep.wizard", { question });
  }
  // REQ-448 (demo-loop cycle 3, m47): the review is where update_job_details
  // rewrites the Spanish job details ("trinchado" for trench) — it carries the
  // shared trade glossary.
  if (hint?.id === "review") {
    return `${t("en", "prompts.chatStep.review")} ${ES_TRADE_GLOSSARY}`;
  }
  return undefined;
}

/** The tools the model may call: on the Ready-to-send review a line already
 *  on the quote can be repriced or reworded (revise_quote) besides what the
 *  phase allows. Every other turn keeps exactly the tools it had. */
export function stepTools(
  base: readonly LLMToolName[],
  hint: ChatStepHint | undefined,
): LLMToolName[] {
  const tools = [...base];
  if (hint?.id === "review" && !tools.includes("revise_quote")) {
    tools.push("revise_quote");
  }
  return tools;
}

/** The tiers' rationale lines the pricing engine writes on its generic answer
 *  (SuggestPrices' fallbackTiers) — in either language, since a floor lift
 *  rescales the prices but keeps the lines. */
const FALLBACK_RATIONALE: Record<string, string[]> = Object.fromEntries(
  (["competitive", "market", "premium"] as const).map((tier) => [
    tier,
    (["en", "es"] as const).map((l) =>
      t(l, `suggestPrices.fallback.${tier}Rationale`)
    ),
  ]),
);

/** True when every tier is the pricing engine's generic one: it could not
 *  price this job (model unreachable or junk), so the answer says nothing
 *  about the correction and must not stand in for the tiers on screen. */
export function isFallbackPricing(
  options: readonly { tier?: string; rationale?: string }[],
): boolean {
  return options.length > 0 &&
    options.every((o) =>
      (FALLBACK_RATIONALE[o.tier ?? ""] ?? []).includes(o.rationale ?? "")
    );
}

export interface PriceStepReplyInput {
  /** The tier cards are on screen (help me price it). */
  tiers: boolean;
  /** The re-priced tiers, when the pricing engine ran. */
  options?: {
    tier?: string;
    label: string;
    priceCents: number;
    rationale?: string;
  }[];
  /** The one price the correction named, for the price box. */
  statedCents?: number | null;
}

/** "Re-priced with your note — Competitive $24,500 · Market $28,000 ·
 *  Premium $32,000. I put $28,000 in the price box — …" — or, when the
 *  engine could only answer its generic tiers, that it couldn't re-price
 *  (the tiers on screen stay; REQ-026 honest fallback). */
export function priceStepReply(lang: Lang, input: PriceStepReplyInput): string {
  const out: string[] = [];
  const stated = typeof input.statedCents === "number" && input.statedCents > 0
    ? input.statedCents
    : null;
  if (input.tiers) {
    const priced = input.options?.length && !isFallbackPricing(input.options)
      ? input.options
      : undefined;
    if (priced) {
      const tiers = priced
        .map((o) => `${o.label} ${stepMoney(o.priceCents)}`)
        .join(" · ");
      out.push(t(lang, "chatCoordinator.step.repriced", { tiers }));
    } else {
      out.push(t(lang, "chatCoordinator.step.repriceFailed"));
      if (stated === null) {
        out.push(t(lang, "chatCoordinator.step.priceAskTiers"));
      }
    }
  }
  if (stated !== null) {
    out.push(
      t(
        lang,
        input.tiers
          ? "chatCoordinator.step.priceSetTiers"
          : "chatCoordinator.step.priceSet",
        { amount: stepMoney(stated) },
      ),
    );
  }
  if (out.length === 0) out.push(t(lang, "chatCoordinator.step.priceAsk"));
  return out.join(" ");
}

/** The reply over the rewritten versions — honest when the writer was not
 *  reachable and the versions on screen were left as they were (REQ-026). */
export function jobOptionsStepReply(lang: Lang, degraded: boolean): string {
  return t(
    lang,
    degraded
      ? "chatCoordinator.step.jobOptionsDegraded"
      : "chatCoordinator.step.jobOptions",
  );
}

/** The app language (the contractor reviews in it), the comms languages (the
 *  customer's copy) and any language the text asks for — deduped, app first.
 *  The job-details controller's targetLangs rule, minus the store read. */
export function stepLangs(
  appLang: string,
  comms: readonly string[],
  raw: string,
): ("en" | "es")[] {
  const out: ("en" | "es")[] = [];
  for (const l of [appLang, ...comms, ...requestedLangs(raw)]) {
    const v = l === "es" ? "es" : "en";
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
