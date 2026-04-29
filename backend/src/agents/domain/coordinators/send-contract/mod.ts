import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface SendContractInput {
  userId: string;
  conversationId: string;
  /** Must match conv.contractId — guarantees the user is sending the
   *  contract they think they're sending, not a stray draft. */
  contractId: string;
}

export interface SendContractResult {
  conversation: AgentConversation;
  /** Status-update message confirming the dispatch (no popup needed). */
  newMessages: AgentMessage[];
}

/**
 * SendContract — fires the wizard's "Ready to send" CTA.
 *
 *   1. Verify ownership + that contractId matches conv.contractId
 *      (we don't allow sending an unrelated draft on this conversation).
 *   2. If the contract is already 'sent', short-circuit (idempotent;
 *      re-clicks don't double-email or re-emit events).
 *   3. Flip contract.status = 'sent', emit `contract:sent` event.
 *   4. Dispatch the customer-facing email via SendPaperworkEmail
 *      (which already supports kind="contract" — render + Postmark).
 *      Failure does NOT abort the status flip — the user can retry
 *      delivery from the contract surface later.
 *   5. Append a system message so the chat shows what happened.
 */
@Injectable()
export class SendContract {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private contracts: ContractStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
  ) {}

  async run(input: SendContractInput): Promise<SendContractResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.contractId !== input.contractId) {
      throw new Error("contractId does not match this conversation's contract");
    }

    const contract = await this.contracts.getOwned(input.contractId, input.userId);
    const wasAlreadySent = contract.status === "sent";

    if (!wasAlreadySent) {
      await this.contracts.update(contract.id, input.userId, { status: "sent" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "contract",
        entityId: contract.id,
        action: "sent",
      });
      try {
        await this.emailer.run(input.userId, { kind: "contract", resourceId: contract.id });
      } catch (err) {
        console.error(`[send-contract] email dispatch failed for contract ${contract.id}:`, err);
      }
    }

    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: wasAlreadySent ? "Contract was already sent" : "Contract sent to client",
      payload: {
        phase: 3,
        label: wasAlreadySent ? "Contract was already sent" : "Contract sent to client",
        contractId: contract.id,
      },
    });

    // Denormalize status onto the conversation so the threads sidebar
    // can render a SENT chip without an N+1 contract lookup. Don't set
    // hasUnreadEvent — the *user* fired this action, so they don't need
    // a notification telling them what they just did.
    const updatedConv = await this.conversations.update(conv.id, {
      contractStatus: "sent",
    });

    return { conversation: updatedConv, newMessages: [note] };
  }
}
