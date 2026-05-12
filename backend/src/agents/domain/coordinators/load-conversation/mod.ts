import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { computeProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";
import type { WizardProgress } from "@agents/domain/business/wizard-progress/mod.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Customer } from "@crm/dto/customer.ts";

export interface ConversationSnapshot {
  conversation: AgentConversation;
  messages: AgentMessage[];
  /** Only present when conversation.currentPhase === 'terms'. */
  wizard?: { state: WizardState; progress: WizardProgress };
  /** Bound contract — populated once the wizard finalizes. */
  contract?: Contract;
  /** Bound customer — resolved from conv.customerId or contract.customerId. */
  customer?: Customer;
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
    private contracts: ContractStore,
    private customers: CustomerStore,
  ) {}

  async run(input: { userId: string; conversationId: string }): Promise<ConversationSnapshot> {
    let conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.hasUnreadEvent) {
      conv = await this.conversations.clearUnreadEvent(conv.id);
    }
    const msgs = await this.messages.listByConversation(input.conversationId);

    let wizard: ConversationSnapshot["wizard"];
    if (conv.currentPhase === "terms") {
      const state = await this.conversations.getWizardState(input.conversationId);
      if (state) {
        const progress = computeProgress(CONTRACT_TERMS_WIZARD_V1, state);
        wizard = { state, progress };
      }
    }

    let contract: Contract | undefined;
    if (conv.contractId) {
      try {
        contract = await this.contracts.getOwned(conv.contractId, conv.userId);
      } catch { /* contract was deleted out from under the conversation — surface conv state without it */ }
    }

    // Bound customer — prefer the conversation's customerId, fall back to
    // the contract's. Needed so the recovery UI (and any per-customer
    // surfaces) can render without a follow-up fetch. Best-effort: a
    // forbidden/missing row just leaves customer undefined.
    let customer: Customer | undefined;
    const customerId = conv.customerId ?? contract?.customerId;
    if (customerId) {
      try {
        customer = await this.customers.getOwned(customerId, conv.userId);
      } catch { /* surface the rest of the snapshot without customer */ }
    }

    return { conversation: conv, messages: msgs, wizard, contract, customer };
  }
}
