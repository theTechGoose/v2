import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
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
    private quotes: QuoteStore,
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

    let emailedTo: string | undefined;
    let emailFailureReason: string | undefined;

    // State flip + bus emit are idempotent — only on first send. Email
    // dispatch is NOT idempotent: a previous attempt that failed (e.g.,
    // POSTMARK_FROM unset on first try) shouldn't leave us short-circuiting
    // on subsequent Send clicks. The user clicked "Send to client" — try
    // to deliver, every time.
    if (!wasAlreadySent) {
      await this.contracts.update(contract.id, input.userId, { status: "sent" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "contract",
        entityId: contract.id,
        action: "sent",
      });
    }

    try {
      const result = await this.emailer.run(input.userId, { kind: "contract", resourceId: contract.id });
      if (result.ok) emailedTo = result.to;
      else emailFailureReason = result.reason;
      console.log(`[send-contract] contract=${contract.id} email ok=${result.ok} to=${result.to ?? "<none>"} reason=${result.reason ?? "ok"}`);
    } catch (err) {
      emailFailureReason = (err as Error).message ?? "dispatch threw";
      console.error(`[send-contract] email dispatch failed for contract ${contract.id}:`, err);
    }

    // Also (re-)dispatch the linked quote if it was never actually
    // delivered. LockQuote tries to email at lock time, but the
    // LLM-drafted quote often has no customerId at that point — the
    // customer is bound later in the wizard's customer step — so the
    // dispatch silently no-ops with "no recipient". Backfill
    // quote.customerId from conv.customerId so the email has somewhere
    // to go. Only attempts when quote.sentAt is missing (per-resource
    // idempotency on the quote side, set on first successful dispatch).
    const quoteId = conv.quoteId ?? contract.quoteId;
    if (quoteId) {
      try {
        const quote = await this.quotes.getOwned(quoteId, input.userId);
        if (!quote.sentAt) {
          if (!quote.customerId && conv.customerId) {
            await this.quotes.update(quote.id, input.userId, { customerId: conv.customerId });
          }
          const r = await this.emailer.run(input.userId, { kind: "quote", resourceId: quote.id });
          console.log(`[send-contract] quote-backfill quote=${quote.id} email ok=${r.ok} to=${r.to ?? "<none>"} reason=${r.reason ?? "ok"}`);
        }
      } catch (err) {
        console.error(`[send-contract] quote backfill dispatch failed for quote ${quoteId}:`, err);
      }
    }

    // Surface the actual delivery outcome in the chat. When there's no
    // recipient (customer missing email), say so explicitly instead of
    // misleadingly claiming "Contract sent to client" — the user's
    // first question is "where did it go?"
    const dividerContent = emailedTo
      ? `Contract sent to ${emailedTo}`
      : emailFailureReason
        ? `Contract not delivered — ${emailFailureReason}`
        : "Contract drafted — no email on file for this customer. Add one to deliver.";
    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: dividerContent,
      payload: {
        phase: 3,
        label: dividerContent,
        contractId: contract.id,
        ...(emailedTo ? { emailedTo } : {}),
        ...(emailFailureReason ? { emailFailureReason } : {}),
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
