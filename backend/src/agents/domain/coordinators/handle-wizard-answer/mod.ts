import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { applyAnswer, computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { EventBus } from "@core/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";

export interface WizardAnswerInput {
  userId: string;
  conversationId: string;
  stepId: string;
  optionId: string;
  customValue?: string;
}

export interface WizardAnswerResult {
  conversation: AgentConversation;
  wizardState: WizardState;
  /**
   * The two messages appended this turn:
   *   - user "pick" message (text summary like "Config: Standard residential")
   *   - assistant message — either the next wizard step OR a continue_cta
   *     when all 10 steps are complete.
   */
  newMessages: AgentMessage[];
}

/**
 * HandleWizardAnswer — the phase-2 turn handler.
 *
 *   1. Validate ownership + that the conversation is in 'terms'.
 *   2. Look up current wizard state.
 *   3. Apply the answer (pure function, throws on out-of-order or unknown opt).
 *   4. Persist new wizard state.
 *   5. Append a `text` message representing the user's pick (so the chat
 *      transcript reads naturally and the prior wizard message can fade
 *      out client-side into a completed-step chip).
 *   6. If wizard not done: append the next step's wizard message.
 *      If wizard done: append a continue_cta to "Send to client".
 */
@Injectable()
export class HandleWizardAnswer {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private contracts: ContractStore,
    private bus: EventBus,
  ) {}

  async run(input: WizardAnswerInput): Promise<WizardAnswerResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.currentPhase !== "terms") throw new Error("conversation is not in 'terms' phase");

    const current = await this.conversations.getWizardState(input.conversationId);
    if (!current) throw new Error("wizard state missing — call transition-to-terms first");

    const next = applyAnswer(CONTRACT_TERMS_WIZARD_V1, current, {
      stepId: input.stepId,
      optionId: input.optionId,
      customValue: input.customValue,
    });
    await this.conversations.putWizardState(input.conversationId, next);

    const stepDef = CONTRACT_TERMS_WIZARD_V1.steps.find((s) => s.id === input.stepId)!;
    const optionDef = stepDef.options.find((o) => o.id === input.optionId)!;
    const pickValue = optionDef.isCustom ? (input.customValue ?? "Custom") : optionDef.label;

    const userPick = await this.messages.append({
      conversationId: input.conversationId,
      role: "user",
      kind: "text",
      content: `${stepDef.label}: ${pickValue}`,
      payload: { wizardStepId: input.stepId, optionId: input.optionId, customValue: input.customValue },
    });

    const newMessages: AgentMessage[] = [userPick];
    const progress = computeProgress(CONTRACT_TERMS_WIZARD_V1, next);

    let convPatch: Partial<AgentConversation> = { preview: `${stepDef.label}: ${pickValue}` };

    if (progress.isComplete) {
      // Materialize a real Contract row from the conversation's active quote
      // + collected wizard answers. Best-effort: if conv.quoteId is missing
      // or the quote can't be loaded, we still surface the CTA — the user
      // can pick a quote manually before sending.
      const contractId = await this.finalizeContract(conv);
      if (contractId) convPatch.contractId = contractId;

      const cta = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "continue_cta",
        content: "Ready to send",
        payload: {
          toPhase: "send",
          summary: "All terms answered. Review and send to your client.",
          ...(contractId ? { contractId } : {}),
        },
      });
      newMessages.push(cta);
    } else {
      const step = progress.activeStep!;
      const wizardMsg = await this.messages.append({
        conversationId: input.conversationId,
        role: "assistant",
        kind: "wizard",
        content: step.question,
        payload: { specId: CONTRACT_TERMS_WIZARD_V1.id, stepIdx: next.activeStepIdx, stepId: step.id, options: step.options, hint: step.hint },
      });
      newMessages.push(wizardMsg);
    }

    const updatedConv = await this.conversations.update(input.conversationId, convPatch);
    return { conversation: updatedConv, wizardState: next, newMessages };
  }

  /**
   * Create a Contract row when the wizard hits 10/10. Returns the new
   * (or existing) contract id, or `undefined` if no quote was bound and
   * we couldn't materialize one. Idempotent: if conv.contractId already
   * points at a real contract, reuse it.
   */
  private async finalizeContract(conv: AgentConversation): Promise<string | undefined> {
    if (conv.contractId) {
      try {
        await this.contracts.getOwned(conv.contractId, conv.userId);
        return conv.contractId;                  // already finalized — keep it
      } catch { /* fall through and try to recreate */ }
    }
    if (!conv.quoteId) {
      console.error(`[wizard:finalize] conversation ${conv.id} has no quoteId — skipping contract creation`);
      return undefined;
    }
    let totalAmount: number | undefined;
    try {
      const quote = await this.quotes.getOwned(conv.quoteId, conv.userId);
      totalAmount = quote.estimatedTotal;
    } catch (err) {
      console.error(`[wizard:finalize] failed to load quote ${conv.quoteId}:`, err);
      return undefined;
    }
    const contract = await this.contracts.create(conv.userId, {
      quoteId: conv.quoteId,
      ...(conv.customerId ? { customerId: conv.customerId } : {}),
      status: "draft",
      ...(typeof totalAmount === "number" ? { totalAmount } : {}),
    });
    await this.bus.emit({
      userId: conv.userId,
      entityType: "contract",
      entityId: contract.id,
      action: "drafted",
      data: { quoteId: conv.quoteId, customerId: conv.customerId },
    });
    return contract.id;
  }
}
