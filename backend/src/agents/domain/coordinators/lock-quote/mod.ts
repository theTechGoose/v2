import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface LockQuoteInput {
  userId: string;
  conversationId: string;
  /** Explicit quote id from the action card the user clicked. Lets the
   *  user lock a SPECIFIC card even if the LLM has since drafted others. */
  quoteId: string;
}

export interface LockQuoteResult {
  conversation: AgentConversation;
  /** action_card (status=sent) + continue_cta to phase 2. */
  newMessages: AgentMessage[];
}

/**
 * LockQuote — deterministic counterpart to the LLM's `lock_quote` tool.
 *
 * The LLM-driven path (handle-chat-message) is unreliable for "lock"
 * intents — gpt-4o-mini sometimes drafts another quote instead of
 * locking. Surfacing this as its own endpoint behind the action_card's
 * "Lock it in" button removes the model from the loop entirely:
 *
 *   1. Verify ownership of conversation + quote.
 *   2. If the quote is already "sent", short-circuit (idempotent).
 *   3. Flip quote.status = 'sent', emit `quote sent` event.
 *   4. Best-effort dispatch paperwork email (failure does NOT abort —
 *      mirrors handle-chat-message's behavior so the user can retry).
 *   5. Append a fresh action_card (status=sent) so the chat shows the
 *      locked totals, plus a continue_cta to phase 2.
 *   6. Set conv.quoteId so subsequent flows know what to operate on.
 */
@Injectable()
export class LockQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
  ) {}

  async run(input: LockQuoteInput): Promise<LockQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);

    const wasAlreadySent = quote.status === "sent";
    if (!wasAlreadySent) {
      await this.quotes.update(quote.id, input.userId, { status: "sent" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "quote",
        entityId: quote.id,
        action: "sent",
      });
      try {
        await this.emailer.run(input.userId, { kind: "quote", resourceId: quote.id });
      } catch (err) {
        console.error(`[lock-quote] email dispatch failed for quote ${quote.id}:`, err);
      }
    }

    // Re-read so the action_card mirrors what's actually persisted.
    const fresh = await this.quotes.getOwned(quote.id, input.userId);
    const lineItems = (fresh.lineItems ?? []).map((li) => ({
      description: li.description,
      // QuoteStore uses dollars-per-unit × quantity; the chat surface
      // expects per-line cents totals.
      amountCents: Math.round((li.price ?? 0) * (li.quantity ?? 1) * 100),
    }));
    const totalCents = Math.round((fresh.estimatedTotal ?? 0) * 100);

    const card = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "action_card",
      content: fresh.summary ?? "Quote locked",
      payload: {
        actionType: "quote",
        status: "sent",
        quoteId: fresh.id,
        ...(fresh.customerId ? { customerId: fresh.customerId } : {}),
        lineItems,
        totalCents,
      },
    });

    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: "Continue to terms",
      payload: {
        toPhase: "terms",
        quoteId: fresh.id,
        summary: "Payment, warranty, dispute, governing state — 7 quick questions",
      },
    });

    const updated = await this.conversations.update(conv.id, {
      quoteId: fresh.id,
      preview: `Locked quote: ${fresh.summary ?? fresh.id}`,
    });

    return { conversation: updated, newMessages: [card, cta] };
  }
}
