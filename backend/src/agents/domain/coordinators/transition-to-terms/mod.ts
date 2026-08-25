import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { transitionPhase } from "@agents/domain/business/derive-phase/mod.ts";
import { freshState } from "@agents/domain/business/wizard-progress/mod.ts";
import {
  localizeOptions,
  TERMS_WIZARD_V1,
} from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { t } from "@core/i18n/mod.ts";
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
    input: { userId: string; conversationId: string; lang?: "en" | "es" },
  ): Promise<TransitionToTermsResult> {
    // Chat copy is rendered to the contractor in their own UI language; default to "en".
    const lang = input.lang === "es" ? "es" : "en";
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.currentPhase === "terms") {
      // Already transitioned — just re-emit the current step (no divider duplicate).
      const state = await this.conversations.getWizardState(conv.id);
      const stepIdx = state?.activeStepIdx ?? 0;
      const step = TERMS_WIZARD_V1.steps[stepIdx];
      const wizardMsg = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "wizard",
        content: step
          ? t(lang, step.question)
          : t(lang, "transitionToTerms.allTermsAnswered"),
        payload: {
          specId: TERMS_WIZARD_V1.id,
          stepIdx,
          stepId: step?.id,
          options: step ? localizeOptions(step.options, lang) : undefined,
        },
      });
      return { conversation: conv, newMessages: [wizardMsg] };
    }

    const transitioned = transitionPhase(conv, "terms");
    const updated = await this.conversations.update(transitioned.id, {
      currentPhase: "terms",
    });

    const state = freshState(TERMS_WIZARD_V1);
    await this.conversations.putWizardState(conv.id, state);

    const newMessages: AgentMessage[] = [];

    const divider = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: t(lang, "transitionToTerms.phaseDivider"),
      payload: { phase: 2, label: t(lang, "transitionToTerms.phaseDivider") },
    });

    const firstStep = TERMS_WIZARD_V1.steps[0];
    const wizardMsg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "wizard",
      content: t(lang, firstStep.question),
      payload: {
        specId: TERMS_WIZARD_V1.id,
        stepIdx: 0,
        stepId: firstStep.id,
        options: localizeOptions(firstStep.options, lang),
        hint: firstStep.hint,
      },
    });

    newMessages.push(divider, wizardMsg);
    return { conversation: updated, newMessages };
  }
}
