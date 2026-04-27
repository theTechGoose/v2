import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { transitionPhase } from "@agents/domain/business/derive-phase/mod.ts";
import { freshState } from "@agents/domain/business/wizard-progress/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
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
 *   4. Append a `phase_divider` message ("Phase 2 — Contract terms").
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

  async run(input: { userId: string; conversationId: string }): Promise<TransitionToTermsResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.currentPhase === "terms") {
      // Already transitioned — just re-emit the current step (no divider duplicate).
      const state = await this.conversations.getWizardState(conv.id);
      const stepIdx = state?.activeStepIdx ?? 0;
      const step = CONTRACT_TERMS_WIZARD_V1.steps[stepIdx];
      const wizardMsg = await this.messages.append({
        conversationId: conv.id,
        role: "assistant",
        kind: "wizard",
        content: step?.question ?? "All terms answered.",
        payload: { specId: CONTRACT_TERMS_WIZARD_V1.id, stepIdx, stepId: step?.id, options: step?.options },
      });
      return { conversation: conv, newMessages: [wizardMsg] };
    }

    const transitioned = transitionPhase(conv, "terms");
    const updated = await this.conversations.update(transitioned.id, { currentPhase: "terms" });

    const state = freshState(CONTRACT_TERMS_WIZARD_V1);
    await this.conversations.putWizardState(conv.id, state);

    const divider = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: "Phase 2 — Contract terms",
      payload: { phase: 2, label: "Phase 2 — Contract terms" },
    });

    const firstStep = CONTRACT_TERMS_WIZARD_V1.steps[0];
    const wizardMsg = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "wizard",
      content: firstStep.question,
      payload: { specId: CONTRACT_TERMS_WIZARD_V1.id, stepIdx: 0, stepId: firstStep.id, options: firstStep.options, hint: firstStep.hint },
    });

    return { conversation: updated, newMessages: [divider, wizardMsg] };
  }
}
