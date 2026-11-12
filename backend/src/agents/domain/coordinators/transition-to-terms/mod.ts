import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts"; // REQ-368
import { AnswerBilling } from "@agents/domain/coordinators/answer-billing/mod.ts"; // REQ-368
import { isOpenDraft } from "@agents/domain/business/chat-routing/mod.ts"; // REQ-368
import { transitionPhase } from "@agents/domain/business/derive-phase/mod.ts";
import { freshState } from "@agents/domain/business/wizard-progress/mod.ts";
import {
  getWizardSpec,
  localizeOptions,
  wizardSpecFor,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { suggestedOptionId } from "@agents/domain/business/terms-prefill/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface TransitionToTermsResult {
  conversation: AgentConversation;
  /** Two messages added: the phase_divider and the first wizard step. */
  newMessages: AgentMessage[];
}

/**
 * TransitionToTerms — fired when the user clicks "Start" on the
 * continue_cta card (or POSTs to `/agents/transition`).
 *
 *   1. Validate ownership + that we're currently in 'quote'.
 *   2. Flip conversation.currentPhase = 'terms'.
 *   3. Initialize wizard state (activeStepIdx = 0, no answers).
 *   4. Append a `phase_divider` message ("Phase 2 — Agreement terms").
 *   5. Append a `wizard` message rendering the first step.
 *
 * This is idempotent-ish: re-calling on a conversation already in terms
 * does NOT re-create the wizard state (preserves answers) but still
 * returns the current state. Callers should not expect message-append
 * idempotency though; that's why we guard against double-transition.
 */
@Injectable()
export class TransitionToTerms {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
  ) {}

  async run(
    input: {
      userId: string;
      conversationId: string;
      lang?: "en" | "es";
      /** REQ-024: "invoice" runs the invoice wizard (completion date instead
       *  of start date + duration). Default: the quote wizard. */
      docKind?: "quote" | "invoice";
    },
  ): Promise<TransitionToTermsResult> {
    // Chat copy is rendered to the contractor in their own UI language; default to "en".
    const lang = input.lang === "es" ? "es" : "en";
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    // REQ-368 (demo-loop cycle 1, M32): a FINISHED wizard has no step to
    // re-emit — below, that read "All terms answered." with no options, a
    // dead end (pair 1, through a stale "business or person?" CTA after the
    // customer signed). Hand back the step the wizard ends on instead.
    if (conv.currentPhase === "terms") {
      const finished = await this.afterFinishedWizard(conv, lang, input.userId);
      if (finished) return finished;
    }
    if (conv.currentPhase === "terms") {
      // Already transitioned — just re-emit the current step (no divider duplicate).
      const state = await this.conversations.getWizardState(conv.id);
      const stepIdx = state?.activeStepIdx ?? 0;
      const spec = state ? getWizardSpec(state.specId) : wizardSpecFor(conv.docKind);
      const step = spec.steps[stepIdx];
      const wizardMsg = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "wizard",
        content: step
          ? t(lang, step.question)
          : t(lang, "transitionToTerms.allTermsAnswered"),
        payload: {
          specId: spec.id,
          stepIdx,
          stepId: step?.id,
          options: step ? localizeOptions(step.options, lang) : undefined,
          suggestedOptionId: suggestedOptionId(conv.termsPrefill, step),
        },
      });
      return { conversation: conv, newMessages: [wizardMsg] };
    }

    const docKind = input.docKind ?? conv.docKind ?? "quote";
    const spec = wizardSpecFor(docKind);
    const transitioned = transitionPhase(conv, "terms");
    const updated = await this.conversations.update(transitioned.id, {
      currentPhase: "terms",
      docKind,
    });

    const state = freshState(spec);
    await this.conversations.putWizardState(conv.id, state);

    const newMessages: AgentMessage[] = [];

    const divider = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: t(lang, "transitionToTerms.phaseDivider"),
      payload: { phase: 2, label: t(lang, "transitionToTerms.phaseDivider") },
    });

    const firstStep = spec.steps[0];
    const wizardMsg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "wizard",
      content: t(lang, firstStep.question),
      payload: {
        specId: spec.id,
        stepIdx: 0,
        stepId: firstStep.id,
        options: localizeOptions(firstStep.options, lang),
        hint: firstStep.hint,
        suggestedOptionId: suggestedOptionId(conv.termsPrefill, firstStep),
      },
    });

    newMessages.push(divider, wizardMsg);
    return { conversation: updated, newMessages };
  }

  /**
   * REQ-368 (M32): the reply for a terms phase whose wizard is done. Once the
   * quote is issued (sent / signed / declined), where its bill stands — the
   * deposit invoice signing sent, or "hasn't signed yet"; before that, the
   * review/send CTA the wizard ends on (the one HandleWizardAnswer emits).
   * Undefined while a step is still open.
   */
  private async afterFinishedWizard(
    conv: AgentConversation,
    lang: "en" | "es",
    userId: string,
  ): Promise<TransitionToTermsResult | undefined> {
    const state = await this.conversations.getWizardState(conv.id);
    const spec = state
      ? getWizardSpec(state.specId)
      : wizardSpecFor(conv.docKind);
    if (spec.steps[state?.activeStepIdx ?? 0]) return undefined;
    // QuoteStore is a stateless KV wrapper; built here so this coordinator
    // keeps its constructor.
    const quote = conv.quoteId
      ? await new QuoteStore().getOwned(conv.quoteId, userId)
        .catch(() => undefined)
      : undefined;
    if (quote && !isOpenDraft(quote)) {
      const billing = await new AnswerBilling(this.conversations, this.messages)
        .run({ userId, conversation: conv, lang });
      if (billing) return billing;
    }
    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: t(lang, "wizardAnswer.cta.readyToSend"),
      payload: {
        toPhase: "send",
        summary: t(lang, "wizardAnswer.cta.readyToSendSummary"),
        ...(conv.quoteId ? { quoteId: conv.quoteId } : {}),
        ...(conv.docKind ? { docKind: conv.docKind } : {}),
      },
    });
    return { conversation: conv, newMessages: [cta] };
  }
}
