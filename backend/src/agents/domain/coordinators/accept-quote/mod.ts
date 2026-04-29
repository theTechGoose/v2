import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AcceptQuoteInput {
  userId: string;
  conversationId: string;
  /** Must match conv.quoteId — guarantees the user is recording acceptance
   *  for the quote currently bound to this conversation, not a stray draft. */
  quoteId: string;
}

export interface AcceptQuoteResult {
  conversation: AgentConversation;
  /** phase_divider + continue_cta(toPhase=terms): the chat surface for
   *  "customer accepted, advance to terms wizard". */
  newMessages: AgentMessage[];
}

/**
 * AcceptQuote — fires when the customer accepts the locked quote.
 *
 *   - In real life: invoked by the acceptance webhook from the signing /
 *     review surface the customer interacts with.
 *   - In dev:       invoked by the chat island's "Simulate customer
 *                   accepted" button that sits on the locked action_card.
 *
 * Flow:
 *   1. Verify ownership + quoteId matches conv.quoteId.
 *   2. Idempotent: if quote.status === 'accepted', short-circuit.
 *   3. Flip quote.status = 'accepted', emit `quote:accepted` event.
 *   4. Append a phase_divider so the chat shows "Quote accepted by client",
 *      followed by a continue_cta to terms — the user's prompt to move
 *      forward and assemble contract terms.
 *   5. Set hasUnreadEvent + bump preview so the threads-sidebar surfaces
 *      the badge and bubbles the conversation to the top.
 */
@Injectable()
export class AcceptQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private bus: EventBus,
  ) {}

  async run(input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.quoteId !== input.quoteId) {
      throw new Error("quoteId does not match this conversation's quote");
    }

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    const wasAlreadyAccepted = quote.status === "accepted";

    if (!wasAlreadyAccepted) {
      await this.quotes.update(quote.id, input.userId, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      });
      await this.bus.emit({
        userId: input.userId,
        entityType: "quote",
        entityId: quote.id,
        action: "accepted",
      });
    }

    const divider = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: "Quote accepted by client",
      payload: {
        phase: 2,
        label: "Quote accepted by client",
        quoteId: quote.id,
      },
    });

    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: "Continue to contract",
      payload: {
        toPhase: "terms",
        quoteId: quote.id,
        summary: "Customer accepted — assemble contract terms (7 quick questions).",
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      hasUnreadEvent: true,
      quoteStatus: "accepted",
      preview: "✓ Quote accepted by client",
    });

    return { conversation: updatedConv, newMessages: [divider, cta] };
  }
}
