import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { Customer } from "@crm/dto/customer.ts";

export interface BindConversationCustomerInput {
  userId: string;
  conversationId: string;
  customerId: string;
}

export interface BindConversationCustomerResult {
  conversation: AgentConversation;
  customer: Customer;
}

/**
 * BindConversationCustomer — point an existing conversation (and its
 * bound contract, if any) at a different customer the contractor owns.
 *
 * Used by the quote-review surface's "swap customer" pencil. Differs
 * from the wizard customer step in that it runs outside the wizard's
 * lifecycle: phase may already be past `terms`, the contract may be
 * fully drafted, and we don't want to advance any wizard state or
 * append chat messages — just re-point the binding.
 */
@Injectable()
export class BindConversationCustomer {
  constructor(
    private conversations: AgentConversationStore,
    private contracts: ContractStore,
    private customers: CustomerStore,
  ) {}

  async run(input: BindConversationCustomerInput): Promise<BindConversationCustomerResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    const customer = await this.customers.getOwned(input.customerId, input.userId);

    if (conv.contractId) {
      await this.contracts.update(conv.contractId, input.userId, { customerId: customer.id });
    }

    const updatedConv = await this.conversations.update(conv.id, {
      customerId: customer.id,
    });

    return { conversation: updatedConv, customer };
  }
}
