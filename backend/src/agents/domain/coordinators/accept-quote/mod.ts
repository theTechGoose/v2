import { Injectable } from "#danet/core";
import { t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface AcceptQuoteInput {
  userId: string;
  conversationId: string;
  quoteId: string;
}

export interface AcceptQuoteResult {
  conversation: AgentConversation;
  /** phase_divider message announcing the acceptance, for the chat. */
  newMessages: AgentMessage[];
}

/**
 * AcceptQuote — fires when the customer accepts (signs) the quote
 * (in real life, via POST /quotes/:id/accept from the public /q page;
 * in dev, via a "Simulate customer accepted" trigger button on the chat).
 *
 *   1. Verify the quote belongs to the conversation owner.
 *   2. If already accepted, short-circuit (idempotent).
 *   3. Flip quote.status = 'accepted' + stamp acceptedAt, emit
 *      `quote:accepted`.
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
export class AcceptQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private users: UserStore,
    private bus: EventBus,
  ) {}

  async run(input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.quoteId !== input.quoteId) {
      throw new Error("quoteId does not match this conversation's quote");
    }

    // Resolve the contractor's UI language so the chat divider / CTA copy
    // reads in their language (matches handle-chat-message's resolution).
    const me = await this.users.get(input.userId).catch(() => null);
    const lang = me?.language === "es" ? "es" : "en";

    const quote = await this.quotes.getOwned(input.quoteId, input.userId);
    const wasAlreadyAccepted = isAccepted(quote);

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

    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: t(lang, "acceptQuote.dividerLabel"),
      payload: {
        phase: 4,
        label: t(lang, "acceptQuote.dividerLabel"),
        quoteId: quote.id,
      },
    });

    // Per the quote → invoice chain, customer acceptance of the agreement
    // is the user's prompt to draft + send the invoice.
    const cta = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "continue_cta",
      content: t(lang, "acceptQuote.cta.label"),
      payload: {
        toPhase: "invoice",
        quoteId: quote.id,
        summary: t(lang, "acceptQuote.cta.summary"),
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      hasUnreadEvent: true,
      quoteStatus: "accepted",
      preview: `✓ ${t(lang, "acceptQuote.dividerLabel")}`,
    });

    return { conversation: updatedConv, newMessages: [note, cta] };
  }
}
