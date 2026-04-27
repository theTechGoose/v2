import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";
import type { WizardProgress } from "@agents/domain/business/wizard-progress/mod.ts";

export interface ConversationSnapshot {
  conversation: AgentConversation;
  messages: AgentMessage[];
  /** Only present when conversation.currentPhase === 'terms'. */
  wizard?: { state: WizardState; progress: WizardProgress };
}

/**
 * LoadConversation — composite read for `GET /agents/conversations/:id`.
 *
 * Returns the conversation, its full message history (oldest → newest),
 * and — if in terms phase — the wizard's state + computed progress.
 */
@Injectable()
export class LoadConversation {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
  ) {}

  async run(input: { userId: string; conversationId: string }): Promise<ConversationSnapshot> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    const msgs = await this.messages.listByConversation(input.conversationId);

    let wizard: ConversationSnapshot["wizard"];
    if (conv.currentPhase === "terms") {
      const state = await this.conversations.getWizardState(input.conversationId);
      if (state) {
        const progress = computeProgress(CONTRACT_TERMS_WIZARD_V1, state);
        wizard = { state, progress };
      }
    }

    return { conversation: conv, messages: msgs, wizard };
  }
}
