import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AcceptContractInput {
  userId: string;
  conversationId: string;
  contractId: string;
}

export interface AcceptContractResult {
  conversation: AgentConversation;
  /** phase_divider message announcing the acceptance, for the chat. */
  newMessages: AgentMessage[];
}

/**
 * AcceptContract — fires when the customer accepts the quote/contract
 * (in real life, via a webhook from the signing surface; in dev, via a
 * "Simulate customer accepted" trigger button on the chat).
 *
 *   1. Verify the contract belongs to the conversation owner.
 *   2. If already 'accepted', short-circuit (idempotent).
 *   3. Flip contract.status = 'accepted', emit `contract:accepted`.
 *   4. Bump conversation.updatedAt + set `hasUnreadEvent = true` and a
 *      preview line so the threads sidebar shows the badge and the
 *      conversation bubbles to the top.
 *   5. Append a phase_divider message to the chat so when the user
 *      opens the thread they see exactly what happened.
 *
 * The unread flag is *cleared* by LoadConversation on the next thread
 * read — that's what makes the badge disappear when the user opens it.
 */
@Injectable()
export class AcceptContract {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private contracts: ContractStore,
    private bus: EventBus,
  ) {}

  async run(input: AcceptContractInput): Promise<AcceptContractResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.contractId !== input.contractId) {
      throw new Error("contractId does not match this conversation's contract");
    }

    const contract = await this.contracts.getOwned(input.contractId, input.userId);
    const wasAlreadyAccepted = contract.status === "accepted";

    if (!wasAlreadyAccepted) {
      await this.contracts.update(contract.id, input.userId, { status: "accepted" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "contract",
        entityId: contract.id,
        action: "accepted",
      });
    }

    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: "Contract accepted by client",
      payload: {
        phase: 4,
        label: "Contract accepted by client",
        contractId: contract.id,
      },
    });

    // Per the quote → contract → invoice chain, customer acceptance of
    // the contract is the user's prompt to draft + send the invoice.
    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: "Continue to invoice",
      payload: {
        toPhase: "invoice",
        contractId: contract.id,
        summary: "Customer signed — bill the job and send the invoice.",
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      hasUnreadEvent: true,
      contractStatus: "accepted",
      preview: "✓ Contract accepted by client",
    });

    return { conversation: updatedConv, newMessages: [note, cta] };
  }
}
